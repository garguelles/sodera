import { VIOLATION_TITLES } from './violation-copy';

const CODES = [
  'schema', 'action_disabled', 'too_many_actions', 'recipient_unresolved', 'recipient_self', 'amount_precision',
  'amount_zero', 'insufficient_eth', 'insufficient_usdc', 'vault_insufficient', 'value_cap', 'sponsorship',
  'no_authority_ops', 'ungrounded',
];

describe('violation titles', () => {
  it('has a short title for every policy code', () => {
    expect(Object.keys(VIOLATION_TITLES).sort()).toEqual([...CODES].sort());
    for (const title of Object.values(VIOLATION_TITLES)) expect(title.length).toBeLessThanOrEqual(48);
  });
});
