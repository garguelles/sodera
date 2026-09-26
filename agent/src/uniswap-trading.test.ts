import { describe, expect, it, vi } from 'vitest';

import { createTradingApiClient, TradingApiError, TRADING_ROUTER_VERSION } from './uniswap-trading.ts';

const API_KEY = 'secret-uniswap-key';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(...responses: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const client = createTradingApiClient({ apiKey: API_KEY, fetch, retryDelayMs: 0 });
  return { client, fetch };
}

describe('Uniswap Trading API client', () => {
  it('sends the key and pinned router version as headers', async () => {
    const { client, fetch } = setup(jsonResponse(200, { routing: 'CLASSIC' }));

    await expect(client.quote({ type: 'EXACT_OUTPUT' })).resolves.toEqual({ routing: 'CLASSIC' });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://trade-api.gateway.uniswap.org/v1/quote');
    expect(init.headers).toMatchObject({ 'x-api-key': API_KEY, 'x-universal-router-version': TRADING_ROUTER_VERSION });
    expect(JSON.parse(String(init.body))).toEqual({ type: 'EXACT_OUTPUT' });
  });

  it('retries once on rate limits and transient upstream timeouts', async () => {
    const rateLimited = setup(jsonResponse(429, { errorCode: 'Throttled' }), jsonResponse(200, { calls: [] }));
    await expect(rateLimited.client.swap5792({})).resolves.toEqual({ calls: [] });
    expect(rateLimited.fetch).toHaveBeenCalledTimes(2);

    const flaky = setup(
      jsonResponse(404, { errorCode: 'UpstreamTimeoutError' }),
      jsonResponse(404, { errorCode: 'UpstreamTimeoutError' }),
    );
    await expect(flaky.client.quote({})).rejects.toMatchObject({ status: 404, code: 'UpstreamTimeoutError' });
    expect(flaky.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors and never puts the key in the error', async () => {
    const { client, fetch } = setup(jsonResponse(404, { errorCode: 'NoRouteFoundError', detail: API_KEY }));

    const caught = await client.quote({}).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(TradingApiError);
    expect(caught).toMatchObject({ status: 404, code: 'NoRouteFoundError' });
    expect(String((caught as Error).message)).not.toContain(API_KEY);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports timeouts and network failures as errors with status 0', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await expect(setup(timeout).client.quote({})).rejects.toMatchObject({ status: 0, code: 'Timeout' });
    await expect(setup(new TypeError('fetch failed')).client.quote({})).rejects.toMatchObject({
      status: 0,
      code: 'NetworkError',
    });
  });
});
