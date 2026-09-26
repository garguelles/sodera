import { isAddress } from 'viem';
import { z } from 'zod';

// The agent output schema is the contract between this service and the app. Keep the part
// between the markers byte-identical to app/src/agent/schema.ts.
// --- shared schema start ---
const decimalAmount = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/);
const recipient = z.object({
  kind: z.enum(['address', 'name']),
  value: z.string().min(1).max(255),
});

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_eth'), recipient, amount: decimalAmount }),
  z.object({ type: z.literal('send_usdc'), recipient, amount: decimalAmount }),
  z.object({
    type: z.literal('swap'),
    direction: z.enum(['eth_to_usdc', 'usdc_to_eth']),
    amountIn: decimalAmount,
  }),
  z.object({ type: z.literal('vault_deposit'), amount: decimalAmount }),
  z.object({ type: z.literal('vault_withdraw'), amount: z.union([decimalAmount, z.literal('all')]) }),
]);

export const ProposalSchema = z.object({
  kind: z.literal('plan'),
  summary: z.string().min(1).max(280),
  actions: z.array(ActionSchema).min(1).max(4),
  assumptions: z.array(z.string().max(160)).max(5),
});

export const ClarificationSchema = z.object({
  kind: z.literal('clarification'),
  question: z.string().min(1).max(200),
});

export const AnswerSchema = z.object({
  kind: z.literal('answer'),
  text: z.string().min(1).max(400),
  facts: z
    .array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(60) }))
    .max(4),
});

export const AgentOutputSchema = z.discriminatedUnion('kind', [ProposalSchema, ClarificationSchema, AnswerSchema]);
// --- shared schema end ---

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
export type Proposal = z.infer<typeof ProposalSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export const ACTION_TYPES = ['send_eth', 'send_usdc', 'swap', 'vault_deposit', 'vault_withdraw'] as const;

const address = z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid address');
const decimalString = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/);

export const AgentContextSchema = z.object({
  chainId: z.literal(11155111),
  now: z.iso.datetime({ offset: true }),
  balances: z.object({ eth: decimalString, usdc: decimalString }),
  prices: z.object({ ethUsd: decimalString.nullable() }),
  vaultPosition: z.object({ assetsUsdc: decimalString }).nullable(),
  sponsorship: z
    .object({
      remaining: z.number().int().min(0),
      limit: z.number().int().min(0),
      resetsAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
  addressBook: z
    .array(z.object({ name: z.string().min(1).max(32), address }))
    .max(50),
  capabilities: z.object({
    send_eth: z.boolean(),
    send_usdc: z.boolean(),
    swap: z.boolean(),
    vault_deposit: z.boolean(),
    vault_withdraw: z.boolean(),
  }),
});

export type AgentContext = z.infer<typeof AgentContextSchema>;

export const ProposeRequestSchema = z.object({
  account: address,
  intent: z.string().trim().min(1).max(500),
  context: AgentContextSchema,
  reset: z.boolean().optional(),
});

export type ProposeRequest = z.infer<typeof ProposeRequestSchema>;
