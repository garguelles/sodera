import Storage from 'expo-sqlite/kv-store';
import { erc20Abi, formatEther, formatUnits, type Address, type Hash, type Hex } from 'viem';

import { aquaAbi } from './aqua-calls';
import { sepoliaClient } from './send-transfer';
import { SEPOLIA_AQUA_ADDRESS, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS } from './sepolia';

const STORAGE_KEY = 'sodera:aqua-position:v1';
// Aqua's tokensCount: 0 = never shipped, 0xff = docked, otherwise the active strategy's token count.
const AQUA_DOCKED = 0xff;
const WEI_PER_ETH = 10n ** 18n;
const MICRO_USDC_PER_CENT = 10_000n;

/** The one Earn position a wallet has open. On-chain balances stay the source of truth. */
export type AquaPositionRecord = {
  account: Address;
  order: Hex;
  strategyHash: Hash;
  /** Opening amounts in base units, as decimal strings. */
  usdcAmount: string;
  wethAmount: string;
  openedAt: string;
  transactionHash: Hash | null;
};

export type AquaPositionState = {
  record: AquaPositionRecord;
  status: 'active' | 'docked' | 'unknown';
  /** Current virtual balances: what the position holds after trades. */
  usdc: bigint;
  weth: bigint;
};

export type EthUsdPrice = { answer: bigint; decimals: number };

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<unknown>;
};

export type AquaReadClient = {
  readContract(parameters: {
    address: Address;
    abi: typeof aquaAbi | typeof erc20Abi;
    functionName: 'rawBalances' | 'balanceOf';
    args: readonly unknown[];
  }): Promise<unknown>;
};

export function createAquaPositionStore({ storage = Storage }: { storage?: KeyValueStorage } = {}) {
  return {
    async read(account: Address): Promise<AquaPositionRecord | null> {
      const value = await storage.getItem(STORAGE_KEY);
      if (!value) return null;
      const record = JSON.parse(value) as AquaPositionRecord;
      return record.account.toLowerCase() === account.toLowerCase() ? record : null;
    },
    save(record: AquaPositionRecord) {
      return storage.setItem(STORAGE_KEY, JSON.stringify(record));
    },
    clear() {
      return storage.removeItem(STORAGE_KEY);
    },
  };
}

export const aquaPositionStore = createAquaPositionStore();

/** Reads the position's current virtual balances from Aqua. */
export async function readAquaPosition(
  client: AquaReadClient,
  record: AquaPositionRecord,
): Promise<AquaPositionState> {
  const [usdc, weth] = await Promise.all(
    [SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS].map(async (token) => {
      const result = await client.readContract({
        address: SEPOLIA_AQUA_ADDRESS,
        abi: aquaAbi,
        functionName: 'rawBalances',
        args: [record.account, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, record.strategyHash, token],
      });
      const [balance, tokensCount] = result as readonly [bigint, number];
      return { balance, tokensCount };
    }),
  );
  const status =
    usdc.tokensCount === AQUA_DOCKED ? 'docked' : usdc.tokensCount === 2 && weth.tokensCount === 2 ? 'active' : 'unknown';
  return { record, status, usdc: usdc.balance, weth: weth.balance };
}

export type AquaHoldings = { wethBalance: bigint; position: AquaPositionState | null };

/** The wallet's WETH and its open Earn position, if Aqua still reports it active. */
export async function readAquaHoldings(
  account: Address,
  {
    client = rpcReadClient(),
    store = aquaPositionStore,
  }: { client?: AquaReadClient; store?: Pick<typeof aquaPositionStore, 'read'> } = {},
): Promise<AquaHoldings> {
  const record = await store.read(account);
  const [wethBalance, position] = await Promise.all([
    readWethBalance(client, account),
    record ? readAquaPosition(client, record) : null,
  ]);
  return { wethBalance, position: position?.status === 'active' ? position : null };
}

/** Aqua and WETH are not linked in MultiBaas, so these reads go to the Sepolia RPC. */
export function rpcReadClient(): AquaReadClient {
  const client = sepoliaClient();
  return { readContract: (parameters) => client.readContract(parameters as never) };
}

/** The wallet's WETH, which the home screen and the Earn form need beside ETH and USDC. */
export async function readWethBalance(client: AquaReadClient, account: Address) {
  const balance = await client.readContract({
    address: SEPOLIA_WETH_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  });
  if (typeof balance !== 'bigint') throw new Error('Invalid Sepolia WETH balance');
  return balance;
}

/** USDC at a fixed USD 1 plus WETH at the Chainlink price, in cents. WETH counts as 0 without a price. */
export function valueUsdCents({ usdc, weth }: { usdc: bigint; weth: bigint }, price: EthUsdPrice | null) {
  // Round to the nearest cent, as the home screen's balance values do.
  const usdcCents = (usdc + MICRO_USDC_PER_CENT / 2n) / MICRO_USDC_PER_CENT;
  const wethDivisor = price ? WEI_PER_ETH * 10n ** BigInt(price.decimals) : 1n;
  const wethCents = price ? (weth * price.answer * 100n + wethDivisor / 2n) / wethDivisor : 0n;
  return Number(usdcCents + wethCents);
}

/**
 * Value now minus what the opening amounts would be worth if simply held, both at today's price:
 * the fees the position collected, less impermanent loss.
 */
export function earnedVsHoldingUsdCents(position: AquaPositionState, price: EthUsdPrice | null) {
  if (!price) return null;
  const opened = { usdc: BigInt(position.record.usdcAmount), weth: BigInt(position.record.wethAmount) };
  return valueUsdCents(position, price) - valueUsdCents(opened, price);
}

/** WETH to open a position of `usdc` at the Chainlink price, so the pool opens at Sodera's displayed price. */
export function wethForUsdc(usdc: bigint, price: EthUsdPrice) {
  return (usdc * 10n ** 12n * 10n ** BigInt(price.decimals)) / price.answer;
}

/** What the wallet holds beyond what an active position has committed. */
export function availableAfterCommitment(walletBalance: bigint, committed: bigint) {
  return walletBalance > committed ? walletBalance - committed : 0n;
}

export function formatPositionAmounts({ usdc, weth }: { usdc: bigint; weth: bigint }) {
  return `${formatUnits(usdc, 6)} USDC + ${trimEther(weth)} WETH`;
}

export function trimEther(wei: bigint, digits = 6) {
  const [whole, fraction = ''] = formatEther(wei).split('.');
  const trimmed = fraction.slice(0, digits).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
