import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getAddress, type Address } from 'viem';

import { evaluatePolicy } from './policy';
import { AgentOutputSchema, type AgentContext } from './schema';

const repo = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

type PolicyVectors = {
  account: Address;
  valueCapUsd: number;
  baseContext: AgentContext;
  vectors: { name: string; output: unknown; context?: Partial<AgentContext>; expect: { ok: true } | { ok: false; codes: string[] } }[];
};

const schemaVectors = JSON.parse(read('docs/plans/agent-schema-vectors.json')).vectors as {
  name: string;
  valid: boolean;
  output: unknown;
}[];
const policy = JSON.parse(read('docs/plans/agent-policy-vectors.json')) as PolicyVectors;

describe('shared agent schema', () => {
  it.each(schemaVectors)('$name', ({ valid, output }) => {
    expect(AgentOutputSchema.safeParse(output).success).toBe(valid);
  });
});

describe('shared agent policy', () => {
  it.each(policy.vectors)('$name', ({ output, context: overrides, expect: expected }) => {
    const context = { ...policy.baseContext, ...overrides };
    const result = evaluatePolicy(output, context, {
      account: policy.account,
      valueCapUsd: policy.valueCapUsd,
      resolveName: (name) => {
        const entry = context.addressBook.find((item) => item.name.toLowerCase() === name.toLowerCase());
        return entry ? getAddress(entry.address) : null;
      },
    });
    if (expected.ok) {
      expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.map((item) => item.code).sort()).toEqual([...expected.codes].sort());
    }
  });
});

describe('copies of the agent service files', () => {
  const normalise = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .replace(/from '(\.\/[a-z-]+)\.ts'/g, "from '$1'");

  it.each(['schema.ts', 'policy.ts'])('%s matches agent/src apart from comments and import paths', (file) => {
    expect(normalise(read(`app/src/agent/${file}`))).toBe(normalise(read(`agent/src/${file}`)));
  });
});
