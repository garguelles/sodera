import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type {
  WalletHomeIdentity,
  WalletHomeProvider,
  WalletHomeResult,
} from '@/wallet/wallet-home';

type WalletHomeProps = {
  provider: WalletHomeProvider;
};

type WalletHomeViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; result: WalletHomeResult };

export function WalletHome({ provider }: WalletHomeProps) {
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const [amountsVisible, setAmountsVisible] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [viewState, setViewState] = useState<WalletHomeViewState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let latestRequest = 0;

    const load = async () => {
      const request = ++latestRequest;
      try {
        const result = await provider.load();
        if (active && request === latestRequest) setViewState({ status: 'loaded', result });
      } catch (error) {
        if (active && request === latestRequest) {
          setViewState({ status: 'error', message: getErrorMessage(error) });
        }
      }
    };

    void load();
    const unsubscribe = provider.subscribeToChanges(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [provider, retryCount]);

  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.eyebrow}>
          Wallet home
        </Text>
        {provider.source === 'fixture' ? (
          <Text accessibilityLabel="Development fixture data" style={styles.fixtureBadge}>
            DEVELOPMENT FIXTURE
          </Text>
        ) : null}
      </View>
      {viewState.status === 'loading' ? (
        <View accessibilityLabel="Loading wallet data" style={styles.stateCard}>
          <ActivityIndicator color="#f3f0e8" />
          <Text style={styles.secondary}>Loading wallet...</Text>
        </View>
      ) : viewState.status === 'error' ? (
        <View accessibilityRole="alert" style={[styles.stateCard, styles.errorCard]}>
          <Text style={styles.stateTitle}>Wallet data unavailable</Text>
          <Text selectable style={styles.errorText}>
            {viewState.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setViewState({ status: 'loading' });
              setRetryCount((count) => count + 1);
            }}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>Retry wallet</Text>
          </Pressable>
        </View>
      ) : viewState.result.status === 'empty' ? (
        <View style={styles.card}>
          <Identity identity={viewState.result.identity} />
          <View style={styles.emptyPortfolio}>
            <Text style={styles.stateTitle}>No portfolio activity yet</Text>
            <Text style={styles.secondary}>{viewState.result.message}</Text>
          </View>
        </View>
      ) : (
        <WalletSnapshot
          amountsVisible={amountsVisible}
          compact={compact}
          onToggleAmounts={() => setAmountsVisible((visible) => !visible)}
          result={viewState.result}
        />
      )}
    </View>
  );
}

function WalletSnapshot({
  amountsVisible,
  compact,
  onToggleAmounts,
  result,
}: {
  amountsVisible: boolean;
  compact: boolean;
  onToggleAmounts: () => void;
  result: Extract<WalletHomeResult, { status: 'ready' | 'indexing' }>;
}) {
  const { identity, portfolio } = result.snapshot;

  return (
    <View style={styles.content}>
      <View style={styles.card}>
        <View style={[styles.portfolioHeader, compact && styles.compactPortfolioHeader]}>
          <Identity identity={identity} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={amountsVisible ? 'Hide financial amounts' : 'Show financial amounts'}
            accessibilityState={{ selected: !amountsVisible }}
            onPress={onToggleAmounts}
            style={({ pressed }) => [styles.visibilityButton, pressed && styles.pressed]}>
            <Text style={styles.visibilityButtonText}>{amountsVisible ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        <Text style={styles.totalLabel}>Portfolio total</Text>
        <FinancialAmount
          style={styles.total}
          value={portfolio.totalValueUsd}
          visible={amountsVisible}
        />
        <Text style={styles.network}>Ethereum Sepolia</Text>
      </View>

      {result.status === 'indexing' ? (
        <View accessibilityRole="alert" style={styles.indexingCard}>
          <Text style={styles.indexingTitle}>Portfolio indexing</Text>
          <Text style={styles.indexingText}>{result.message}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Assets
        </Text>
        {portfolio.balances.map((balance) => (
          <View key={balance.id} style={styles.assetRow}>
            <View style={styles.assetIdentity}>
              <View style={styles.tokenMark}>
                <Text style={styles.tokenMarkText}>{balance.symbol.slice(0, 1)}</Text>
              </View>
              <View style={styles.assetCopy}>
                <Text style={styles.assetName}>{balance.name}</Text>
                <FinancialAmount
                  style={styles.assetAmount}
                  value={balance.amount}
                  visible={amountsVisible}
                />
              </View>
            </View>
            <FinancialAmount
              style={styles.assetValue}
              value={balance.valueUsd}
              visible={amountsVisible}
            />
          </View>
        ))}
      </View>

      <View style={[styles.card, styles.positionCard]}>
        <View style={styles.positionHeading}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Vault position
          </Text>
          <Text style={styles.protocol}>Morpho</Text>
        </View>
        {portfolio.positions.map((position) => (
          <View key={position.id} style={styles.positionRow}>
            <View style={styles.assetCopy}>
              <Text style={styles.assetName}>{position.name}</Text>
              <FinancialAmount
                style={styles.assetAmount}
                value={position.amount}
                visible={amountsVisible}
              />
            </View>
            <FinancialAmount
              style={styles.assetValue}
              value={position.valueUsd}
              visible={amountsVisible}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function Identity({ identity }: { identity: WalletHomeIdentity }) {
  return (
    <View style={styles.identity}>
      {identity.avatarUrl ? (
        <Image
          accessibilityLabel={`${identity.username} avatar`}
          source={identity.avatarUrl}
          style={styles.avatar}
        />
      ) : (
        <View accessibilityLabel={`${identity.username} initials`} style={[styles.avatar, styles.initials]}>
          <Text style={styles.initialsText}>{getInitials(identity.username)}</Text>
        </View>
      )}
      <View style={styles.identityCopy}>
        <Text numberOfLines={1} style={styles.username}>
          {identity.username}
        </Text>
        <Text accessibilityLabel={`Smart Account ${identity.address}`} selectable style={styles.address}>
          {formatAddress(identity.address)}
        </Text>
      </View>
    </View>
  );
}

function FinancialAmount({
  style,
  value,
  visible,
}: {
  style: object;
  value: string;
  visible: boolean;
}) {
  return (
    <Text accessibilityLabel={visible ? value : 'Hidden amount'} selectable={visible} style={style}>
      {visible ? value : 'Hidden'}
    </Text>
  );
}

function getInitials(username: string) {
  const label = username.replace(/\.sodera\.eth$/i, '');
  return (
    label
      .split(/[._\s-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load wallet data';
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 22, gap: 10 },
  compactContainer: { paddingHorizontal: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: { color: '#929188', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  fixtureBadge: {
    color: '#f7e2ad',
    backgroundColor: '#443a24',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  content: { gap: 10 },
  card: {
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: '#262620',
    padding: 16,
    gap: 8,
  },
  portfolioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 12,
  },
  compactPortfolioHeader: { alignItems: 'flex-start' },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 44, height: 44, borderRadius: 14 },
  initials: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#d4f06a' },
  initialsText: { color: '#202515', fontSize: 16, fontWeight: '800' },
  identityCopy: { flex: 1, minWidth: 0, gap: 3 },
  username: { color: '#f3f0e8', fontSize: 17, fontWeight: '700' },
  address: { color: '#929188', fontSize: 12, fontVariant: ['tabular-nums'] },
  visibilityButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34342d',
    paddingHorizontal: 12,
  },
  visibilityButtonText: { color: '#f3f0e8', fontSize: 12, fontWeight: '700' },
  totalLabel: { color: '#929188', fontSize: 13 },
  total: {
    color: '#f3f0e8',
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '700',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  network: { color: '#d4f06a', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  cardTitle: { color: '#f3f0e8', fontSize: 15, fontWeight: '700' },
  assetRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3a3a33',
  },
  assetIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tokenMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#393932',
  },
  tokenMarkText: { color: '#d4f06a', fontSize: 14, fontWeight: '800' },
  assetCopy: { flex: 1, gap: 3 },
  assetName: { color: '#f3f0e8', fontSize: 14, fontWeight: '600' },
  assetAmount: { color: '#929188', fontSize: 12, fontVariant: ['tabular-nums'] },
  assetValue: {
    color: '#f3f0e8',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  positionCard: { backgroundColor: '#2d3023' },
  positionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  protocol: { color: '#d4f06a', fontSize: 12, fontWeight: '700' },
  positionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stateCard: {
    minHeight: 150,
    borderRadius: 18,
    borderCurve: 'continuous',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#262620',
  },
  stateTitle: { color: '#f3f0e8', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondary: { color: '#929188', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  errorCard: { backgroundColor: '#4b2724' },
  errorText: { color: '#ffd9d4', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: {
    minHeight: 48,
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: '#f3f0e8',
  },
  retryText: { color: '#171713', fontSize: 13, fontWeight: '800' },
  emptyPortfolio: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 12,
  },
  indexingCard: {
    borderRadius: 14,
    borderCurve: 'continuous',
    padding: 13,
    backgroundColor: '#443a24',
    gap: 3,
  },
  indexingTitle: { color: '#f7e2ad', fontSize: 13, fontWeight: '700' },
  indexingText: { color: '#d9c99e', fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
});
