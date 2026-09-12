import { AppState } from 'react-native';
import { createPublicClient, formatEther, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';

import type { WalletHomeProvider } from './wallet-home';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';

type SepoliaBalanceClient = {
  getChainId(): Promise<number>;
  getBalance(parameters: { address: Address }): Promise<bigint>;
};

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
      const [chainId, balance] = await Promise.all([
        balanceClient.getChainId(),
        balanceClient.getBalance({ address: identity.account }),
      ]);
      if (chainId !== sepolia.id) throw new Error('Wallet balance RPC is not Ethereum Sepolia');

      return {
        status: 'ready',
        snapshot: {
          identity: {
            username: 'anon.sodera.eth',
            address: identity.account,
            avatarUrl: null,
          },
          portfolio: {
            balances: [
              {
                id: 'sepolia-eth',
                name: 'Ethereum',
                symbol: 'ETH',
                amount: formatEthBalance(balance),
                valueUsdCents: null,
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

export const walletHomeLiveProvider = createWalletHomeLiveProvider();
