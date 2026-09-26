import { getAddress, isAddress, type Address } from 'viem';

export type AddressBookEntry = { name: string; address: Address };

/**
 * Placeholder address book: a fixed list from EXPO_PUBLIC_AGENT_CONTACTS
 * (`alice=0x…,bob=0x…`). Nothing is stored on the phone. A real address book or ENS
 * replaces this module without changing `list()`.
 */
export function createAddressBook(setting: string | undefined = process.env.EXPO_PUBLIC_AGENT_CONTACTS) {
  const entries = parseContacts(setting);
  return {
    list(): readonly AddressBookEntry[] {
      return entries;
    },
    find(name: string) {
      const key = name.trim().toLowerCase();
      return entries.find((entry) => entry.name === key) ?? null;
    },
  };
}

export function parseContacts(setting: string | undefined): AddressBookEntry[] {
  const entries: AddressBookEntry[] = [];
  for (const pair of (setting ?? '').split(',')) {
    const [rawName, rawAddress] = pair.split('=');
    const name = rawName?.trim().toLowerCase() ?? '';
    const address = rawAddress?.trim() ?? '';
    if (!/^[a-z0-9._-]{1,32}$/.test(name) || !isAddress(address, { strict: false })) continue;
    if (entries.some((entry) => entry.name === name)) continue;
    entries.push({ name, address: getAddress(address) });
  }
  return entries.slice(0, 50);
}

export type AddressBook = ReturnType<typeof createAddressBook>;
