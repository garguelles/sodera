import { AppState } from 'react-native';
import { formatEther, formatUnits, type Address } from 'viem';
import { sepolia } from 'viem/chains';

import {
  availableAfterCommitment,
  formatPositionAmounts,
  readAquaHoldings,
  trimEther,
  valueUsdCents,
  type AquaHoldings,
} from './aqua-position';
import { createMultiBaasClient, readMultiBaasConfigFromEnv } from './multibaas';
import { createMultiBaasBalanceClient } from './multibaas-balance-client';
import type { WalletHomeBalance, WalletHomePosition, WalletHomeProvider } from './wallet-home';
import { SEPOLIA_ETH_USD_FEED_ADDRESS, SEPOLIA_USDC_ADDRESS, shortenAddress } from './sepolia';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';
import { createEnsIdentityReader, type EnsIdentityReader } from '@/ens/identity-client';
import { readOnboardingProfile, type OnboardingProfileStorage } from '@/onboarding/onboarding';

export type SepoliaBalanceClient = {
  getChainId(): Promise<number>;
  getBalance(parameters: { address: Address }): Promise<bigint>;
  readContract(parameters: {
    address: Address;
    abi: typeof SEPOLIA_READ_ABI;
    functionName: 'balanceOf' | 'decimals' | 'latestRoundData';
    args?: readonly [Address];
  }): Promise<unknown>;
};

const USDC_DECIMALS = 6;
const ETH_USD_DECIMALS = 8;
const ETH_USD_MAX_AGE_SECONDS = 7_200n;
const ETH_USD_MAX_FUTURE_SECONDS = 300n;
const WEI_PER_ETH = 10n ** 18n;
export const SEPOLIA_READ_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

export function createWalletHomeLiveProvider({
  storage = walletIdentityNativeStorage,
  profileStorage,
  identityReader,
  client,
  now = Date.now,
  readEarn = readAquaHoldings,
}: {
  storage?: WalletIdentityStorage;
  profileStorage?: OnboardingProfileStorage;
  identityReader?: EnsIdentityReader;
  client?: SepoliaBalanceClient;
  now?: () => number;
  /** The wallet's WETH and open Earn position; home still loads when this read fails. */
  readEarn?: (account: Address) => Promise<AquaHoldings>;
} = {}) {
  const listeners = new Set<() => void>();
  let defaultClient: SepoliaBalanceClient | undefined;
  const getClient = () => {
    if (client) return client;
    defaultClient ??= createDefaultBalanceClient();
    return defaultClient;
  };

  const provider: WalletHomeProvider & { refresh(): void } = {
    source: 'live',
    async load() {
      const identity = await readPersistedWalletIdentity(storage);
      const profile = await readOnboardingProfile(profileStorage ?? {
        read: () => ('readOnboardingProfile' in storage && typeof storage.readOnboardingProfile === 'function'
          ? storage.readOnboardingProfile()
          : Promise.resolve(null)),
      }).catch(() => null);
      let username = shortenAddress(identity.account);
      if (profile?.claimMode === 'ens' && profile.account.toLowerCase() === identity.account.toLowerCase()) {
        try {
          if (await (identityReader ?? createEnsIdentityReader()).verify(profile.username, identity.account)) {
            username = profile.username;
          }
        } catch {
          username = shortenAddress(identity.account);
        }
      }
      const balanceClient = getClient();
      const [chainId, ethBalance, usdcBalanceResult, earn] = await Promise.all([
        balanceClient.getChainId(),
        balanceClient.getBalance({ address: identity.account }),
        balanceClient.readContract({
          address: SEPOLIA_USDC_ADDRESS,
          abi: SEPOLIA_READ_ABI,
          functionName: 'balanceOf',
          args: [identity.account],
        }),
        readEarn(identity.account).catch(() => null),
      ]);
      if (chainId !== sepolia.id) throw new Error('Wallet data is connected to the wrong network');
      if (typeof usdcBalanceResult !== 'bigint') throw new Error('Invalid USDC balance');

      const position = earn?.position ?? null;
      const needsPrice = ethBalance > 0n || (earn !== null && earn.wethBalance > 0n);
      const price = needsPrice ? await readEthUsdPrice(balanceClient, now) : null;
      const ethValueUsdCents = ethBalance === 0n ? 0 : ethValueInUsdCents(ethBalance, price);
      // Tokens committed to the Earn position stay in the wallet; count them once, under the position.
      const availableUsdc = availableAfterCommitment(usdcBalanceResult, position?.usdc ?? 0n);
      const availableWeth = availableAfterCommitment(earn?.wethBalance ?? 0n, position?.weth ?? 0n);
      const wethRows: WalletHomeBalance[] =
        availableWeth > 0n
          ? [
              {
                id: 'sepolia-weth',
                name: 'Wrapped Ether',
                symbol: 'WETH',
                amount: `${trimEther(availableWeth)} WETH`,
                valueUsdCents: ethValueInUsdCents(availableWeth, price),
              },
            ]
          : [];
      const positions: WalletHomePosition[] = position
        ? [
            {
              id: `aqua:${position.record.strategyHash}`,
              protocol: '1inch Aqua',
              name: 'USDC/WETH liquidity',
              symbol: 'USDC/WETH',
              amount: formatPositionAmounts(position),
              valueUsdCents: valueUsdCents(position, price),
            },
          ]
        : [];

      return {
        status: 'ready',
        snapshot: {
          identity: {
            username,
            address: identity.account,
            avatarUrl: null,
          },
          portfolio: {
            balances: [
              {
                id: 'sepolia-eth',
                name: 'Ethereum',
                symbol: 'ETH',
                amount: formatEthBalance(ethBalance),
                valueUsdCents: ethValueUsdCents,
              },
              {
                id: 'sepolia-usdc',
                name: position ? 'Available USD Coin' : 'USD Coin',
                symbol: 'USDC',
                amount: `${formatUnits(availableUsdc, USDC_DECIMALS)} USDC`,
                valueUsdCents: getUsdcValueUsdCents(availableUsdc),
              },
              ...wethRows,
            ],
            positions,
          },
        },
      } as const;
    },
    subscribeToChanges(listener) {
      listeners.add(listener);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') listener();
      });
      return () => {
        listeners.delete(listener);
        subscription.remove();
      };
    },
    refresh() {
      listeners.forEach((listener) => listener());
    },
  };

  return provider;
}

function formatEthBalance(balance: bigint) {
  return `${formatEther(balance)} ETH`;
}

function getUsdcValueUsdCents(balance: bigint) {
  const cents = (balance + 5_000n) / 10_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('USDC balance exceeds the supported USD display range');
  }
  return Number(cents);
}

function ethValueInUsdCents(balance: bigint, price: { answer: bigint; decimals: number } | null) {
  if (!price) return 0;
  const divisor = WEI_PER_ETH * 10n ** BigInt(price.decimals);
  const cents = (balance * price.answer * 100n + divisor / 2n) / divisor;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
  return Number(cents);
}

/**
 * The Chainlink ETH/USD answer when it is usable: 8 decimals, positive, and neither stale nor
 * from the future. Returns null otherwise, including on read failures.
 */
export async function readEthUsdPrice(
  client: SepoliaBalanceClient,
  now: () => number = Date.now,
): Promise<{ answer: bigint; decimals: number } | null> {
  try {
    const [decimals, roundData] = await Promise.all([
      client.readContract({
        address: SEPOLIA_ETH_USD_FEED_ADDRESS,
        abi: SEPOLIA_READ_ABI,
        functionName: 'decimals',
      }),
      client.readContract({
        address: SEPOLIA_ETH_USD_FEED_ADDRESS,
        abi: SEPOLIA_READ_ABI,
        functionName: 'latestRoundData',
      }),
    ]);
    if (decimals !== ETH_USD_DECIMALS || !isChainlinkRoundData(roundData)) return null;

    const [, answer, , updatedAt] = roundData;
    const nowSeconds = BigInt(Math.floor(now() / 1_000));
    if (
      answer <= 0n ||
      updatedAt === 0n ||
      updatedAt > nowSeconds + ETH_USD_MAX_FUTURE_SECONDS ||
      nowSeconds - updatedAt > ETH_USD_MAX_AGE_SECONDS
    ) {
      return null;
    }
    return { answer, decimals: ETH_USD_DECIMALS };
  } catch {
    return null;
  }
}

function isChainlinkRoundData(value: unknown): value is readonly [bigint, bigint, bigint, bigint, bigint] {
  return Array.isArray(value) && value.length === 5 && value.every((item) => typeof item === 'bigint');
}

/** Wallet balance and price reads through MultiBaas, configured from the EXPO_PUBLIC_ settings. */
export function createDefaultBalanceClient(): SepoliaBalanceClient {
  return createMultiBaasBalanceClient({
    client: createMultiBaasClient({ config: readMultiBaasConfigFromEnv() }),
  });
}

export const walletHomeLiveProvider = createWalletHomeLiveProvider();
