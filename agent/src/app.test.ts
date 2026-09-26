import Anthropic from '@anthropic-ai/sdk';
import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { createApp, MAX_BODY_BYTES, type AppDependencies } from './app.ts';
import { createTranscriptStore } from './transcript.ts';
import { fakeClient, fakeMultiBaas, message } from './test/fakes.ts';
import { ACCOUNT, ALICE, createContext } from './test/fixtures.ts';

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
    resolveEns: vi.fn().mockResolvedValue(null),
    quoteSwap: vi.fn(),
    transcripts: createTranscriptStore(),
    log,
    ...overrides,
  });
  return { app, toolRunner, log };
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
    const { app, log } = setup(() => [message(plan())]);

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

  it('rejects plans that break the policy', async () => {
    const { app } = setup(() => [message(plan('100'))]);
    const body = await (await post(app, request('send 100 eth to alice'))).json();

    expect(body.kind).toBe('rejected');
    expect(body.summary).toBe('Send 100 ETH to alice.');
    expect(body.violations.map((violation: { code: string }) => violation.code)).toEqual(['insufficient_eth', 'value_cap']);
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
