import type { Address } from 'viem';

import type { WalletHomeProvider, WalletHomeResult } from './wallet-home';

export const populatedWalletHomeFixture: WalletHomeResult = {
  status: 'ready',
  snapshot: {
    identity: {
      username: 'alex.sodera.eth',
      address: '0x7A36a07E7B97e8A4d1C5f6629A7E9f8d7e70C304' as Address,
      avatarUrl: null,
    },
    portfolio: {
      totalValueUsd: '$3,045.00',
      balances: [
        {
          id: 'sepolia-eth',
          name: 'Ethereum',
          symbol: 'ETH',
          amount: '0.8200 ETH',
          valueUsd: '$2,050.00',
        },
        {
          id: 'sepolia-usdc',
          name: 'USD Coin',
          symbol: 'USDC',
          amount: '245.00 USDC',
          valueUsd: '$245.00',
        },
      ],
      positions: [
        {
          id: 'morpho-curated-usdc',
          protocol: 'Morpho',
          name: 'Curated USDC vault',
          symbol: 'USDC',
          amount: '750.00 USDC',
          valueUsd: '$750.00',
        },
      ],
    },
  },
};

export function createWalletHomeFixtureProvider(
  initialResult: WalletHomeResult = populatedWalletHomeFixture,
) {
  let result = initialResult;
  const listeners = new Set<() => void>();

  const provider: WalletHomeProvider & { update(nextResult: WalletHomeResult): void } = {
    source: 'fixture',
    async load() {
      return result;
    },
    subscribeToChanges(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(nextResult) {
      result = nextResult;
      listeners.forEach((listener) => listener());
    },
  };

  return provider;
}

export const walletHomeFixtureProvider = createWalletHomeFixtureProvider();
