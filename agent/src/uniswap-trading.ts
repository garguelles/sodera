// Uniswap Trading API client. The API key stays in this service and is only ever sent as a header.
// Findings behind these settings: docs/research/trading-api-pay-with-sepolia.md.

export const TRADING_API_URL = 'https://trade-api.gateway.uniswap.org/v1';
/** Pinned so /quote and /swap_5792 agree on calldata; Sepolia's 2.1.2 router is TRADING_UNIVERSAL_ROUTER. */
export const TRADING_ROUTER_VERSION = '2.1.2';

const TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 1_000;

export class TradingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TradingApiError';
  }
}

type Fetch = typeof fetch;
type Json = Record<string, any>;

export type TradingApiClient = {
  quote(body: Json): Promise<Json>;
  swap5792(body: Json): Promise<Json>;
};

export function createTradingApiClient({
  apiKey,
  fetch: fetchImpl = fetch,
  baseUrl = TRADING_API_URL,
  timeoutMs = TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
}: {
  apiKey: string;
  fetch?: Fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
}): TradingApiClient {
  async function post(path: string, body: Json, attempt = 1): Promise<Json> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-universal-router-version': TRADING_ROUTER_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (caught) {
      const timedOut = caught instanceof Error && (caught.name === 'TimeoutError' || caught.name === 'AbortError');
      throw new TradingApiError(0, timedOut ? 'Timeout' : 'NetworkError', `${path} ${timedOut ? 'timed out' : 'failed'}`);
    }

    const payload = (await response.json().catch(() => ({}))) as Json;
    if (response.ok) return payload;

    const code = typeof payload.errorCode === 'string' ? payload.errorCode : 'UnknownError';
    const transient = response.status === 429 || code === 'UpstreamTimeoutError';
    if (transient && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return post(path, body, attempt + 1);
    }
    throw new TradingApiError(response.status, code, `${path} returned ${response.status} ${code}`);
  }

  return {
    quote: (body) => post('/quote', body),
    swap5792: (body) => post('/swap_5792', body),
  };
}
