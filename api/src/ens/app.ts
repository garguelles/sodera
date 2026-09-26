import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getAddress, isAddress, zeroAddress, type Address } from 'viem';

import { parseUsername } from './username.ts';
import type { Availability } from './chain.ts';
import { InvalidAssertionError, InvalidChallengeError, NameNotClaimableError, type ClaimAuth } from './claim-auth.ts';
import { ChallengeLimitError } from './challenge-store.ts';

export function createEnsApp(
  lookup: (name: { label: string; name: string }) => Promise<Availability>,
  auth?: ClaimAuth,
) {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, service: 'api' }));
  app.get('/ens/availability/:label', async (c) => {
    let username: ReturnType<typeof parseUsername>;
    try {
      username = parseUsername(c.req.param('label'));
    } catch {
      return c.json({ error: 'invalid_label' }, 400);
    }
    if (username.reserved) {
      return c.json({ chainId: 11155111, name: username.name, status: 'reserved', claimable: false, owner: null, expiresAt: null });
    }
    try {
      return c.json(await lookup(username));
    } catch {
      return c.json({ error: 'ens_unavailable' }, 503);
    }
  });

  if (auth) {
    const limit = bodyLimit({
      maxSize: 8192,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    });
    app.post('/ens/challenges', limit, async (c) => {
      let input: { account: Address; label: string; name: string };
      try {
        const body = await c.req.json() as { account?: unknown; label?: unknown };
        if (typeof body.account !== 'string' || !isAddress(body.account) ||
          getAddress(body.account) === zeroAddress || typeof body.label !== 'string') {
          throw new Error('Invalid request');
        }
        const username = parseUsername(body.label);
        if (username.reserved) return c.json({ error: 'name_unavailable' }, 409);
        input = { account: getAddress(body.account), label: username.label, name: username.name };
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }
      try {
        const ip = (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown').slice(0, 128);
        return c.json(await auth.issue({ ...input, ip }), 201);
      } catch (error) {
        if (error instanceof ChallengeLimitError) {
          c.header('retry-after', '3600');
          return c.json({ error: 'rate_limited' }, 429);
        }
        if (error instanceof NameNotClaimableError) return c.json({ error: 'name_unavailable' }, 409);
        if (error instanceof Error && (error.message === 'Kernel account is not deployed' ||
          error.message === 'Account is not controlled by the pinned Primary Passkey validator')) {
          return c.json({ error: 'kernel_unavailable' }, 409);
        }
        return c.json({ error: 'ens_unavailable' }, 503);
      }
    });

    app.post('/ens/challenges/:id/verify', limit, async (c) => {
      let input: { id: string; account: Address; label: string; proof: {
        authenticatorData: string; clientDataJSON: string; signature: string;
      } };
      try {
        const body = await c.req.json() as {
          account?: unknown; label?: unknown;
          proof?: { authenticatorData?: unknown; clientDataJSON?: unknown; signature?: unknown };
        };
        const id = c.req.param('id');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
          typeof body.account !== 'string' || !isAddress(body.account) ||
          getAddress(body.account) === zeroAddress || typeof body.label !== 'string' ||
          typeof body.proof?.authenticatorData !== 'string' ||
          typeof body.proof?.clientDataJSON !== 'string' || typeof body.proof?.signature !== 'string') {
          throw new Error('Invalid request');
        }
        const username = parseUsername(body.label);
        if (username.reserved) throw new Error('Reserved');
        input = {
          id, account: getAddress(body.account), label: username.label,
          proof: {
            authenticatorData: body.proof.authenticatorData,
            clientDataJSON: body.proof.clientDataJSON,
            signature: body.proof.signature,
          },
        };
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }
      try {
        return c.json(await auth.verify(input));
      } catch (error) {
        if (error instanceof InvalidChallengeError || error instanceof InvalidAssertionError) {
          return c.json({ error: 'invalid_proof' }, 401);
        }
        return c.json({ error: 'ens_unavailable' }, 503);
      }
    });
  }
  return app;
}
