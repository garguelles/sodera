import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { platinum } from '@/constants/theme';
import type { WidgetSize } from '@/launcher/home-layout';
import { shortenAddress } from '@/wallet/sepolia';
import type { TransactionActivityItem, TransactionActivityProvider } from '@/wallet/transaction-activity';

type ActivityWidgetProps = {
  size: WidgetSize;
  provider: TransactionActivityProvider;
  onOpenActivity: () => void;
  /** Injected for tests. */
  now?: () => number;
};

type LatestState = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; item: TransactionActivityItem | null };

const { colors, radius, spacing, typography } = platinum;
const FALLBACK_SUBTITLE = 'Your Sepolia transaction history';

/** 4×1 row describing the newest transaction; opens the transaction history. */
export function ActivityWidget({ provider, onOpenActivity, now = Date.now }: ActivityWidgetProps) {
  const latest = useLatestActivity(provider);
  const description =
    latest.status === 'loaded'
      ? latest.item
        ? describeActivity(latest.item, now())
        : 'No activity yet'
      : FALLBACK_SUBTITLE;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View activity"
      onPress={onOpenActivity}
      style={({ pressed }) => [styles.activity, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <SymbolView importantForAccessibility="no" name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={20} tintColor={colors.secondaryText} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>Activity</Text>
        <Text numberOfLines={1} style={styles.description}>{description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function useLatestActivity(provider: TransactionActivityProvider): LatestState {
  const [state, setState] = useState<LatestState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const load = async () => {
      const request = ++latestRequest;
      try {
        const result = await provider.load();
        if (!active || request !== latestRequest) return;
        setState({ status: 'loaded', item: result.status === 'empty' ? null : (result.items[0] ?? null) });
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

export function describeActivity(item: TransactionActivityItem, now: number): string {
  const when = formatRelativeTime(item.timestamp, now);
  if (item.kind === 'operation') {
    return `${item.success ? '' : 'Failed '}Account operation · ${item.sponsored ? 'Sponsored' : 'Self-funded'} · ${when}`;
  }
  const sent = item.direction === 'sent';
  return `${sent ? 'Sent' : 'Received'} ${item.amount} ${item.asset} ${sent ? 'to' : 'from'} ${shortenAddress(item.counterparty)} · ${when}`;
}

export function formatRelativeTime(timestamp: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

const styles = StyleSheet.create({
  activity: { flex: 1, paddingHorizontal: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.glassRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  description: { ...typography.caption, color: colors.mutedText },
  chevron: { ...typography.heading, color: colors.secondaryText },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
