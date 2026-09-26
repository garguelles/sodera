import Anthropic from '@anthropic-ai/sdk';
import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { createApp, MAX_BODY_BYTES, type AppDependencies } from './app.ts';
import type { EventQuery } from './multibaas.ts';
import { UnexpectedPayCallsError, type PayQuote } from './pay-quote.ts';
import { TradingApiError } from './uniswap-trading.ts';
import { createTranscriptStore } from './transcript.ts';
import { fakeClient, fakeMultiBaas, message } from './test/fakes.ts';
import { ACCOUNT, ALICE, createContext, resolveAliceEns } from './test/fixtures.ts';

const TOKEN = 'test-app-token';

function plan(amount = '0.01', recipient = 'alice') {
  return JSON.stringify({
    kind: 'plan',
    summary: `Send ${amount} ETH to ${recipient}.`,
    actions: [{ type: 'send_eth', recipient: { kind: 'name', value: recipient }, amount }],
    assumptions: [],
  });
}

function setup(reply: () => Anthropic.Beta.BetaMessage[] | Promise<Anthropic.Beta.BetaMessage[]>, overrides: Partial<AppDependencies> = {}) {
  const { client, toolRunner } = fakeClient(reply);
  const log = vi.fn();
  const app = createApp({
    appToken: TOKEN,
    client,
    model: 'claude-sonnet-5',
    effort: 'high',
    systemPrompt: 'SYSTEM',
    valueCapUsd: 250,
    multibaas: fakeMultiBaas(),
    resolveEns: vi.fn(resolveAliceEns),
    quoteSwap: vi.fn(),
    payQuoter: null,
    transcripts: createTranscriptStore(),
    log,
    ...overrides,
  });
  return { app, toolRunner, log };
}

/** A model that resolves the recipient with `resolve_name`, as the prompt requires, before replying. */
function resolvingClient(reply: () => Anthropic.Beta.BetaMessage[]) {
  return fakeClient(async (params) => {
    const tool = params.tools.find((item) => 'name' in item && item.name === 'resolve_name') as unknown as {
      run: (input: unknown) => Promise<string>;
    };
    await tool.run({ name: 'alice' });
    return reply();
  }).client;
}

function post(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request('/agent/propose', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const request = (intent = 'send 0.01 eth to alice') => ({ account: ACCOUNT, intent, context: createContext() });

describe('agent server', () => {
  it('reports health without auth', async () => {
    const { app } = setup(() => []);
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('rejects missing or wrong tokens before calling the model', async () => {
    const { app, toolRunner } = setup(() => [message(plan())]);

    expect((await post(app, request(), { authorization: '' })).status).toBe(401);
    expect((await post(app, request(), { authorization: 'Bearer nope' })).status).toBe(401);
    expect(toolRunner).not.toHaveBeenCalled();
  });

  it('rejects oversized and malformed bodies', async () => {
    const { app, toolRunner } = setup(() => [message(plan())]);

    const huge = await post(app, JSON.stringify({ ...request(), padding: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(huge.status).toBe(413);
    const malformed = await post(app, { account: ACCOUNT, intent: 'hi' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: { code: 'invalid_request', message: 'Request body is not a valid proposal request.' },
    });
    expect(toolRunner).not.toHaveBeenCalled();
  });

  it('returns a policy-checked plan with the serving model', async () => {
    const { app, log } = setup(() => [], { client: resolvingClient(() => [message(plan())]) });

    const response = await post(app, request());

    expect(response.status).toBe(200);
    expect(response.headers.get('x-agent-model')).toBe('claude-sonnet-5');
    const body = await response.json();
    expect(body).toMatchObject({
      kind: 'plan',
      summary: 'Send 0.01 ETH to alice.',
      enriched: {
        totalUsdCents: '2000',
        actions: [{ amountBase: '10000000000000000', recipient: { address: getAddress(ALICE), name: 'alice' } }],
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'propose', outcome: 'plan', intentLength: 22, cacheReadInputTokens: 80 }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('alice');
  });

  it('passes clarifications through', async () => {
    const { app } = setup(() => [message(JSON.stringify({ kind: 'clarification', question: 'How much ETH?' }))]);
    expect(await (await post(app, request('send some eth to alice'))).json()).toEqual({
      kind: 'clarification',
      question: 'How much ETH?',
    });
  });

  it('returns grounded answers without a policy check, with the range they cover', async () => {
    const answer = JSON.stringify({
      kind: 'answer',
      text: 'You sent 42.5 USDC to alice this month.',
      facts: [{ label: 'Sent to alice', value: '42.50 USDC' }],
    });
    const executeEventQuery = vi.fn(async (query: EventQuery) => {
      const sent = JSON.stringify(query.events[0]!.filter).includes(`"inputIndex":0,"operator":"equal","value":"${ACCOUNT}"`);
      return query.groupBy === 'counterparty' && sent ? [{ counterparty: ALICE, total: '42500000' }] : [];
    });
    const { app, log } = setup(() => [message(answer)], { multibaas: fakeMultiBaas({ executeEventQuery }) });
    const { client, toolRunner } = fakeClient(async (params) => {
      const tool = params.tools.find((item) => 'name' in item && item.name === 'summarize_activity') as unknown as {
        run: (input: unknown) => Promise<string>;
      };
      await tool.run({ from: '2026-09-01', to: '2026-09-27', counterparty: 'alice' });
      return [message(answer)];
    });
    const grounded = setup(() => [], { client, multibaas: fakeMultiBaas({ executeEventQuery }) });

    const body = await (await post(grounded.app, request('how much did I send alice this month?'))).json();
    expect(body).toEqual({
      kind: 'answer',
      text: 'You sent 42.5 USDC to alice this month.',
      facts: [{ label: 'Sent to alice', value: '42.50 USDC' }],
      source: { from: '2026-09-01', to: '2026-09-27' },
    });
    expect(toolRunner).toHaveBeenCalledTimes(1);
    expect(grounded.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'answer', toolCalls: ['summarize_activity'] }));

    // Without the tool call, 42.5 appears nowhere the model could have read it.
    const ungrounded = await (await post(app, request('how much did I send alice this month?'))).json();
    expect(ungrounded).toMatchObject({ kind: 'rejected', summary: null, violations: [{ code: 'ungrounded' }] });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ungrounded' }));
  });

  it('accepts answers taken from the snapshot', async () => {
    const answer = JSON.stringify({ kind: 'answer', text: 'You have 100 USDC.', facts: [{ label: 'USDC', value: '100' }] });
    const { app } = setup(() => [message(answer)]);
    expect(await (await post(app, request('how much usdc do I have?'))).json()).toMatchObject({ kind: 'answer', source: null });
  });

  it('rejects plans that break the policy', async () => {
    const { app } = setup(() => [], { client: resolvingClient(() => [message(plan('100'))]) });
    const body = await (await post(app, request('send 100 eth to alice'))).json();

    expect(body.kind).toBe('rejected');
    expect(body.summary).toBe('Send 100 ETH to alice.');
    expect(body.violations.map((violation: { code: string }) => violation.code)).toEqual(['insufficient_eth', 'value_cap']);
  });

  it('rejects a named recipient that resolve_name never resolved', async () => {
    const { app } = setup(() => [message(plan())]);
    const body = await (await post(app, request())).json();

    expect(body.violations.map((violation: { code: string }) => violation.code)).toEqual(['recipient_unresolved']);
  });

  it('declines refusals and rejects unreadable output', async () => {
    const refused = setup(() => [message(null, { stop_reason: 'refusal' })]);
    expect(await (await post(refused.app, request())).json()).toEqual({
      kind: 'declined',
      message: 'The assistant declined this request. Use the manual screens instead.',
    });

    const garbled = setup(() => [message('not json')]);
    expect(await (await post(garbled.app, request())).json()).toMatchObject({
      kind: 'rejected',
      violations: [{ code: 'schema' }],
    });
  });

  it('keeps follow-ups per account and clears them on reset', async () => {
    const { app, toolRunner } = setup(() => [message(plan())]);

    await post(app, request('send 0.01 eth to alice'));
    await post(app, request('make it 0.02 instead'));
    await post(app, { ...request('start over'), reset: true });

    const messages = toolRunner.mock.calls.map(([params]) => params.messages.length);
    expect(messages).toEqual([1, 3, 1]);
    expect(toolRunner.mock.calls[1]![0].messages[0]).toEqual({ role: 'user', content: 'send 0.01 eth to alice' });
  });

  it('rate limits each account to ten requests a minute', async () => {
    const { app } = setup(() => [message(plan())]);
    for (let index = 0; index < 10; index += 1) {
      expect((await post(app, request())).status).toBe(200);
    }
    const limited = await post(app, request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();

    const other = await post(app, { ...request(), account: '0x5555555555555555555555555555555555555555' });
    expect(other.status).toBe(200);
  });

  it('rate limits each IP to sixty requests a minute', async () => {
    const { app } = setup(() => [message(plan())]);
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      const account = `0x${(index + 16).toString(16).padStart(40, '0')}`;
      statuses.push((await post(app, { ...request(), account }, { 'x-forwarded-for': '203.0.113.9' })).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it('maps Claude API failures to service errors', async () => {
    const cases: [Error, number, string][] = [
      [new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()), 503, 'upstream_busy'],
      [new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers()), 500, 'misconfigured'],
      [new Anthropic.InternalServerError(500, {}, 'boom', new Headers()), 502, 'upstream_error'],
      [new Error('Agent output was cut off'), 500, 'internal'],
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [failure, status, code] of cases) {
      const { app } = setup(() => {
        throw failure;
      });
      const response = await post(app, request());
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    consoleError.mockRestore();
  });
});

describe('pay quote endpoint', () => {
  const payRequest = { account: ACCOUNT, payAsset: 'ETH', receiveAsset: 'USDC', amountOut: '10000000' };
  const payQuote: PayQuote = {
    quoteId: 'quote-1',
    requestId: 'req-1',
    quotedAt: '2026-09-26T08:00:00.000Z',
    deadline: 1790410200,
    routerVersion: '2.1.2',
    payAsset: 'ETH',
    receiveAsset: 'USDC',
    amountIn: '1000',
    maxAmountIn: '1005',
    amountOut: '10000000',
    route: '[v4] 100.00% = pool',
    priceImpactPercent: 0.84,
    swap: { to: '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3', value: '1005', data: '0x3593564c' },
  };

  function payPost(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
    return app.request('/pay/quote', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('requires the app token and a valid request before quoting', async () => {
    const payQuoter = vi.fn().mockResolvedValue(payQuote);
    const { app } = setup(() => [], { payQuoter });

    expect((await payPost(app, payRequest, { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await payPost(app, { ...payRequest, receiveAsset: 'ETH' })).status).toBe(400);
    expect((await payPost(app, { ...payRequest, amountOut: '0.5' })).status).toBe(400);
    expect(payQuoter).not.toHaveBeenCalled();
  });

  it('answers 503 when the Uniswap key is not configured', async () => {
    const { app } = setup(() => []);
    const response = await payPost(app, payRequest);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('pay_unavailable');
  });

  it('returns the normalized quote and logs it without amounts or addresses', async () => {
    const payQuoter = vi.fn().mockResolvedValue(payQuote);
    const { app, log } = setup(() => [], { payQuoter });

    const response = await payPost(app, payRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payQuote);
    expect(payQuoter).toHaveBeenCalledWith(payRequest);
    const line = log.mock.calls.map(([entry]) => entry).find((entry) => entry.event === 'pay_quote');
    expect(line).toMatchObject({ outcome: 'quoted', pair: 'ETH->USDC', requestId: 'req-1' });
    expect(JSON.stringify(line)).not.toContain(ACCOUNT);
  });

  it('caps quotes across all users to stay under the Uniswap key quota', async () => {
    const payQuoter = vi.fn().mockResolvedValue(payQuote);
    const { app } = setup(() => [], { payQuoter, now: () => 1_000 });

    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const account = `0x${(index + 16).toString(16).padStart(40, '0')}`;
      statuses.push((await payPost(app, { ...payRequest, account })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('maps Uniswap failures to service errors', async () => {
    const cases: [Error, number, string][] = [
      [new TradingApiError(404, 'NoRouteFoundError', 'no route'), 422, 'no_route'],
      [new TradingApiError(429, 'Throttled', 'busy'), 503, 'busy'],
      [new TradingApiError(0, 'Timeout', 'slow'), 504, 'upstream_timeout'],
      [new TradingApiError(401, 'Unauthorized', 'bad key'), 500, 'misconfigured'],
      [new TradingApiError(500, 'InternalServerError', 'boom'), 502, 'upstream_error'],
      [new UnexpectedPayCallsError('two router calls'), 502, 'unexpected_quote'],
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [failure, status, code] of cases) {
      const { app } = setup(() => [], { payQuoter: vi.fn().mockRejectedValue(failure) });
      const response = await payPost(app, payRequest);
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    consoleError.mockRestore();
  });
});
