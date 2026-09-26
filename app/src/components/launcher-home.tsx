import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { platinum } from '@/constants/theme';
import { loadMarketPrices, loadMarketTrends, type MarketPrices, type MarketTrends } from '@/launcher/market-prices';

type LauncherHomeProps = {
  onOpenEarn: () => void;
  onOpenSwap: () => void;
  onOpenActivity: () => void;
};

const { colors, radius, spacing, typography } = platinum;

export function LauncherHome({ onOpenEarn, onOpenSwap, onOpenActivity }: LauncherHomeProps) {
  return (
    <View style={styles.home}>
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore Swap"
          onPress={onOpenSwap}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <View style={styles.actionIcon}>
            <SymbolView name={{ ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' }} size={20} tintColor={colors.secondaryText} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Swap</Text>
            <Text style={styles.actionDescription}>Move between worlds</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore Earn"
          onPress={onOpenEarn}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <View style={styles.actionIcon}>
            <SymbolView name={{ ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' }} size={20} tintColor={colors.secondaryText} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Earn</Text>
            <Text style={styles.actionDescription}>Put your assets to work</Text>
          </View>
        </Pressable>
      </View>
      <MarketPulse />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View activity"
        onPress={onOpenActivity}
        style={({ pressed }) => [styles.activity, pressed && styles.pressed]}>
        <View style={styles.activityIcon}>
          <SymbolView name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={22} tintColor={colors.secondaryText} />
        </View>
        <View style={styles.activityCopy}>
          <Text style={styles.activityTitle}>Activity</Text>
          <Text style={styles.activityDescription}>Your transaction history</Text>
        </View>
        <Text style={styles.activityArrow}>›</Text>
      </Pressable>
    </View>
  );
}

function MarketPulse() {
  const [prices, setPrices] = useState<MarketPrices | null>(null);
  const [trends, setTrends] = useState<MarketTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [recent, setRecent] = useState(false);
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
          const age = Date.now() - result.updatedAt;
          setRecent(age >= 0 && age < 10 * 60_000);
          void loadMarketTrends(request.signal)
            .then((history) => { if (active && !request.signal.aborted) setTrends(history); })
            .catch(() => { if (active && !request.signal.aborted) setTrends(null); });
        })
        .catch(() => {
          if (active && !request.signal.aborted) {
            setError(true);
            setRecent(false);
            setTrends(null);
          }
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

  const isLive = !error && recent;

  return (
    <View style={styles.market}>
      <View style={styles.marketHeading}>
        <View style={styles.marketHeadingLabel}>
          <View style={styles.pulseDot} />
          <Text style={styles.marketTitle}>THE PULSE</Text>
        </View>
        <View style={styles.marketStatus}>
          {isLive ? <View style={styles.liveDot} /> : null}
          <Text style={styles.marketStatusText}>{error ? 'UNAVAILABLE' : isLive ? 'GLOBAL USD LIVE' : 'GLOBAL USD'}</Text>
        </View>
      </View>
      {prices ? (
        <View style={styles.priceList}>
          <Price symbol="₿" ticker="BTC" price={prices.bitcoin.usd} change={prices.bitcoin.change24h} trend={trends?.bitcoin} />
          <Price symbol="Ξ" ticker="ETH" price={prices.ethereum.usd} change={prices.ethereum.change24h} trend={trends?.ethereum} />
        </View>
      ) : loading ? (
        <View style={styles.marketState}><ActivityIndicator color={colors.emerald} /><Text style={styles.muted}>Checking the market...</Text></View>
      ) : (
        <View style={styles.marketState}><Text style={styles.muted}>Prices unavailable right now</Text></View>
      )}
      {error && prices ? <Text style={styles.staleNote}>Showing last available prices · Updated {new Date(prices.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text> : null}
      {error ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry market prices" onPress={() => {
          setLoading(true);
          setRetryCount((count) => count + 1);
        }}>
          <Text style={styles.retryText}>Try again ↗</Text>
        </Pressable>
      ) : null}
      <Text style={styles.marketFootnote}>Global market prices · Wallet on Ethereum</Text>
    </View>
  );
}

function Price({ symbol, ticker, price, change, trend }: { symbol: string; ticker: string; price: number; change: number; trend?: number[] | null }) {
  return (
    <View style={styles.price}>
      <View style={styles.priceHeader}>
        <View style={styles.coinHeading}>
          <Text style={[styles.coinSymbol, ticker === 'BTC' ? styles.bitcoin : styles.ethereum]}>{symbol}</Text>
          <Text style={styles.coinTicker}>{ticker}</Text>
        </View>
        <Text style={[styles.change, change >= 0 ? styles.up : styles.down]}>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</Text>
      </View>
      <Text selectable style={styles.priceValue}>${price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</Text>
      <View style={styles.priceFoot}>
        {trend ? <Sparkline values={trend} positive={change >= 0} /> : <View style={styles.chartPlaceholder} />}
        <Text style={styles.priceCaption}>24h change</Text>
      </View>
    </View>
  );
}

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const path = values.map((value, index) =>
    `${index === 0 ? 'M' : 'L'} ${(index / (values.length - 1) * 120).toFixed(1)} ${(25 - (value - min) / range * 22).toFixed(1)}`,
  ).join(' ');

  return (
    <Svg width="100%" height={28} viewBox="0 0 120 28" accessibilityLabel="24 hour price trend">
      <Path d={path} fill="none" stroke={positive ? colors.emerald : colors.negative} strokeWidth={1.5} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  home: { flexGrow: 1, gap: spacing.lg },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1, minWidth: 0, minHeight: 98, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  actionIcon: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.glassRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { gap: spacing.xs },
  actionTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  actionDescription: { ...typography.micro, color: colors.mutedText },
  market: { gap: spacing.md },
  marketHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  marketHeadingLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulseDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: colors.ethereum },
  marketTitle: { ...typography.micro, color: colors.platinum, letterSpacing: 2 },
  marketStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.emeraldWash, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  marketStatusText: { ...typography.micro, color: colors.emerald },
  liveDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: colors.emerald },
  priceList: { flexDirection: 'row', gap: spacing.md },
  price: { flex: 1, minWidth: 0, minHeight: 128, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  priceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  coinHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  coinSymbol: { ...typography.labelSmall, width: 22, height: 22, borderRadius: radius.full, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center' },
  bitcoin: { color: colors.bitcoin, backgroundColor: colors.glassRaised },
  ethereum: { color: colors.ethereum, backgroundColor: colors.glassRaised },
  coinTicker: { ...typography.labelSmall, color: colors.secondaryText },
  priceValue: { ...typography.subheading, color: colors.platinum, fontVariant: ['tabular-nums'] },
  change: { ...typography.micro, fontVariant: ['tabular-nums'], overflow: 'hidden', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  up: { color: colors.emerald, backgroundColor: colors.emeraldWash },
  down: { color: colors.negative, backgroundColor: colors.negativeWash },
  priceFoot: { flex: 1, justifyContent: 'flex-end', gap: spacing.sm },
  chartPlaceholder: { height: 28 },
  priceCaption: { ...typography.micro, color: colors.faintText },
  marketState: { minHeight: 128, borderRadius: radius.lg, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  muted: { ...typography.bodySmall, color: colors.mutedText },
  staleNote: { ...typography.caption, color: colors.warning },
  retryText: { ...typography.bodySmall, color: colors.emerald, paddingVertical: spacing.sm },
  marketFootnote: { ...typography.micro, color: colors.faintText, textAlign: 'center' },
  activity: { minHeight: 66, marginTop: 'auto', paddingHorizontal: spacing.md, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  activityIcon: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.glassRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1, gap: spacing.xs },
  activityTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  activityDescription: { ...typography.caption, color: colors.mutedText },
  activityArrow: { ...typography.heading, color: colors.secondaryText },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
