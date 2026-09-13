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

import type {
  TransactionActivityItem,
  TransactionActivityProvider,
  TransactionActivityResult,
} from '@/wallet/transaction-activity';

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
      await openTransaction(transactionExplorerUrl(transactionHash));
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

  const items = viewState.status === 'loaded' && viewState.result.status === 'ready'
    ? viewState.result.items
    : [];
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
              <ActivityIndicator color="#d4f06a" />
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
        ListHeaderComponent={header}
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
        <Text importantForAccessibility="no" style={styles.directionIconText}>{sent ? '↗' : '↙'}</Text>
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

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function transactionExplorerUrl(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load transaction activity';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  list: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 48 },
  emptyList: { flexGrow: 1 },
  header: { gap: 22, paddingBottom: 28 },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { color: '#d4f06a', fontSize: 14, fontWeight: '700' },
  heading: { gap: 9 },
  eyebrow: { color: '#d4f06a', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1.2 },
  subtitle: { color: '#aaa89f', fontSize: 15, lineHeight: 22 },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  directionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentIcon: { backgroundColor: '#2b2b25' },
  receivedIcon: { backgroundColor: '#d4f06a' },
  directionIconText: { color: '#f3f0e8', fontSize: 22, fontWeight: '700' },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { color: '#f3f0e8', fontSize: 15, fontWeight: '700' },
  counterparty: { color: '#aaa89f', fontSize: 12, fontVariant: ['tabular-nums'] },
  timestamp: { color: '#77766f', fontSize: 11 },
  amountCopy: { maxWidth: '38%', alignItems: 'flex-end', gap: 2 },
  amount: { color: '#f3f0e8', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  receivedAmount: { color: '#d4f06a' },
  asset: { color: '#929188', fontSize: 11, fontWeight: '700' },
  linkError: { color: '#ffd9d4', fontSize: 13, lineHeight: 19, paddingTop: 20, textAlign: 'center' },
  separator: { height: 1, marginLeft: 54, backgroundColor: '#303029' },
  centeredState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyState: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 8 },
  stateTitle: { color: '#f3f0e8', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateCopy: { color: '#929188', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#d4f06a',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  retryText: { color: '#202515', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.6, transform: [{ scale: 0.98 }] },
});
