import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem';

import {
  ACTION_TYPES,
  AgentOutputSchema,
  type Action,
  type ActionType,
  type AgentContext,
} from './schema.ts';

// Keep this file identical in behaviour to app/src/agent/policy.ts. Both suites assert
// docs/plans/agent-policy-vectors.json.

export type ViolationCode =
  | 'schema'
  | 'action_disabled'
  | 'too_many_actions'
  | 'recipient_unresolved'
  | 'recipient_self'
  | 'amount_precision'
  | 'amount_zero'
  | 'insufficient_eth'
  | 'insufficient_usdc'
  | 'vault_insufficient'
  | 'value_cap'
  | 'sponsorship'
  | 'no_authority_ops'
  /** An answer quoted a figure that no tool result or snapshot line contains. */
  | 'ungrounded';

export type Violation = { code: ViolationCode; actionIndex: number | null; message: string };

type Asset = 'ETH' | 'USDC';

export type EnrichedAction = {
  action: Action;
  asset: Asset;
  /** Base units of the asset leaving or entering the wallet; 'all' for a full vault withdrawal. */
  amountBase: bigint | 'all';
  recipient: { address: Address; name: string | null } | null;
  /** Estimated USD value of the outgoing asset, in cents; null when no price is known. */
  usdCents: bigint | null;
};

export type EnrichedPlan = {
  summary: string;
  assumptions: string[];
  actions: EnrichedAction[];
  totalUsdCents: bigint;
};

export type PolicyResult = { ok: true; plan: EnrichedPlan } | { ok: false; violations: Violation[] };

export type PolicyOptions = {
  account: Address;
  valueCapUsd: number;
  /**
   * Resolves a recipient name. The service passes the address book plus any names the
   * `resolve_name` tool resolved during this request; the app adds its ENS resolver.
   */
  resolveName: (name: string) => Address | null;
};

export const ETH_RESERVE_WEI = parseUnits('0.0005', 18);
const DECIMALS: Record<Asset, number> = { ETH: 18, USDC: 6 };
const DISABLED_MESSAGES: Record<ActionType, string> = {
  send_eth: 'Sending ETH is not available yet.',
  send_usdc: 'Sending USDC is not available yet.',
  swap: 'Swaps are not available yet.',
  vault_deposit: 'Vault deposits are not available yet.',
  vault_withdraw: 'Vault withdrawals are not available yet.',
};
const SCHEMA_MESSAGE = 'The assistant returned something the wallet cannot read.';

export function evaluatePolicy(
  output: unknown,
  context: AgentContext,
  options: PolicyOptions,
): PolicyResult {
  const parsed = AgentOutputSchema.safeParse(output);
  if (!parsed.success) return fail([{ code: 'schema', actionIndex: null, message: SCHEMA_MESSAGE }]);
  if (parsed.data.kind !== 'plan') {
    return fail([{ code: 'schema', actionIndex: null, message: SCHEMA_MESSAGE }]);
  }
  const proposal = parsed.data;
  const violations: Violation[] = [];

  proposal.actions.forEach((action, index) => {
    if (!(ACTION_TYPES as readonly string[]).includes(action.type)) {
      violations.push({ code: 'no_authority_ops', actionIndex: index, message: SCHEMA_MESSAGE });
    }
  });
  if (violations.length > 0) return fail(violations);

  const swapCount = proposal.actions.filter((action) => action.type === 'swap').length;
  if (proposal.actions.length > 4 || swapCount > 1) {
    violations.push({
      code: 'too_many_actions',
      actionIndex: null,
      message: 'Plans are limited to four steps and one swap.',
    });
  }

  const enriched: EnrichedAction[] = [];
  proposal.actions.forEach((action, index) => {
    if (!context.capabilities[action.type]) {
      violations.push({ code: 'action_disabled', actionIndex: index, message: DISABLED_MESSAGES[action.type] });
    }

    const asset = assetOf(action);
    const rawAmount = amountOf(action);
    let amountBase: bigint | 'all' = 'all';
    if (rawAmount !== 'all') {
      const fraction = rawAmount.split('.')[1] ?? '';
      if (fraction.length > DECIMALS[asset]) {
        violations.push({
          code: 'amount_precision',
          actionIndex: index,
          message: `${asset} amounts can have at most ${DECIMALS[asset]} decimals.`,
        });
        return;
      }
      amountBase = parseUnits(rawAmount, DECIMALS[asset]);
      if (amountBase <= 0n) {
        violations.push({ code: 'amount_zero', actionIndex: index, message: 'Amounts must be greater than zero.' });
      }
    }

    let recipient: EnrichedAction['recipient'] = null;
    if (action.type === 'send_eth' || action.type === 'send_usdc') {
      const resolved =
        action.recipient.kind === 'address'
          ? isAddress(action.recipient.value, { strict: false })
            ? { address: getAddress(action.recipient.value), name: null }
            : null
          : resolveNamed(action.recipient.value, options.resolveName);
      if (!resolved) {
        violations.push({
          code: 'recipient_unresolved',
          actionIndex: index,
          message: `I don't know who ${action.recipient.value} is.`,
        });
      } else if (resolved.address.toLowerCase() === options.account.toLowerCase()) {
        violations.push({ code: 'recipient_self', actionIndex: index, message: 'That would send to yourself.' });
      } else {
        recipient = resolved;
      }
    }

    enriched.push({ action, asset, amountBase, recipient, usdCents: null });
  });

  const balances = {
    eth: parseUnits(context.balances.eth, 18),
    usdc: parseUnits(context.balances.usdc, 6),
  };
  const vaultAssets = context.vaultPosition ? parseUnits(context.vaultPosition.assetsUsdc, 6) : 0n;

  // ETH: everything that leaves the wallet plus a gas reserve.
  const ethOut = enriched.reduce(
    (total, item) => (isOutgoing(item) && item.asset === 'ETH' && item.amountBase !== 'all' ? total + item.amountBase : total),
    0n,
  );
  if (ethOut > 0n && ethOut + ETH_RESERVE_WEI > balances.eth) {
    const needed = `You have ${context.balances.eth} ETH. This plan needs ${formatUnits(ethOut, 18)} ETH`;
    violations.push({
      code: 'insufficient_eth',
      actionIndex: null,
      message: ethOut <= balances.eth ? `${needed} and keeps ${formatUnits(ETH_RESERVE_WEI, 18)} ETH for fees.` : `${needed}.`,
    });
  }

  // USDC: plan order; withdrawals add, swap outputs do not.
  const usdcOut = enriched.reduce(
    (total, item) => (isOutgoing(item) && item.asset === 'USDC' && item.amountBase !== 'all' ? total + item.amountBase : total),
    0n,
  );
  let usdcAvailable = balances.usdc;
  for (const item of enriched) {
    if (item.action.type === 'vault_withdraw') {
      usdcAvailable += item.amountBase === 'all' ? vaultAssets : item.amountBase;
      continue;
    }
    if (!isOutgoing(item) || item.asset !== 'USDC' || item.amountBase === 'all') continue;
    usdcAvailable -= item.amountBase;
    if (usdcAvailable < 0n) {
      violations.push({
        code: 'insufficient_usdc',
        actionIndex: proposal.actions.indexOf(item.action),
        message: `You have ${context.balances.usdc} USDC. This plan needs ${formatUnits(usdcOut, 6)} USDC.`,
      });
      break;
    }
  }

  for (const item of enriched) {
    if (item.action.type !== 'vault_withdraw' || item.amountBase === 'all') continue;
    if (item.amountBase > vaultAssets) {
      violations.push({
        code: 'vault_insufficient',
        actionIndex: proposal.actions.indexOf(item.action),
        message: `The vault holds only ${formatUnits(vaultAssets, 6)} USDC.`,
      });
    }
  }

  // Value cap over everything that leaves the wallet.
  const ethUsdCentsPerEth = context.prices.ethUsd === null ? null : parseUnits(context.prices.ethUsd, 2);
  let totalUsdCents = 0n;
  let unpriced = false;
  for (const item of enriched) {
    if (!isOutgoing(item) || item.amountBase === 'all') continue;
    if (item.asset === 'USDC') {
      item.usdCents = item.amountBase / 10_000n;
    } else if (ethUsdCentsPerEth !== null) {
      item.usdCents = (item.amountBase * ethUsdCentsPerEth) / 10n ** 18n;
    } else {
      unpriced = true;
      continue;
    }
    totalUsdCents += item.usdCents;
  }
  if (unpriced) {
    violations.push({
      code: 'value_cap',
      actionIndex: null,
      message: `The ETH price is unavailable, so this plan can't be checked against the $${options.valueCapUsd} limit.`,
    });
  } else if (totalUsdCents > BigInt(options.valueCapUsd) * 100n) {
    violations.push({
      code: 'value_cap',
      actionIndex: null,
      message: `Plans above $${options.valueCapUsd} need the manual screens.`,
    });
  }

  if (context.sponsorship && context.sponsorship.remaining < 1) {
    violations.push({
      code: 'sponsorship',
      actionIndex: null,
      message: `No sponsored operations left today. Resets at ${context.sponsorship.resetsAt}.`,
    });
  }

  if (violations.length > 0) return fail(violations);
  return {
    ok: true,
    plan: { summary: proposal.summary, assumptions: proposal.assumptions, actions: enriched, totalUsdCents },
  };
}

function fail(violations: Violation[]): PolicyResult {
  return { ok: false, violations };
}

function assetOf(action: Action): Asset {
  switch (action.type) {
    case 'send_eth':
      return 'ETH';
    case 'swap':
      return action.direction === 'eth_to_usdc' ? 'ETH' : 'USDC';
    default:
      return 'USDC';
  }
}

function amountOf(action: Action): string {
  return action.type === 'swap' ? action.amountIn : action.amount;
}

/** Sends, swap inputs, and vault deposits leave the spendable balance. */
function isOutgoing(item: EnrichedAction) {
  return item.action.type !== 'vault_withdraw';
}

function resolveNamed(name: string, resolveName: PolicyOptions['resolveName']) {
  const address = resolveName(name);
  return address ? { address: getAddress(address), name } : null;
}

/** JSON form of an enriched plan: bigints as decimal strings. */
export function serializeEnrichedPlan(plan: EnrichedPlan) {
  return {
    summary: plan.summary,
    assumptions: plan.assumptions,
    totalUsdCents: plan.totalUsdCents.toString(),
    actions: plan.actions.map((item) => ({
      action: item.action,
      asset: item.asset,
      amountBase: item.amountBase === 'all' ? 'all' : item.amountBase.toString(),
      recipient: item.recipient,
      usdCents: item.usdCents === null ? null : item.usdCents.toString(),
    })),
  };
}
