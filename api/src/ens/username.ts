import { normalize } from 'viem/ens';

export const RESERVED_LABELS = Object.freeze([
  'admin', 'anon', 'api', 'ens', 'help', 'official', 'root', 'security',
  'sodera', 'support', 'wallet', 'www',
]);

export function parseUsername(input: string) {
  const label = input.trim();
  if (!/^[a-z](?:[a-z0-9-]{1,18}[a-z])$/.test(label)) {
    throw new Error('Use 3–20 lowercase letters, digits or internal hyphens; start and end with a letter');
  }
  const name = `${label}.sodera.eth`;
  if (normalize(name) !== name) throw new Error('Enter the canonical ENS spelling of your name');
  return { label, name, reserved: RESERVED_LABELS.includes(label) };
}
