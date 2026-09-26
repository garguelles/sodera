import { timingSafeEqual } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getAddress, type Address } from 'viem';

import type { MultiBaasClient } from './multibaas.ts';
import { evaluatePolicy, serializeEnrichedPlan } from './policy.ts';
import { propose, type Effort, type ProposeClient, type ProposeResult } from './propose.ts';
import { createRateLimiter } from './rate-limit.ts';
import { ProposeRequestSchema } from './schema.ts';
import { createTools } from './tools.ts';
import type { TranscriptStore } from './transcript.ts';

export const MAX_BODY_BYTES = 32 * 1024;

export type AppDependencies = {
  appToken: string;
  client: ProposeClient;
  model: string;
  effort: Effort;
  systemPrompt: string;
  valueCapUsd: number;
  multibaas: MultiBaasClient;
  resolveEns: (name: string) => Promise<Address | null>;
  transcripts: TranscriptStore;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
};

export function createApp(deps: AppDependencies) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const accountLimiter = createRateLimiter({ limit: 10, windowMs: 60_000, now });
  const ipLimiter = createRateLimiter({ limit: 60, windowMs: 60_000, now });
  const expectedToken = Buffer.from(deps.appToken);

  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post(
    '/agent/propose',
    async (c, next) => {
      const header = c.req.header('authorization') ?? '';
      const token = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
      if (token.length !== expectedToken.length || !timingSafeEqual(token, expectedToken)) {
        return error(c, 401, 'unauthorized', 'Missing or invalid app token.');
      }
      await next();
    },
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => error(c, 413, 'body_too_large', 'Request body is too large.'),
    }),
    zValidator('json', ProposeRequestSchema, (result, c) => {
      if (!result.success) return error(c, 400, 'invalid_request', 'Request body is not a valid proposal request.');
    }),
    async (c) => {
      const startedAt = now();
      const { account: rawAccount, intent, context, reset } = c.req.valid('json');
      const account = getAddress(rawAccount);

      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const retryAfter = ipLimiter.hit(ip) ?? accountLimiter.hit(account.toLowerCase());
      if (retryAfter !== null) {
        c.header('retry-after', String(retryAfter));
        return error(c, 429, 'rate_limited', 'Too many requests. Try again in a minute.');
      }

      if (reset) deps.transcripts.reset(account);
      const resolvedNames = new Map<string, Address>();
      const calls: string[] = [];
      const tools = createTools({
        account,
        context,
        multibaas: deps.multibaas,
        resolveEns: deps.resolveEns,
        now,
        resolvedNames,
        calls,
      });

      const record = (outcome: string, result?: ProposeResult) =>
        log({
          event: 'propose',
          account: `${account.slice(0, 6)}…${account.slice(-4)}`,
          intentLength: intent.length,
          toolCalls: calls,
          outcome,
          inputTokens: result?.usage.inputTokens ?? 0,
          outputTokens: result?.usage.outputTokens ?? 0,
          cacheReadInputTokens: result?.usage.cacheReadInputTokens ?? 0,
          latencyMs: now() - startedAt,
        });

      let result: ProposeResult;
      try {
        result = await propose({
          client: deps.client,
          model: deps.model,
          effort: deps.effort,
          systemPrompt: deps.systemPrompt,
          tools,
          transcript: deps.transcripts.messages(account),
          intent,
          context,
          valueCapUsd: deps.valueCapUsd,
        });
      } catch (caught) {
        return upstreamError(c, caught, record, log);
      }
      c.header('x-agent-model', result.model);

      if (result.kind === 'refused') {
        record('declined', result);
        return c.json({
          kind: 'declined',
          message: 'The assistant declined this request. Use the manual screens instead.',
        });
      }
      if (result.kind === 'invalid') {
        record('rejected', result);
        return c.json({
          kind: 'rejected',
          summary: null,
          violations: [
            { code: 'schema', actionIndex: null, message: 'The assistant returned something the wallet cannot read.' },
          ],
        });
      }

      deps.transcripts.append(account, { user: intent, assistant: result.text });
      if (result.output.kind === 'clarification') {
        record('clarification', result);
        return c.json(result.output);
      }

      const policy = evaluatePolicy(result.output, context, {
        account,
        valueCapUsd: deps.valueCapUsd,
        resolveName: (name) => {
          const key = name.trim().toLowerCase();
          const fromTool = resolvedNames.get(key);
          if (fromTool) return fromTool;
          const entry = context.addressBook.find((item) => item.name.toLowerCase() === key);
          return entry ? getAddress(entry.address) : null;
        },
      });
      if (!policy.ok) {
        record('rejected', result);
        return c.json({ kind: 'rejected', summary: result.output.summary, violations: policy.violations });
      }
      record('plan', result);
      return c.json({ ...result.output, enriched: serializeEnrichedPlan(policy.plan) });
    },
  );

  app.notFound((c) => error(c, 404, 'not_found', 'Not found.'));
  app.onError((caught, c) => {
    log({ event: 'error', message: caught.message });
    return error(c, 500, 'internal', 'Something went wrong.');
  });

  return app;
}

function error(c: Context, status: 400 | 401 | 404 | 413 | 429 | 500 | 502 | 503, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function upstreamError(
  c: Context,
  caught: unknown,
  record: (outcome: string) => void,
  log: (line: Record<string, unknown>) => void,
) {
  if (caught instanceof Anthropic.APIError) {
    log({ event: 'upstream_error', status: caught.status ?? null, requestId: caught.requestID ?? null, message: caught.message });
  } else {
    log({ event: 'agent_error', message: caught instanceof Error ? caught.message : String(caught) });
  }
  if (caught instanceof Anthropic.RateLimitError) {
    record('upstream_rate_limited');
    c.header('retry-after', '30');
    return error(c, 503, 'upstream_busy', 'The assistant is busy. Try again shortly or use the manual screens.');
  }
  if (caught instanceof Anthropic.AuthenticationError) {
    record('upstream_auth_failed');
    console.error('Anthropic rejected ANTHROPIC_API_KEY. The agent cannot serve requests until it is fixed.');
    return error(c, 500, 'misconfigured', 'The assistant is unavailable.');
  }
  if (caught instanceof Anthropic.APIError) {
    record('upstream_error');
    return error(c, 502, 'upstream_error', 'The assistant is unavailable. Use the manual screens.');
  }
  record('failed');
  return error(c, 500, 'internal', 'Something went wrong.');
}
