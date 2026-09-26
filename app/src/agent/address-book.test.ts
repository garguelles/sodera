import { getAddress } from 'viem';

import { createAddressBook, parseContacts } from './address-book';

const ALICE = '0x2222222222222222222222222222222222222222';
const BOB = '0x3333333333333333333333333333333333333333';

describe('placeholder address book', () => {
  it('parses name=address pairs, lowercasing and deduplicating names', () => {
    expect(parseContacts(` Alice=${ALICE}, bob=${BOB.toUpperCase().replace('0X', '0x')},alice=${BOB}`)).toEqual([
      { name: 'alice', address: getAddress(ALICE) },
      { name: 'bob', address: getAddress(BOB) },
    ]);
  });

  it('skips malformed pairs and returns an empty list when unset', () => {
    expect(parseContacts(`noequals,=${ALICE},carol=0x1234,${'x'.repeat(33)}=${ALICE}`)).toEqual([]);
    expect(parseContacts(undefined)).toEqual([]);
  });

  it('finds entries by name case-insensitively', () => {
    const book = createAddressBook(`alice=${ALICE}`);
    expect(book.find(' ALICE ')).toEqual({ name: 'alice', address: getAddress(ALICE) });
    expect(book.find('bob')).toBeNull();
  });
});
