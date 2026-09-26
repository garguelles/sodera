import type { ViolationCode } from './policy';

/** Short headings for the blocked card; the violation's message is the detail line. */
export const VIOLATION_TITLES: Record<ViolationCode, string> = {
  schema: "The planner's answer couldn't be read.",
  action_disabled: "That isn't available yet.",
  too_many_actions: 'That plan has too many steps.',
  recipient_unresolved: "I don't know that recipient.",
  recipient_self: "You can't send to yourself.",
  amount_precision: 'That amount has too many decimals.',
  amount_zero: 'The amount must be more than zero.',
  insufficient_eth: "You don't have enough ETH.",
  insufficient_usdc: "You don't have enough USDC.",
  vault_insufficient: "The vault doesn't hold that much.",
  value_cap: 'That plan is too large for the assistant.',
  sponsorship: 'No sponsored operations left today.',
  no_authority_ops: "The planner's answer couldn't be read.",
  ungrounded: "Dera couldn't back up that answer.",
};
