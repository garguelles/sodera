import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { platinum } from '@/constants/theme';
import type { WidgetSize } from '@/launcher/home-layout';
import { getPortfolioTotalUsdCents, type WalletHomeProvider } from '@/wallet/wallet-home';

type WalletWidgetProps = {
  size: WidgetSize;
  provider: WalletHomeProvider;
  amountsVisible: boolean;
  onToggleAmounts: () => void;
  onOpenWallet: () => void;
};

type TotalState = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; cents: number | null };

const { colors, radius, spacing, typography } = platinum;
const FALLBACK_SUBTITLE = 'Your onchain life, one tap away';

/** 2×2 platinum tile or 4×1 row with the portfolio total; opens the wallet. */
export function WalletWidget({ size, provider, amountsVisible, onToggleAmounts, onOpenWallet }: WalletWidgetProps) {
  const total = usePortfolioTotal(provider);
  const [pressed, setPressed] = useState(false);

  const amount =
    total.status === 'loading' ? (
      <ActivityIndicator accessibilityLabel="Loading balance" color={colors.onPlatinum} style={styles.loading} />
    ) : total.status === 'error' ? (
      <Text numberOfLines={2} style={styles.subtitle}>{FALLBACK_SUBTITLE}</Text>
    ) : (
      <Text
        accessibilityLabel={total.cents === null ? 'No balance' : amountsVisible ? formatUsd(total.cents) : 'Hidden amount'}
        adjustsFontSizeToFit
        numberOfLines={1}
        style={size.h === 1 ? styles.rowTotal : styles.total}>
        {total.cents === null ? '—' : amountsVisible ? formatUsd(total.cents) : '$••••••'}
      </Text>
    );

  const icon = (
    <View style={styles.icon}>
      <SymbolView
        importantForAccessibility="no"
        name={{ ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'wallet' }}
        size={size.h === 1 ? 20 : 24}
        tintColor={colors.onPlatinum}
      />
    </View>
  );

  if (size.h === 1) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Wallet"
        onPress={onOpenWallet}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        {icon}
        <Text style={styles.rowTitle}>Wallet</Text>
        <View style={styles.rowAmount}>{amount}</View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.tile, pressed && styles.pressed]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Wallet"
        onPress={onOpenWallet}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.tileContent}>
        {icon}
        <View style={styles.tileCopy}>
          <Text style={styles.tileTitle}>Wallet</Text>
          {amount}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={amountsVisible ? 'Hide financial amounts' : 'Show financial amounts'}
        accessibilityState={{ selected: !amountsVisible }}
        hitSlop={8}
        onPress={onToggleAmounts}
        style={({ pressed: eyePressed }) => [styles.eye, eyePressed && styles.pressed]}>
        <SymbolView
          importantForAccessibility="no"
          name={
            amountsVisible
              ? { ios: 'eye', android: 'visibility', web: 'visibility' }
              : { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }
          }
          size={16}
          tintColor={colors.onPlatinum}
        />
      </Pressable>
    </View>
  );
}

function usePortfolioTotal(provider: WalletHomeProvider): TotalState {
  const [state, setState] = useState<TotalState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const load = async () => {
      const request = ++latestRequest;
      try {
        const result = await provider.load();
        if (!active || request !== latestRequest) return;
        setState({ status: 'loaded', cents: result.status === 'empty' ? null : getPortfolioTotalUsdCents(result.snapshot) });
      } catch {
        if (active && request === latestRequest) setState({ status: 'error' });
      }
    };

    void load();
    const unsubscribe = provider.subscribeToChanges(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [provider]);

  return state;
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: radius.xl, borderCurve: 'continuous', padding: spacing.md, backgroundColor: colors.platinum, boxShadow: platinum.shadow.raised, justifyContent: 'space-between' },
  tileContent: { flex: 1, justifyContent: 'space-between' },
  tileCopy: { gap: spacing.xs },
  tileTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  total: { ...typography.subheading, color: colors.onPlatinum, fontVariant: ['tabular-nums'] },
  row: { flex: 1, paddingHorizontal: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.platinum, boxShadow: platinum.shadow.raised, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  rowAmount: { flex: 1, alignItems: 'flex-end' },
  rowTotal: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum, fontVariant: ['tabular-nums'] },
  icon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.platinumSoft, alignItems: 'center', justifyContent: 'center' },
  eye: { position: 'absolute', top: spacing.md, right: spacing.md, width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.platinumSoft, alignItems: 'center', justifyContent: 'center' },
  subtitle: { ...typography.caption, color: colors.onPlatinum },
  loading: { alignSelf: 'flex-start' },
  chevron: { ...typography.heading, color: colors.faintText },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
