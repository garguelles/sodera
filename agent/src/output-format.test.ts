import { describe, expect, it } from 'vitest';

import { AGENT_OUTPUT_JSON_SCHEMA } from './output-format.ts';
import { AgentOutputSchema } from './schema.ts';
import { readVectors } from './test/fixtures.ts';

type Schema = Record<string, unknown>;

/** Validates the JSON-schema subset structured outputs support. */
function matches(schema: Schema, value: unknown): boolean {
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as Schema[]).some((option) => matches(option, value));
  if ('const' in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value) && value.every((item) => matches(schema.items as Schema, item));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const properties = schema.properties as Record<string, Schema>;
      const record = value as Record<string, unknown>;
      if (!(schema.required as string[]).every((key) => key in record)) return false;
      return Object.entries(record).every(([key, item]) => key in properties && matches(properties[key]!, item));
    }
    default:
      return true;
  }
}

const { vectors } = readVectors<{ vectors: { name: string; valid: boolean; output: unknown }[] }>(
  'agent-schema-vectors.json',
);

describe('AGENT_OUTPUT_JSON_SCHEMA', () => {
  it('uses no $defs or $ref, which structured outputs reject inside anyOf', () => {
    const text = JSON.stringify(AGENT_OUTPUT_JSON_SCHEMA);
    expect(text).not.toContain('$defs');
    expect(text).not.toContain('$ref');
  });

  it.each(vectors.filter((vector) => vector.valid))('accepts valid vector: $name', ({ output }) => {
    expect(matches(AGENT_OUTPUT_JSON_SCHEMA, output)).toBe(true);
  });

  it.each(vectors.filter((vector) => !vector.valid && !matches(AGENT_OUTPUT_JSON_SCHEMA, vector.output)))(
    'rejects structurally invalid vector: $name',
    ({ output }) => {
      expect(AgentOutputSchema.safeParse(output).success).toBe(false);
    },
  );
});
