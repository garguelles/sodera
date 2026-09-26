import { normalize } from 'viem/ens';

const RESERVED_LABELS = new Set([
  'admin',
  'anon',
  'api',
  'ens',
  'help',
  'official',
  'root',
  'security',
  'sodera',
  'support',
  'wallet',
  'www',
]);

const LABEL_PATTERN = /^[a-z](?:[a-z0-9-]{1,18}[a-z])$/;

export const SODERA_NAME_SUFFIX = '.sodera.eth';
export const SODERA_RESERVED_LABELS = Object.freeze([...RESERVED_LABELS]);

export function parseSoderaUsername(input: string): { label: string; name: string } {
  const label = input.trim();
  if (!LABEL_PATTERN.test(label)) {
    throw new Error('Use 3–20 lowercase letters, digits or internal hyphens; start and end with a letter');
  }
  const name = `${label}${SODERA_NAME_SUFFIX}`;
  if (normalize(name) !== name) throw new Error('Enter the canonical ENS spelling of your name');
  if (RESERVED_LABELS.has(label)) throw new Error('This Sodera name is reserved');
  return { label, name };
}
