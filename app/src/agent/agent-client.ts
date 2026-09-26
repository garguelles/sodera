import { z } from 'zod';

import { ActionSchema, type AgentContext } from './schema';

export type AgentConfig = { baseUrl: string; token: string };

/** The agent is optional; without both settings the intent bar stays hidden. */
export function readAgentConfigFromEnv(): AgentConfig | null {
  // Expo inlines EXPO_PUBLIC_ variables only for static property access.
  const baseUrl = process.env.EXPO_PUBLIC_AGENT_BASE_URL;
  const token = process.env.EXPO_PUBLIC_AGENT_APP_TOKEN;
  return baseUrl && token ? { baseUrl: baseUrl.replace(/\/+$/, ''), token } : null;
}

const ViolationSchema = z.object({
  code: z.string(),
  actionIndex: z.number().int().nullable(),
  message: z.string(),
});

const ProposeResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plan'),
    summary: z.string(),
    actions: z.array(ActionSchema),
    assumptions: z.array(z.string()),
    enriched: z.unknown(),
  }),
  z.object({ kind: z.literal('clarification'), question: z.string() }),
  z.object({ kind: z.literal('rejected'), summary: z.string().nullable(), violations: z.array(ViolationSchema) }),
  z.object({ kind: z.literal('declined'), message: z.string() }),
]);

export type ProposeResponse = z.infer<typeof ProposeResponseSchema>;

export type ProposeRequest = {
  account: string;
  intent: string;
  context: AgentContext;
  reset?: boolean;
};

/** The planner could not be reached or answered with an error; the wallet keeps working. */
export class AgentUnavailableError extends Error {
  constructor(
    message: string,
    /** `timeout` means the planner may be working but did not answer in time. */
    readonly reason: 'timeout' | 'unreachable' | 'error' = 'error',
  ) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}

/** Plans usually take 3 to 8 seconds; broad requests with several tool calls have taken over 20. */
export const AGENT_TIMEOUT_MS = 45_000;
/** A quote is two Trading API requests of about 1 s each, which the backend retries once when busy. */
export const PAY_QUOTE_TIMEOUT_MS = 20_000;

const PayAssetSchema = z.enum(['ETH', 'USDC']);
const BaseUnitsSchema = z.string().regex(/^\d{1,78}$/);

// Untrusted until app/src/wallet/pay-with-swap.ts has checked the router call against the request.
const PayQuoteSchema = z.object({
  quoteId: z.string().nullable(),
  requestId: z.string().nullable(),
  quotedAt: z.string(),
  deadline: z.number().int().positive(),
  routerVersion: z.string(),
  payAsset: PayAssetSchema,
  receiveAsset: PayAssetSchema,
  amountIn: BaseUnitsSchema,
  maxAmountIn: BaseUnitsSchema,
  amountOut: BaseUnitsSchema,
  route: z.string().nullable(),
  priceImpactPercent: z.number().nullable(),
  swap: z.object({
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    value: BaseUnitsSchema,
    data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  }),
});

export type PayQuote = z.infer<typeof PayQuoteSchema>;

export type PayQuoteRequest = {
  account: string;
  payAsset: 'ETH' | 'USDC';
  receiveAsset: 'ETH' | 'USDC';
  /** Exact amount the payee receives, in base units. */
  amountOut: string;
};

export type PayQuoteFailure = 'no_route' | 'busy' | 'timeout' | 'unreachable' | 'error';

const PAY_QUOTE_MESSAGES: Record<PayQuoteFailure, string> = {
  no_route: 'Uniswap found no route for this amount',
  busy: 'Quotes are busy right now. Try again in a few seconds',
  timeout: 'The quote took too long',
  unreachable: 'The quote service could not be reached',
  error: 'The quote service returned an error',
};

/** No usable quote; Send can still pay with the same asset. */
export class PayQuoteError extends Error {
  constructor(readonly reason: PayQuoteFailure) {
    super(PAY_QUOTE_MESSAGES[reason]);
    this.name = 'PayQuoteError';
  }
}

function payQuoteFailure(status: number, code: unknown): PayQuoteFailure {
  if (status === 422 && code === 'no_route') return 'no_route';
  if (status === 503 && code === 'busy') return 'busy';
  if (status === 504) return 'timeout';
  return 'error';
}

export function createAgentClient({
  config,
  fetcher = fetch,
  timeoutMs = AGENT_TIMEOUT_MS,
}: {
  config: AgentConfig;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  async function post(path: string, body: unknown, timeout: number): Promise<Response | 'timeout' | 'unreachable'> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetcher(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return controller.signal.aborted ? 'timeout' : 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async propose(request: ProposeRequest): Promise<ProposeResponse> {
      const response = await post('/agent/propose', request, timeoutMs);
      if (response === 'timeout') throw new AgentUnavailableError('The planner took too long to answer', 'timeout');
      if (response === 'unreachable') throw new AgentUnavailableError('The planner could not be reached', 'unreachable');
      if (!response.ok) throw new AgentUnavailableError(`The planner returned HTTP ${response.status}`);
      const parsed = ProposeResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new AgentUnavailableError('The planner returned invalid data');
      return parsed.data;
    },

    async payQuote(request: PayQuoteRequest, timeout = PAY_QUOTE_TIMEOUT_MS): Promise<PayQuote> {
      const response = await post('/pay/quote', request, timeout);
      if (typeof response === 'string') throw new PayQuoteError(response);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new PayQuoteError(payQuoteFailure(response.status, body?.error?.code));
      const parsed = PayQuoteSchema.safeParse(body);
      if (!parsed.success) throw new PayQuoteError('error');
      return parsed.data;
    },
  };
}

export type AgentClient = ReturnType<typeof createAgentClient>;
