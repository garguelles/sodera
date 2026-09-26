import { getAddress, type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { evaluatePolicy, serializeEnrichedPlan } from './policy.ts';
import type { AgentContext } from './schema.ts';
import { ACCOUNT, ALICE, createContext, readVectors } from './test/fixtures.ts';

type PolicyVectors = {
  account: Address;
  valueCapUsd: number;
  baseContext: AgentContext;
  vectors: {
    name: string;
    output: unknown;
    context?: Partial<AgentContext>;
    expect: { ok: true } | { ok: false; codes: string[] };
  }[];
};

const suite = readVectors<PolicyVectors>('agent-policy-vectors.json');

function addressBookResolver(context: AgentContext) {
  return (name: string) => {
    const entry = context.addressBook.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return entry ? getAddress(entry.address) : null;
  };
}

describe('evaluatePolicy vectors', () => {
  it.each(suite.vectors)('$name', ({ output, context: overrides, expect: expected }) => {
    const context = { ...suite.baseContext, ...overrides };
    const result = evaluatePolicy(output, context, {
      account: suite.account,
      valueCapUsd: suite.valueCapUsd,
      resolveName: addressBookResolver(context),
    });
    if (expected.ok) {
      expect(result).toMatchObject({ ok: true });
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.map((violation) => violation.code).sort()).toEqual([...expected.codes].sort());
    }
  });
});

describe('evaluatePolicy details', () => {
  it('enriches a plan with resolved recipients, base units, and USD estimates', () => {
    const context = createContext({ capabilities: { ...createContext().capabilities, vault_deposit: true } });
    const result = evaluatePolicy(
      {
        kind: 'plan',
        summary: 'Send and save.',
        assumptions: [],
        actions: [
          { type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount: '0.01' },
          { type: 'vault_deposit', amount: '12.5' },
        ],
      },
      context,
      { account: ACCOUNT, valueCapUsd: 250, resolveName: addressBookResolver(context) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializeEnrichedPlan(result.plan)).toEqual({
      summary: 'Send and save.',
      assumptions: [],
      totalUsdCents: '3250',
      actions: [
        {
          action: { type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount: '0.01' },
          asset: 'ETH',
          amountBase: '10000000000000000',
          recipient: { address: getAddress(ALICE), name: 'alice' },
          usdCents: '2000',
        },
        {
          action: { type: 'vault_deposit', amount: '12.5' },
          asset: 'USDC',
          amountBase: '12500000',
          recipient: null,
          usdCents: '1250',
        },
      ],
    });
  });

  it('shows the user-facing messages from the plan', () => {
    const context = createContext();
    const result = evaluatePolicy(
      {
        kind: 'plan',
        summary: 'x',
        assumptions: [],
        actions: [{ type: 'send_usdc', recipient: { kind: 'name', value: 'bob' }, amount: '500' }],
      },
      context,
      { account: ACCOUNT, valueCapUsd: 250, resolveName: addressBookResolver(context) },
    );

    expect(result).toEqual({
      ok: false,
      violations: [
        { code: 'recipient_unresolved', actionIndex: 0, message: "I don't know who bob is." },
        { code: 'insufficient_usdc', actionIndex: 0, message: 'Not enough USDC. You have 100.' },
        { code: 'value_cap', actionIndex: null, message: 'Plans above $250 need the manual screens.' },
      ],
    });
  });
});
