import type Anthropic from '@anthropic-ai/sdk';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

import { formatUnits, parseUnits } from 'viem';

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
 * render identically. Address book entries appear by name only, and the line is left out while the
 * book is empty; recipients are resolved through ENS.
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
    `- ETH balance: ${context.balances.eth}${ethSummary(context)}`,
    `- USDC balance: ${context.balances.usdc}`,
    ...(totalUsd(context) ? [`- Total value: about $${totalUsd(context)} (ETH at the price below, plus USDC and the vault)`] : []),
    `- ETH price: ${context.prices.ethUsd === null ? 'unknown' : `$${context.prices.ethUsd}`}`,
    `- Vault: ${context.vaultPosition ? `${context.vaultPosition.assetsUsdc} USDC` : 'none'}`,
    `- Sponsored operations: ${
      context.sponsorship
        ? `${context.sponsorship.remaining} of ${context.sponsorship.limit} left, resets ${context.sponsorship.resetsAt}`
        : 'unknown'
    }`,
    `- Plan value limit: $${valueCapUsd}`,
    ...(names.length > 0 ? [`- Address book: ${names.join(', ')}`] : []),
    `- Actions: ${capabilities}`,
  ].join('\n');
}

const USD_DECIMALS = 8;

/** Rounds base units to `places` decimals, half up, for display figures the model can quote. */
export function roundUnits(value: bigint, decimals: number, places: number) {
  const step = 10n ** BigInt(decimals - places);
  return formatUnits(((value + step / 2n) / step) * step, decimals);
}

function ethUsdCents(context: AgentContext) {
  if (context.prices.ethUsd === null) return null;
  const wei = parseUnits(context.balances.eth, 18);
  const price = parseUnits(context.prices.ethUsd, USD_DECIMALS);
  return (wei * price) / 10n ** BigInt(18 + USD_DECIMALS - 2);
}

function cents(value: bigint) {
  return formatUnits(value, 2).replace(/^(\d+)$/, '$1.00').replace(/\.(\d)$/, '.$10');
}

/** Rounded ETH and its dollar value, so answers can quote them instead of computing. */
function ethSummary(context: AgentContext) {
  const rounded = roundUnits(parseUnits(context.balances.eth, 18), 18, 6);
  const usd = ethUsdCents(context);
  const parts = [...(rounded === context.balances.eth ? [] : [`about ${rounded} ETH`]), ...(usd === null ? [] : [`about $${cents(usd)}`])];
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function totalUsd(context: AgentContext) {
  const eth = ethUsdCents(context);
  if (eth === null) return null;
  const usdc = parseUnits(context.balances.usdc, 6) / 10_000n;
  const vault = context.vaultPosition ? parseUnits(context.vaultPosition.assetsUsdc, 6) / 10_000n : 0n;
  return cents(eth + usdc + vault);
}
