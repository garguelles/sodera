import { timingSafeEqual } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { zValidator } from '@hono/zod-validator';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getAddress, type Address } from 'viem';

import type { MultiBaasClient } from './multibaas.ts';
import { PayQuoteRequestSchema, UnexpectedPayCallsError, type PayQuoter } from './pay-quote.ts';
import { ungroundedFacts } from './grounding.ts';
import { evaluatePolicy, serializeEnrichedPlan } from './policy.ts';
import { propose, renderUserMessage, type Effort, type ProposeClient, type ProposeResult } from './propose.ts';
import { createRateLimiter } from './rate-limit.ts';
import { ProposeRequestSchema } from './schema.ts';
import { createTools, resolveName, type ToolDependencies } from './tools.ts';
import type { TranscriptStore } from './transcript.ts';
import { TradingApiError } from './uniswap-trading.ts';
import type { SwapQuoter } from './uniswap.ts';

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
  quoteSwap: SwapQuoter;
  /** Null when UNISWAP_API_KEY is not configured; /pay/quote then answers 503. */
  payQuoter: PayQuoter | null;
  transcripts: TranscriptStore;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
};

export function createApp(deps: AppDependencies) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const accountLimiter = createRateLimiter({ limit: 10, windowMs: 60_000, now });
  const ipLimiter = createRateLimiter({ limit: 60, windowMs: 60_000, now });
  const payAccountLimiter = createRateLimiter({ limit: 20, windowMs: 60_000, now });
  const payIpLimiter = createRateLimiter({ limit: 60, windowMs: 60_000, now });
  // The Uniswap key allows 6 requests a second and each quote makes two; this caps all users together.
  const payGlobalLimiter = createRateLimiter({ limit: 3, windowMs: 1_000, now });
  const expectedToken = Buffer.from(deps.appToken);

  const requireAppToken: MiddlewareHandler = async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (token.length !== expectedToken.length || !timingSafeEqual(token, expectedToken)) {
      return error(c, 401, 'unauthorized', 'Missing or invalid app token.');
    }
    await next();
  };
  const limitBody = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => error(c, 413, 'body_too_large', 'Request body is too large.'),
  });
  const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post(
    '/pay/quote',
    requireAppToken,
    limitBody,
    zValidator('json', PayQuoteRequestSchema, (result, c) => {
      if (!result.success) return error(c, 400, 'invalid_request', 'Request body is not a valid pay quote request.');
    }),
    async (c) => {
      if (!deps.payQuoter) return error(c, 503, 'pay_unavailable', 'Paying with another asset is not configured.');
      const startedAt = now();
      const request = c.req.valid('json');
      const account = getAddress(request.account);

      const retryAfter =
        payIpLimiter.hit(clientIp(c)) ?? payAccountLimiter.hit(account.toLowerCase()) ?? payGlobalLimiter.hit('global');
      if (retryAfter !== null) {
        c.header('retry-after', String(retryAfter));
        return error(c, 429, 'rate_limited', 'Too many quote requests. Try again shortly.');
      }

      const record = (outcome: string, requestId: string | null = null) =>
        log({
          event: 'pay_quote',
          account: `${account.slice(0, 6)}…${account.slice(-4)}`,
          pair: `${request.payAsset}->${request.receiveAsset}`,
          outcome,
          requestId,
          latencyMs: now() - startedAt,
        });

      try {
        const quote = await deps.payQuoter(request);
        record('quoted', quote.requestId);
        return c.json(quote);
      } catch (caught) {
        return payQuoteError(c, caught, record, log);
      }
    },
  );

  app.post(
    '/agent/propose',
    requireAppToken,
    limitBody,
    zValidator('json', ProposeRequestSchema, (result, c) => {
      if (!result.success) return error(c, 400, 'invalid_request', 'Request body is not a valid proposal request.');
    }),
    async (c) => {
      const startedAt = now();
      const { account: rawAccount, intent, context, reset } = c.req.valid('json');
      const account = getAddress(rawAccount);

      const retryAfter = ipLimiter.hit(clientIp(c)) ?? accountLimiter.hit(account.toLowerCase());
      if (retryAfter !== null) {
        c.header('retry-after', String(retryAfter));
        return error(c, 429, 'rate_limited', 'Too many requests. Try again in a minute.');
      }

      if (reset) deps.transcripts.reset(account);
      const resolvedNames = new Map<string, Address>();
      const calls: string[] = [];
      const toolResults: string[] = [];
      const ranges: { from: string; to: string }[] = [];
      const toolDeps: ToolDependencies = {
        account,
        context,
        multibaas: deps.multibaas,
        resolveEns: deps.resolveEns,
        quoteSwap: deps.quoteSwap,
        now,
        resolvedNames,
        calls,
        toolResults,
        ranges,
      };
      const tools = createTools(toolDeps);

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
      if (result.output.kind === 'answer') {
        const snapshot = renderUserMessage(intent, context, deps.valueCapUsd);
        if (ungroundedFacts(result.output, [...toolResults, snapshot]).length > 0) {
          record('ungrounded', result);
          return c.json({
            kind: 'rejected',
            summary: null,
            violations: [
              {
                code: 'ungrounded',
                actionIndex: null,
                message: "Some figures in the answer didn't match your wallet data. Try a narrower question.",
              },
            ],
          });
        }
        record('answer', result);
        return c.json({ ...result.output, source: ranges.at(-1) ?? null });
      }

      // A follow-up can reuse a name resolved in an earlier turn without calling the tool again.
      for (const action of result.output.actions) {
        if ((action.type !== 'send_eth' && action.type !== 'send_usdc') || action.recipient.kind !== 'name') continue;
        if (!resolvedNames.has(action.recipient.value.trim().toLowerCase())) {
          await resolveName(toolDeps, { name: action.recipient.value });
        }
      }
      const policy = evaluatePolicy(result.output, context, {
        account,
        valueCapUsd: deps.valueCapUsd,
        resolveName: (name) => resolvedNames.get(name.trim().toLowerCase()) ?? null,
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

function error(
  c: Context,
  status: 400 | 401 | 404 | 413 | 422 | 429 | 500 | 502 | 503 | 504,
  code: string,
  message: string,
) {
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

function payQuoteError(
  c: Context,
  caught: unknown,
  record: (outcome: string) => void,
  log: (line: Record<string, unknown>) => void,
) {
  if (caught instanceof UnexpectedPayCallsError) {
    log({ event: 'pay_quote_rejected', message: caught.message });
    record('unexpected_calls');
    return error(c, 502, 'unexpected_quote', 'Uniswap returned a quote Sodera cannot use.');
  }
  if (!(caught instanceof TradingApiError)) {
    log({ event: 'pay_quote_error', message: caught instanceof Error ? caught.message : String(caught) });
    record('failed');
    return error(c, 500, 'internal', 'Something went wrong.');
  }
  log({ event: 'pay_quote_upstream_error', status: caught.status, code: caught.code });
  if (caught.code === 'Timeout') {
    record('upstream_timeout');
    return error(c, 504, 'upstream_timeout', 'Uniswap did not answer in time. Try again.');
  }
  if (caught.status === 429 || caught.code === 'UpstreamTimeoutError') {
    record('upstream_busy');
    c.header('retry-after', '5');
    return error(c, 503, 'busy', 'Uniswap is busy. Try again shortly.');
  }
  if (caught.status === 404 || caught.code === 'NoRouteFoundError' || caught.code === 'NoQuotesAvailable') {
    record('no_route');
    return error(c, 422, 'no_route', 'Uniswap found no route for this payment.');
  }
  if (caught.status === 401 || caught.status === 403) {
    record('upstream_auth_failed');
    console.error('Uniswap rejected UNISWAP_API_KEY. Pay quotes are unavailable until it is fixed.');
    return error(c, 500, 'misconfigured', 'Paying with another asset is unavailable.');
  }
  record('upstream_error');
  return error(c, 502, 'upstream_error', 'Uniswap is unavailable. Try again later.');
}
