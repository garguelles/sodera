import type Anthropic from '@anthropic-ai/sdk';
import { vi } from 'vitest';

import type { MultiBaasClient } from '../multibaas.ts';
import type { ProposeClient } from '../propose.ts';

export function message(
  text: string | null,
  overrides: Partial<Anthropic.Beta.BetaMessage> = {},
): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: text === null ? [] : [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
    ...overrides,
  } as unknown as Anthropic.Beta.BetaMessage;
}

type RunnerParams = Parameters<ProposeClient['beta']['messages']['toolRunner']>[0];

/** A Claude client whose tool runner yields canned messages, optionally running tools first. */
export function fakeClient(
  script: (params: RunnerParams) => Promise<Anthropic.Beta.BetaMessage[]> | Anthropic.Beta.BetaMessage[],
) {
  const toolRunner = vi.fn((params: RunnerParams) => {
    return (async function* () {
      for (const item of await script(params)) yield item;
    })();
  });
  return { client: { beta: { messages: { toolRunner } } } as unknown as ProposeClient, toolRunner };
}

export function fakeMultiBaas(overrides: Partial<MultiBaasClient> = {}): MultiBaasClient {
  return {
    executeEventQuery: vi.fn().mockResolvedValue([]),
    callMethod: vi.fn(),
    ...overrides,
  };
}
