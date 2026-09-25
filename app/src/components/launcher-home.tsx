import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadMarketPrices, type MarketPrices } from '@/launcher/market-prices';

type LauncherHomeProps = {
  onOpenEarn: () => void;
  onOpenSwap: () => void;
  onOpenActivity: () => void;
};

export function LauncherHome({ onOpenEarn, onOpenSwap, onOpenActivity }: LauncherHomeProps) {
  return (
    <View style={styles.home}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>The pulse</Text>
        <Text style={styles.sectionHint}>A little world beyond your apps</Text>
      </View>
      <MarketCard />
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore Earn"
          onPress={onOpenEarn}
          style={({ pressed }) => [styles.actionCard, styles.earnCard, pressed && styles.pressed]}>
          <SymbolView name={{ ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' }} size={25} tintColor="#d4f06a" />
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Earn</Text>
            <Text style={styles.actionDescription}>Put your assets to work</Text>
            <Text style={styles.previewLabel}>EXPLORE ↗</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore Swap"
          onPress={onOpenSwap}
          style={({ pressed }) => [styles.actionCard, styles.swapCard, pressed && styles.pressed]}>
          <SymbolView name={{ ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' }} size={27} tintColor="#b3c9ef" />
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Swap</Text>
            <Text style={styles.actionDescription}>Move between worlds</Text>
            <Text style={styles.previewLabel}>EXPLORE ↗</Text>
          </View>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View activity"
        onPress={onOpenActivity}
        style={({ pressed }) => [styles.activityCard, pressed && styles.pressed]}>
        <View style={styles.activityIcon}>
          <SymbolView name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={22} tintColor="#f3f0e8" />
        </View>
        <View style={styles.activityCopy}>
          <Text style={styles.activityTitle}>Activity</Text>
          <Text style={styles.activityDescription}>Your Sepolia transaction history</Text>
        </View>
        <Text style={styles.activityArrow}>↗</Text>
      </Pressable>
    </View>
  );
}

function MarketCard() {
  const [prices, setPrices] = useState<MarketPrices | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      lastRefresh.current = Date.now();
      void loadMarketPrices(request.signal)
        .then((result) => {
          if (!active || request.signal.aborted) return;
          setPrices(result);
          setError(false);
        })
        .catch(() => {
          if (active && !request.signal.aborted) setError(true);
        })
        .finally(() => {
          if (active && !request.signal.aborted) setLoading(false);
        });
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastRefresh.current > 5 * 60_000) refresh();
    });
    return () => {
      active = false;
      controller?.abort();
      subscription.remove();
    };
  }, [retryCount]);

  return (
    <View style={styles.marketCard}>
      <View style={styles.marketHeading}>
        <Text style={styles.marketEyebrow}>MARKET WATCH <Text style={styles.marketSource}>· COINGECKO</Text></Text>
        <Text style={styles.marketStatus}>
          {error ? 'Unavailable' : prices ? `Updated ${new Date(prices.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'USD · 24H'}
        </Text>
      </View>
      {prices ? (
        <View style={styles.priceRow}>
          <Price symbol="₿" name="Bitcoin" ticker="BTC" price={prices.bitcoin.usd} change={prices.bitcoin.change24h} />
          <View style={styles.priceDivider} />
          <Price symbol="Ξ" name="Ethereum" ticker="ETH" price={prices.ethereum.usd} change={prices.ethereum.change24h} />
        </View>
      ) : loading ? (
        <View style={styles.marketState}><ActivityIndicator color="#d4f06a" /><Text style={styles.muted}>Checking the market...</Text></View>
      ) : (
        <View style={styles.marketState}><Text style={styles.muted}>Prices unavailable right now</Text></View>
      )}
      {error && prices ? <Text style={styles.staleNote}>Showing last available prices</Text> : null}
      {error ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry market prices" onPress={() => {
          setLoading(true);
          setRetryCount((count) => count + 1);
        }}>
          <Text style={styles.retryText}>Try again ↗</Text>
        </Pressable>
      ) : null}
      <Text style={styles.marketFootnote}>Global market prices · Wallet uses Sepolia testnet</Text>
    </View>
  );
}

function Price({ symbol, name, ticker, price, change }: { symbol: string; name: string; ticker: string; price: number; change: number }) {
  return (
    <View style={styles.price}>
      <View style={styles.coinHeading}><Text style={styles.coinSymbol}>{symbol}</Text><Text style={styles.coinName}>{name} <Text style={styles.coinTicker}>{ticker}</Text></Text></View>
      <Text style={styles.priceValue}>${price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</Text>
      <Text style={[styles.change, change >= 0 ? styles.up : styles.down]}>{change >= 0 ? '+' : ''}{change.toFixed(2)}% 24h</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  home: { paddingTop: 12, gap: 14 },
  sectionHeading: { gap: 3, paddingHorizontal: 4 },
  sectionTitle: { color: '#f3f0e8', fontSize: 23, fontWeight: '700', letterSpacing: -0.6 },
  sectionHint: { color: '#929188', fontSize: 12 },
  marketCard: { borderRadius: 22, borderCurve: 'continuous', backgroundColor: '#292923', padding: 18, gap: 18 },
  marketHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  marketEyebrow: { color: '#d4f06a', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  marketSource: { color: '#929188' },
  marketStatus: { color: '#aaa89f', fontSize: 11 },
  priceRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  price: { flex: 1, minWidth: 0, gap: 6 },
  coinHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coinSymbol: { color: '#f3f0e8', fontSize: 18, fontWeight: '700' },
  coinName: { color: '#f3f0e8', fontSize: 12, fontWeight: '600' },
  coinTicker: { color: '#929188', fontSize: 10 },
  priceValue: { color: '#f3f0e8', fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  change: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  up: { color: '#d4f06a' },
  down: { color: '#f4a89c' },
  priceDivider: { width: 1, backgroundColor: '#45453c' },
  marketState: { minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 12 },
  muted: { color: '#aaa89f', fontSize: 13 },
  staleNote: { color: '#f4c479', fontSize: 11 },
  retryText: { color: '#d4f06a', fontSize: 12, fontWeight: '700', paddingVertical: 8 },
  marketFootnote: { color: '#929188', fontSize: 10 },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionCard: { flex: 1, minWidth: 0, minHeight: 155, padding: 16, borderRadius: 22, borderCurve: 'continuous', justifyContent: 'space-between' },
  earnCard: { backgroundColor: '#313929' },
  swapCard: { backgroundColor: '#283341' },
  actionCopy: { gap: 5 },
  actionTitle: { color: '#f3f0e8', fontSize: 20, fontWeight: '700' },
  actionDescription: { color: '#c5c6bc', fontSize: 11 },
  previewLabel: { color: '#aaa89f', fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingTop: 7 },
  activityCard: { minHeight: 74, paddingHorizontal: 16, borderRadius: 20, borderCurve: 'continuous', backgroundColor: '#292923', flexDirection: 'row', alignItems: 'center', gap: 12 },
  activityIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#3a3a33', alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1, gap: 3 },
  activityTitle: { color: '#f3f0e8', fontSize: 14, fontWeight: '700' },
  activityDescription: { color: '#929188', fontSize: 11 },
  activityArrow: { color: '#d4f06a', fontSize: 19 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
