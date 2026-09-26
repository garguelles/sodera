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

export function createAgentClient({
  config,
  fetcher = fetch,
  timeoutMs = AGENT_TIMEOUT_MS,
}: {
  config: AgentConfig;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  return {
    async propose(request: ProposeRequest): Promise<ProposeResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetcher(`${config.baseUrl}/agent/propose`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${config.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch {
        throw controller.signal.aborted
          ? new AgentUnavailableError('The planner took too long to answer', 'timeout')
          : new AgentUnavailableError('The planner could not be reached', 'unreachable');
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new AgentUnavailableError(`The planner returned HTTP ${response.status}`);
      const parsed = ProposeResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new AgentUnavailableError('The planner returned invalid data');
      return parsed.data;
    },
  };
}

export type AgentClient = ReturnType<typeof createAgentClient>;
