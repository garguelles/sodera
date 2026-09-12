import type { Address } from 'viem';

import type { WalletHomeProvider, WalletHomeResult } from './wallet-home';

export const populatedWalletHomeFixture = {
  status: 'ready',
  snapshot: {
    identity: {
      username: 'anon.sodera.eth',
      address: '0x7A36a07E7B97e8A4d1C5f6629A7E9f8d7e70C304' as Address,
      avatarUrl: null,
    },
    portfolio: {
      balances: [
        {
          id: 'sepolia-eth',
          name: 'Ethereum',
          symbol: 'ETH',
          amount: '0.8200 ETH',
          valueUsdCents: 205_000,
        },
        {
          id: 'sepolia-usdc',
          name: 'Available USD Coin',
          symbol: 'USDC',
          amount: '245.00 USDC',
          valueUsdCents: 24_500,
        },
        {
          id: 'sepolia-wbtc',
          name: 'Wrapped Bitcoin',
          symbol: 'WBTC',
          amount: '0.0100 WBTC',
          valueUsdCents: 100_000,
        },
      ],
      positions: [
        {
          id: 'morpho-curated-usdc',
          protocol: 'Morpho',
          name: 'Curated USDC vault',
          symbol: 'USDC',
          amount: '750.00 USDC',
          valueUsdCents: 75_000,
        },
      ],
    },
  },
} satisfies WalletHomeResult;

const populatedSnapshot = populatedWalletHomeFixture.snapshot;

export const indexingWalletHomeFixture = {
  status: 'indexing',
  snapshot: populatedSnapshot,
  message: 'Vault activity is still indexing. Available balances may be partial.',
} satisfies WalletHomeResult;

export const emptyWalletHomeFixture = {
  status: 'empty',
  identity: populatedSnapshot.identity,
  message: 'Balances and positions will appear after the first indexed activity.',
} satisfies WalletHomeResult;

export type WalletHomeFixture =
  | { state: 'pending' }
  | { state: 'failed'; message: string }
  | { state: 'resolved'; result: WalletHomeResult };

export const pendingWalletHomeFixture = { state: 'pending' } satisfies WalletHomeFixture;

export const failedWalletHomeFixture = {
  state: 'failed',
  message: 'Portfolio provider unavailable',
} satisfies WalletHomeFixture;

export const resolvedWalletHomeFixtures = {
  populated: { state: 'resolved', result: populatedWalletHomeFixture },
  indexing: { state: 'resolved', result: indexingWalletHomeFixture },
  empty: { state: 'resolved', result: emptyWalletHomeFixture },
} satisfies Record<string, WalletHomeFixture>;

export function createWalletHomeFixtureProvider(
  initialFixture: WalletHomeFixture = resolvedWalletHomeFixtures.populated,
) {
  let fixture = initialFixture;
  const listeners = new Set<() => void>();

  const provider: WalletHomeProvider & {
    set(nextFixture: WalletHomeFixture): void;
    update(nextFixture: WalletHomeFixture): void;
  } = {
    source: 'fixture',
    async load() {
      if (fixture.state === 'pending') return new Promise<WalletHomeResult>(() => undefined);
      if (fixture.state === 'failed') throw new Error(fixture.message);
      return fixture.result;
    },
    subscribeToChanges(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(nextFixture) {
      fixture = nextFixture;
    },
    update(nextFixture) {
      fixture = nextFixture;
      listeners.forEach((listener) => listener());
    },
  };

  return provider;
}

export const walletHomeFixtureProvider = createWalletHomeFixtureProvider();
