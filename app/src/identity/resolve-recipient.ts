import { getAddress, isAddress, type Address } from 'viem';

/**
 * Seam for ENS resolution (PRA-200, PRA-209). Until it lands, only hex addresses resolve;
 * names come from the placeholder address book instead.
 */
export async function resolveRecipient(input: string): Promise<{ address: Address; name: string | null }> {
  const value = input.trim();
  if (isAddress(value, { strict: false })) return { address: getAddress(value), name: null };
  throw new Error('Not implemented: PRA-200 ENS resolution');
}
