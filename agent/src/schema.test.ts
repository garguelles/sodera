import { describe, expect, it } from 'vitest';

import { AgentOutputSchema, ProposeRequestSchema } from './schema.ts';
import { ACCOUNT, createContext, readVectors } from './test/fixtures.ts';

const { vectors } = readVectors<{ vectors: { name: string; valid: boolean; output: unknown }[] }>(
  'agent-schema-vectors.json',
);

describe('AgentOutputSchema', () => {
  it.each(vectors)('$name', ({ valid, output }) => {
    expect(AgentOutputSchema.safeParse(output).success).toBe(valid);
  });
});

describe('ProposeRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(
      ProposeRequestSchema.safeParse({ account: ACCOUNT, intent: 'send 0.01 eth to alice', context: createContext() })
        .success,
    ).toBe(true);
  });

  it('rejects empty or oversized intents and other chains', () => {
    const context = createContext();
    expect(ProposeRequestSchema.safeParse({ account: ACCOUNT, intent: '   ', context }).success).toBe(false);
    expect(ProposeRequestSchema.safeParse({ account: ACCOUNT, intent: 'x'.repeat(501), context }).success).toBe(false);
    expect(
      ProposeRequestSchema.safeParse({ account: ACCOUNT, intent: 'hi', context: { ...context, chainId: 1 } }).success,
    ).toBe(false);
    expect(ProposeRequestSchema.safeParse({ account: '0x12', intent: 'hi', context }).success).toBe(false);
  });
});
