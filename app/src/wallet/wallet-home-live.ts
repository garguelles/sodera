import { AppState } from 'react-native';
import { createPublicClient, formatEther, formatUnits, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';

import type { WalletHomeProvider } from './wallet-home';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';
import { SODERA_FIXTURE_USERNAME } from '@/onboarding/onboarding';

type SepoliaBalanceClient = {
  getChainId(): Promise<number>;
  getBalance(parameters: { address: Address }): Promise<bigint>;
  readContract(parameters: {
    address: Address;
    abi: typeof ERC20_BALANCE_ABI;
    functionName: 'balanceOf';
    args: readonly [Address];
  }): Promise<bigint>;
};

const USDC_DECIMALS = 6;
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const;

export function createWalletHomeLiveProvider({
  storage = walletIdentityNativeStorage,
  client,
}: {
  storage?: WalletIdentityStorage;
  client?: SepoliaBalanceClient;
} = {}) {
  const listeners = new Set<() => void>();
  let defaultClient: SepoliaBalanceClient | undefined;
  const getClient = () => {
    if (client) return client;
    if (defaultClient) return defaultClient;
    const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    if (!rpcUrl) throw new Error('EXPO_PUBLIC_SEPOLIA_RPC_URL is required for wallet balances');
    defaultClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    return defaultClient;
  };

  const provider: WalletHomeProvider & { refresh(): void } = {
    source: 'live',
    async load() {
      const identity = await readPersistedWalletIdentity(storage);
      const balanceClient = getClient();
      const [chainId, ethBalance, usdcBalance] = await Promise.all([
        balanceClient.getChainId(),
        balanceClient.getBalance({ address: identity.account }),
        balanceClient.readContract({
          address: SEPOLIA_USDC_ADDRESS,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [identity.account],
        }),
      ]);
      if (chainId !== sepolia.id) throw new Error('Wallet balance RPC is not Ethereum Sepolia');

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
                valueUsdCents: ethBalance === 0n ? 0 : null,
              },
              {
                id: 'sepolia-usdc',
                name: 'USD Coin',
                symbol: 'USDC',
                amount: `${formatUnits(usdcBalance, USDC_DECIMALS)} USDC`,
                valueUsdCents: getUsdcValueUsdCents(usdcBalance),
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

export const walletHomeLiveProvider = createWalletHomeLiveProvider();
