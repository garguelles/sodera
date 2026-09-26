import type Anthropic from '@anthropic-ai/sdk';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

import { AGENT_OUTPUT_FORMAT } from './output-format.ts';
import { AgentOutputSchema, type AgentContext, type AgentOutput } from './schema.ts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Usage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };

export type ProposeResult =
  | { kind: 'output'; output: AgentOutput; text: string; model: string; usage: Usage }
  | { kind: 'refused'; model: string; usage: Usage }
  | { kind: 'invalid'; model: string; usage: Usage };

export type ProposeClient = Pick<Anthropic, 'beta'>;

export async function propose({
  client,
  model,
  effort,
  systemPrompt,
  tools,
  transcript,
  intent,
  context,
  valueCapUsd,
}: {
  client: ProposeClient;
  model: string;
  effort: Effort;
  systemPrompt: string;
  tools: BetaRunnableTool<any>[];
  transcript: Anthropic.Beta.BetaMessageParam[];
  intent: string;
  context: AgentContext;
  valueCapUsd: number;
}): Promise<ProposeResult> {
  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    max_iterations: 8,
    output_config: { effort, format: AGENT_OUTPUT_FORMAT },
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: [...transcript, { role: 'user', content: renderUserMessage(intent, context, valueCapUsd) }],
  });

  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
  let final: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadInputTokens += message.usage.cache_read_input_tokens ?? 0;
    final = message;
  }
  if (!final) throw new Error('Agent returned no message');

  if (final.stop_reason === 'refusal') return { kind: 'refused', model: final.model, usage };
  if (final.stop_reason === 'max_tokens') throw new Error('Agent output was cut off');

  const text = [...final.content].reverse().find((block) => block.type === 'text');
  if (!text || text.type !== 'text') return { kind: 'invalid', model: final.model, usage };
  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    return { kind: 'invalid', model: final.model, usage };
  }
  const parsed = AgentOutputSchema.safeParse(json);
  if (!parsed.success) return { kind: 'invalid', model: final.model, usage };
  return { kind: 'output', output: parsed.data, text: text.text, model: final.model, usage };
}

/**
 * The volatile part of the request. Deterministic for a given input so identical requests
 * render identically. Address book entries appear by name only; the service resolves them.
 */
export function renderUserMessage(intent: string, context: AgentContext, valueCapUsd: number) {
  const capabilities = Object.entries(context.capabilities)
    .map(([action, enabled]) => `${action}=${enabled ? 'available' : 'unavailable'}`)
    .join(', ');
  const names = context.addressBook.map((entry) => entry.name).sort();
  return [
    `Request: ${intent}`,
    '',
    'Wallet snapshot:',
    `- Time: ${context.now}`,
    `- ETH balance: ${context.balances.eth}`,
    `- USDC balance: ${context.balances.usdc}`,
    `- ETH price: ${context.prices.ethUsd === null ? 'unknown' : `$${context.prices.ethUsd}`}`,
    `- Vault: ${context.vaultPosition ? `${context.vaultPosition.assetsUsdc} USDC` : 'none'}`,
    `- Sponsored operations: ${
      context.sponsorship
        ? `${context.sponsorship.remaining} of ${context.sponsorship.limit} left, resets ${context.sponsorship.resetsAt}`
        : 'unknown'
    }`,
    `- Plan value limit: $${valueCapUsd}`,
    `- Address book: ${names.length > 0 ? names.join(', ') : 'empty'}`,
    `- Actions: ${capabilities}`,
  ].join('\n');
}
