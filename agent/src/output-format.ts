/**
 * JSON schema sent as `output_config.format`. Hand-written because structured outputs reject
 * `$defs` inside `anyOf`, which the SDK's Zod converter emits for reused sub-schemas, and the
 * converter also demotes `const` and `enum` to descriptions. This schema uses only what
 * structured outputs support (type, const, enum, anyOf, required, additionalProperties: false).
 * Patterns and lengths are enforced afterwards by `AgentOutputSchema`; a test keeps the two in
 * agreement on the shared vectors.
 */

const amount = {
  type: 'string',
  description: 'Decimal amount in the asset\'s own units, such as "5" or "0.01". Never base units.',
};

const recipient = () => ({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['address', 'name'] },
    value: { type: 'string', description: 'A 0x address the user typed, or a name.' },
  },
  required: ['kind', 'value'],
  additionalProperties: false,
});

const action = (type: string, properties: Record<string, unknown>) => ({
  type: 'object',
  properties: { type: { type: 'string', const: type }, ...properties },
  required: ['type', ...Object.keys(properties)],
  additionalProperties: false,
});

export const AGENT_OUTPUT_JSON_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'plan' },
        summary: { type: 'string', description: 'One or two plain sentences, at most 280 characters.' },
        actions: {
          type: 'array',
          description: 'One to four actions, in the order they run.',
          items: {
            anyOf: [
              action('send_eth', { recipient: recipient(), amount }),
              action('send_usdc', { recipient: recipient(), amount }),
              action('swap', {
                direction: { type: 'string', enum: ['eth_to_usdc', 'usdc_to_eth'] },
                amountIn: amount,
              }),
              action('vault_deposit', { amount }),
              action('vault_withdraw', {
                amount: { type: 'string', description: 'Decimal USDC amount, or "all" to empty the vault.' },
              }),
            ],
          },
        },
        assumptions: {
          type: 'array',
          description: 'Up to five short notes on anything inferred.',
          items: { type: 'string' },
        },
      },
      required: ['kind', 'summary', 'actions', 'assumptions'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'clarification' },
        question: { type: 'string', description: 'One question, at most 200 characters.' },
      },
      required: ['kind', 'question'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'answer' },
        text: { type: 'string', description: 'One to three plain sentences, at most 400 characters.' },
        facts: {
          type: 'array',
          description: 'Up to four key figures, each copied from a tool result or the snapshot.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'At most 40 characters, such as "Sent to alice".' },
              value: { type: 'string', description: 'At most 60 characters, such as "42.5 USDC".' },
            },
            required: ['label', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'text', 'facts'],
      additionalProperties: false,
    },
  ],
} as const;

export const AGENT_OUTPUT_FORMAT = { type: 'json_schema' as const, schema: AGENT_OUTPUT_JSON_SCHEMA };
