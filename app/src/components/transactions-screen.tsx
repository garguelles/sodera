import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platinum } from '@/constants/theme';
import type {
  TransactionActivityItem,
  TransactionActivityProvider,
  TransactionActivityResult,
} from '@/wallet/transaction-activity';
import { sepoliaTransactionUrl, shortenAddress } from '@/wallet/sepolia';

type TransactionsScreenProps = {
  provider: TransactionActivityProvider;
  onDone?: () => void;
  openTransaction?: (url: string) => Promise<void>;
};

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; result: TransactionActivityResult };

export function TransactionsScreen({
  provider,
  onDone = () => router.back(),
  openTransaction = Linking.openURL,
}: TransactionsScreenProps) {
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' });
  const [request, setRequest] = useState(0);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const load = async () => {
      const currentRequest = ++latestRequest;
      try {
        const result = await provider.load();
        if (active && currentRequest === latestRequest) {
          setViewState({ status: 'loaded', result });
        }
      } catch (error) {
        if (active && currentRequest === latestRequest) {
          setViewState({ status: 'error', message: getErrorMessage(error) });
        }
      }
    };
    void load();
    const unsubscribe = provider.subscribeToChanges(() => {
      if (active) {
        setViewState({ status: 'loading' });
        void load();
      }
    });
    return () => {
      active = false;
      latestRequest += 1;
      unsubscribe();
    };
  }, [provider, request]);

  const retry = () => {
    setViewState({ status: 'loading' });
    setRequest((current) => current + 1);
  };

  const viewTransaction = async (transactionHash: string) => {
    setLinkError('');
    try {
      await openTransaction(sepoliaTransactionUrl(transactionHash));
    } catch (error) {
      setLinkError(getErrorMessage(error));
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>ETHEREUM SEPOLIA</Text>
        <Text accessibilityRole="header" style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle}>Latest ETH and USDC transfers indexed by Blockscout.</Text>
      </View>
    </View>
  );

  const items = viewState.status === 'loaded' &&
    (viewState.result.status === 'ready' || viewState.result.status === 'partial')
    ? viewState.result.items
    : [];
  const partialResult = viewState.status === 'loaded' && viewState.result.status === 'partial'
    ? viewState.result
    : null;
  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        contentContainerStyle={[styles.list, items.length === 0 && styles.emptyList]}
        data={items}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          viewState.status === 'loading' ? (
            <View accessibilityLabel="Loading transactions" style={styles.centeredState}>
              <ActivityIndicator color={platinum.colors.emerald} />
              <Text style={styles.stateCopy}>Loading activity...</Text>
            </View>
          ) : viewState.status === 'error' ? (
            <View accessibilityRole="alert" style={styles.centeredState}>
              <Text style={styles.stateTitle}>Activity unavailable</Text>
              <Text selectable style={styles.stateCopy}>{viewState.message}</Text>
              <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : partialResult ? (
            <View accessibilityRole="alert" style={styles.emptyState}>
              <Text style={styles.stateTitle}>Activity may be incomplete</Text>
              <Text selectable style={styles.stateCopy}>{partialResult.message}</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.stateTitle}>No transactions yet</Text>
              <Text style={styles.stateCopy}>ETH and USDC transfers will appear here after the explorer indexes them.</Text>
            </View>
          )
        }
        ListFooterComponent={
          linkError ? <Text accessibilityRole="alert" style={styles.linkError}>{linkError}</Text> : null
        }
        ListHeaderComponent={
          <>
            {header}
            {partialResult && items.length > 0 ? (
              <View accessibilityRole="alert" style={styles.partialState}>
                <Text selectable style={styles.stateCopy}>{partialResult.message}</Text>
              </View>
            ) : null}
          </>
        }
        onRefresh={retry}
        refreshing={false}
        renderItem={({ item }) => (
          <TransactionRow
            item={item}
            onPress={() => void viewTransaction(item.transactionHash)}
          />
        )}
        testID="transactions-list"
      />
    </SafeAreaView>
  );
}

function TransactionRow({ item, onPress }: { item: TransactionActivityItem; onPress: () => void }) {
  const sent = item.direction === 'sent';
  const counterparty = `${sent ? 'To' : 'From'} ${shortenAddress(item.counterparty)}`;
  return (
    <Pressable
      accessibilityLabel={`${sent ? 'Sent' : 'Received'} ${item.amount} ${item.asset}, ${counterparty}`}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.directionIcon, sent ? styles.sentIcon : styles.receivedIcon]}>
        <Text importantForAccessibility="no" style={[styles.directionIconText, !sent && styles.receivedIconText]}>{sent ? '↗' : '↙'}</Text>
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{sent ? 'Sent' : 'Received'} {item.asset}</Text>
        <Text selectable style={styles.counterparty}>{counterparty}</Text>
        <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
      </View>
      <View style={styles.amountCopy}>
        <Text selectable style={[styles.amount, !sent && styles.receivedAmount]}>
          {sent ? '-' : '+'}{item.amount}
        </Text>
        <Text style={styles.asset}>{item.asset}</Text>
      </View>
    </Pressable>
  );
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load transaction activity';
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  emptyList: { flexGrow: 1 },
  header: { gap: spacing.xl, paddingBottom: spacing.xl },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { ...typography.bodySmall, color: colors.secondaryText },
  heading: { gap: spacing.sm },
  eyebrow: { ...typography.labelSmall, color: colors.emerald },
  title: { ...typography.display, color: colors.platinum },
  subtitle: { ...typography.bodySmall, color: colors.mutedText },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  directionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentIcon: { backgroundColor: colors.surfaceHigh },
  receivedIcon: { backgroundColor: colors.emeraldWash },
  directionIconText: { ...typography.heading, color: colors.platinum },
  receivedIconText: { color: colors.emerald },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  counterparty: { ...typography.caption, color: colors.mutedText, fontVariant: ['tabular-nums'] },
  timestamp: { ...typography.labelSmall, color: colors.faintText },
  amountCopy: { maxWidth: '38%', alignItems: 'flex-end', gap: spacing.xs },
  amount: { ...typography.label, color: colors.platinum, fontVariant: ['tabular-nums'] },
  receivedAmount: { color: colors.emerald },
  asset: { ...typography.labelSmall, color: colors.mutedText },
  linkError: { ...typography.bodySmall, color: colors.negative, paddingTop: spacing.xl, textAlign: 'center' },
  separator: { height: 1, marginLeft: 42 + spacing.md, backgroundColor: colors.border },
  centeredState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  emptyState: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  partialState: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceHigh,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stateTitle: { ...typography.subheading, color: colors.platinum, textAlign: 'center' },
  stateCopy: { ...typography.bodySmall, color: colors.mutedText, textAlign: 'center' },
  retryButton: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.platinum,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  retryText: { ...typography.bodySmall, color: colors.onPlatinum },
  pressed: { opacity: 0.6, transform: [{ scale: 0.98 }] },
});
