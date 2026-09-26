import { AppState } from 'react-native';
import { formatEther, formatUnits, type Address } from 'viem';
import { sepolia } from 'viem/chains';

import { createMultiBaasClient, readMultiBaasConfigFromEnv } from './multibaas';
import { createMultiBaasBalanceClient } from './multibaas-balance-client';
import type { WalletHomeProvider } from './wallet-home';
import { SEPOLIA_ETH_USD_FEED_ADDRESS, SEPOLIA_USDC_ADDRESS } from './sepolia';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';
import { SODERA_FIXTURE_USERNAME } from '@/onboarding/onboarding';

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
  client,
  now = Date.now,
}: {
  storage?: WalletIdentityStorage;
  client?: SepoliaBalanceClient;
  now?: () => number;
} = {}) {
  const listeners = new Set<() => void>();
  let defaultClient: SepoliaBalanceClient | undefined;
  const getClient = () => {
    if (client) return client;
    if (defaultClient) return defaultClient;
    defaultClient = createMultiBaasBalanceClient({
      client: createMultiBaasClient({ config: readMultiBaasConfigFromEnv() }),
    });
    return defaultClient;
  };

  const provider: WalletHomeProvider & { refresh(): void } = {
    source: 'live',
    async load() {
      const identity = await readPersistedWalletIdentity(storage);
      const balanceClient = getClient();
      const [chainId, ethBalance, usdcBalanceResult] = await Promise.all([
        balanceClient.getChainId(),
        balanceClient.getBalance({ address: identity.account }),
        balanceClient.readContract({
          address: SEPOLIA_USDC_ADDRESS,
          abi: SEPOLIA_READ_ABI,
          functionName: 'balanceOf',
          args: [identity.account],
        }),
      ]);
      if (chainId !== sepolia.id) throw new Error('MultiBaas deployment is not Ethereum Sepolia');
      if (typeof usdcBalanceResult !== 'bigint') throw new Error('Invalid Sepolia USDC balance');

      const ethValueUsdCents =
        ethBalance === 0n ? 0 : await readEthValueUsdCents(balanceClient, ethBalance, now);

      return {
        status: 'ready',
        snapshot: {
          identity: {
            username: SODERA_FIXTURE_USERNAME,
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
                name: 'USD Coin',
                symbol: 'USDC',
                amount: `${formatUnits(usdcBalanceResult, USDC_DECIMALS)} USDC`,
                valueUsdCents: getUsdcValueUsdCents(usdcBalanceResult),
              },
            ],
            positions: [],
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

async function readEthValueUsdCents(
  client: SepoliaBalanceClient,
  balance: bigint,
  now: () => number,
) {
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
    if (decimals !== ETH_USD_DECIMALS || !isChainlinkRoundData(roundData)) return 0;

    const [, answer, , updatedAt] = roundData;
    const nowSeconds = BigInt(Math.floor(now() / 1_000));
    if (
      answer <= 0n ||
      updatedAt === 0n ||
      updatedAt > nowSeconds + ETH_USD_MAX_FUTURE_SECONDS ||
      nowSeconds - updatedAt > ETH_USD_MAX_AGE_SECONDS
    ) {
      return 0;
    }

    const divisor = WEI_PER_ETH * 10n ** BigInt(decimals);
    const cents = (balance * answer * 100n + divisor / 2n) / divisor;
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
    return Number(cents);
  } catch {
    return 0;
  }
}

function isChainlinkRoundData(value: unknown): value is readonly [bigint, bigint, bigint, bigint, bigint] {
  return Array.isArray(value) && value.length === 5 && value.every((item) => typeof item === 'bigint');
}

export const walletHomeLiveProvider = createWalletHomeLiveProvider();
