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

import { platinum } from '@/constants/theme';
import type {
  WalletHomeIdentity,
  WalletHomeProvider,
  WalletHomeResult,
} from '@/wallet/wallet-home';
import { getPortfolioTotalUsdCents } from '@/wallet/wallet-home';
import { shortenAddress } from '@/wallet/sepolia';

type WalletHomeProps = {
  provider: WalletHomeProvider;
  onAction?: (action: WalletHomeAction) => void;
};

export type WalletHomeAction = 'send' | 'receive' | 'swap';

type WalletHomeViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; result: WalletHomeResult };

export function WalletHome({ provider, onAction }: WalletHomeProps) {
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
      if (active) setViewState({ status: 'loading' });
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
      {viewState.status === 'loading' ? (
        <View accessibilityLabel="Loading wallet data" style={styles.stateCard}>
          <ActivityIndicator color={platinum.colors.platinum} />
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
        <View style={styles.section}>
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
          onAction={onAction}
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
  onAction,
  onToggleAmounts,
  result,
}: {
  amountsVisible: boolean;
  compact: boolean;
  onAction?: (action: WalletHomeAction) => void;
  onToggleAmounts: () => void;
  result: Extract<WalletHomeResult, { status: 'ready' | 'indexing' }>;
}) {
  const { identity, portfolio } = result.snapshot;

  return (
    <View style={styles.content}>
      <View style={styles.section}>
        <View style={[styles.portfolioHeader, compact && styles.compactPortfolioHeader]}>
          <Identity identity={identity} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={amountsVisible ? 'Hide financial amounts' : 'Show financial amounts'}
            accessibilityState={{ selected: !amountsVisible }}
            onPress={onToggleAmounts}
            style={({ pressed }) => [styles.visibilityButton, pressed && styles.pressed]}>
            <Text style={styles.visibilityButtonText}>{amountsVisible ? '👀' : '🙈'}</Text>
          </Pressable>
        </View>
        <Text style={styles.totalLabel}>Portfolio</Text>
        <FinancialAmount
          style={styles.total}
          value={formatUsd(getPortfolioTotalUsdCents(result.snapshot))}
          visible={amountsVisible}
        />
        <Text style={styles.network}>Ethereum</Text>
        <View style={styles.actions}>
          {(['send', 'receive', 'swap'] as const).map((action) => (
            <Pressable
              accessibilityRole="button"
              key={action}
              onPress={() => onAction?.(action)}
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
              <Text style={styles.actionButtonText}>
                {action.slice(0, 1).toUpperCase() + action.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {result.status === 'indexing' ? (
        <View accessibilityRole="alert" style={styles.indexingCard}>
          <Text style={styles.indexingTitle}>Portfolio indexing</Text>
          <Text style={styles.indexingText}>{result.message}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Assets
        </Text>
        <View style={styles.assets}>
          {portfolio.balances.map((balance) => (
            <View key={balance.id} style={styles.asset}>
              <Text style={styles.assetSymbol}>{balance.symbol}</Text>
              <FinancialAmount
                style={styles.assetAmount}
                value={balance.amount}
                visible={amountsVisible}
              />
              <FinancialAmount
                style={styles.assetValue}
                value={formatUsd(balance.valueUsdCents)}
                visible={amountsVisible}
              />
            </View>
          ))}
        </View>
      </View>

      {portfolio.positions.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.positionHeading}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              Vault position
            </Text>
            <Text style={styles.protocol}>{portfolio.positions[0]?.protocol}</Text>
          </View>
          {portfolio.positions.map((position) => (
            <View key={position.id} style={styles.positionRow}>
              <View style={styles.positionCopy}>
                <Text style={styles.assetName}>{position.name}</Text>
                <FinancialAmount
                  style={styles.assetAmount}
                  value={position.amount}
                  visible={amountsVisible}
                />
              </View>
              <FinancialAmount
                style={styles.assetValue}
                value={formatUsd(position.valueUsdCents)}
                visible={amountsVisible}
              />
            </View>
          ))}
        </View>
      ) : null}
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
        <Text accessibilityLabel={`Wallet address ${identity.address}`} selectable style={styles.address}>
          {shortenAddress(identity.address)}
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
      {visible ? value : value.startsWith('$') ? '$••••••' : '••••••'}
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

function formatUsd(cents: number | null) {
  if (cents === null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load wallet data';
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  compactContainer: { paddingHorizontal: spacing.md },
  content: { gap: spacing.lg },
  section: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  portfolioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  compactPortfolioHeader: { alignItems: 'flex-start' },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: radius.full },
  initials: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cyan },
  initialsText: { ...typography.bodySmall, color: colors.onPlatinum },
  identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  username: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  address: { ...typography.micro, color: colors.mutedText, fontVariant: ['tabular-nums'] },
  visibilityButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.glass,
  },
  visibilityButtonText: { fontSize: 22 },
  totalLabel: { ...typography.label, color: colors.mutedText },
  total: {
    ...typography.title,
    color: colors.platinum,
    fontVariant: ['tabular-nums'],
  },
  network: { ...typography.labelSmall, color: colors.emerald },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  cardTitle: { ...typography.label, color: colors.secondaryText },
  assets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  asset: { minWidth: 104, flex: 1, gap: spacing.xs },
  assetSymbol: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  assetName: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  assetAmount: { ...typography.caption, color: colors.mutedText, fontVariant: ['tabular-nums'] },
  assetValue: {
    ...typography.label,
    color: colors.platinum,
    fontVariant: ['tabular-nums'],
  },
  positionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  protocol: { ...typography.labelSmall, color: colors.emerald },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  positionCopy: { flex: 1, gap: spacing.xs },
  stateCard: {
    minHeight: 150,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateTitle: { ...typography.body, color: colors.platinum, textAlign: 'center' },
  secondary: { ...typography.bodySmall, color: colors.mutedText, textAlign: 'center' },
  errorCard: { borderLeftWidth: 2, borderLeftColor: colors.negative },
  errorText: { ...typography.bodySmall, color: colors.negative, textAlign: 'center' },
  retryButton: {
    minHeight: 48,
    borderRadius: radius.full,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.platinum,
  },
  retryText: { ...typography.label, color: colors.onPlatinum },
  emptyPortfolio: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  indexingCard: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.md,
    backgroundColor: colors.surfaceHigh,
    gap: spacing.xs,
  },
  indexingTitle: { ...typography.label, color: colors.warning },
  indexingText: { ...typography.caption, color: colors.secondaryText },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
});
