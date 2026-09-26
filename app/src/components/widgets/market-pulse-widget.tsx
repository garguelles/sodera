import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { platinum } from '@/constants/theme';
import type { WidgetSize } from '@/launcher/home-layout';
import type { MarketPrices } from '@/launcher/market-prices';
import { useMarketPulse, type MarketPulseState } from '@/launcher/use-market-pulse';

type MarketPulseWidgetProps = {
  size: WidgetSize;
};

const { colors, radius, spacing, typography } = platinum;

/** 4×2 pulse with price cards and sparklines, or a 2×2 tile with compact price rows. */
export function MarketPulseWidget({ size }: MarketPulseWidgetProps) {
  const pulse = useMarketPulse();
  return size.w >= 4 ? <WidePulse pulse={pulse} /> : <CompactPulse pulse={pulse} />;
}

function WidePulse({ pulse }: { pulse: MarketPulseState }) {
  const { prices, trends, loading, error, isLive } = pulse;
  return (
    <View style={styles.wide}>
      <View style={styles.heading}>
        <PulseLabel />
        <View style={[styles.status, styles.statusWide]}>
          {isLive ? <View style={styles.liveDot} /> : null}
          <Text style={styles.statusText}>{error ? 'UNAVAILABLE' : isLive ? 'GLOBAL USD LIVE' : 'GLOBAL USD'}</Text>
        </View>
      </View>
      {prices ? (
        <View style={styles.priceList}>
          <Price symbol="₿" ticker="BTC" price={prices.bitcoin.usd} change={prices.bitcoin.change24h} trend={trends?.bitcoin} />
          <Price symbol="Ξ" ticker="ETH" price={prices.ethereum.usd} change={prices.ethereum.change24h} trend={trends?.ethereum} />
        </View>
      ) : (
        <View style={styles.stateCard}>
          <MarketState pulse={pulse} loading={loading} />
        </View>
      )}
      {error ? (
        <View style={styles.footerRow}>
          {prices ? <Text numberOfLines={1} style={styles.staleNote}>Last prices · {formatTime(prices)}</Text> : <View />}
          <RetryButton pulse={pulse} />
        </View>
      ) : (
        <Text style={styles.footnote}>Global market prices · Wallet uses Sepolia testnet</Text>
      )}
    </View>
  );
}

function CompactPulse({ pulse }: { pulse: MarketPulseState }) {
  const { prices, loading, error, isLive } = pulse;
  return (
    <View style={styles.tile}>
      <View style={styles.heading}>
        <PulseLabel />
        {isLive ? <View accessibilityLabel="Live prices" style={styles.liveDot} /> : null}
      </View>
      {prices ? (
        <View style={styles.compactList}>
          <CompactPrice ticker="BTC" price={prices.bitcoin.usd} change={prices.bitcoin.change24h} />
          <CompactPrice ticker="ETH" price={prices.ethereum.usd} change={prices.ethereum.change24h} />
        </View>
      ) : (
        <View style={styles.compactState}>
          <MarketState pulse={pulse} loading={loading} />
        </View>
      )}
      {error ? <RetryButton pulse={pulse} /> : null}
    </View>
  );
}

function PulseLabel() {
  return (
    <View style={styles.headingLabel}>
      <View style={styles.pulseDot} />
      <Text style={styles.title}>THE PULSE</Text>
    </View>
  );
}

function MarketState({ pulse, loading }: { pulse: MarketPulseState; loading: boolean }) {
  if (loading && !pulse.error) {
    return (
      <>
        <ActivityIndicator color={colors.emerald} />
        <Text style={styles.muted}>Checking the market...</Text>
      </>
    );
  }
  return <Text style={styles.muted}>Prices unavailable right now</Text>;
}

function RetryButton({ pulse }: { pulse: MarketPulseState }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Retry market prices" hitSlop={8} onPress={pulse.retry}>
      <Text style={styles.retryText}>Try again ↗</Text>
    </Pressable>
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
        <Change value={change} wide />
      </View>
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={styles.priceValue}>{formatPrice(price)}</Text>
      <View style={styles.priceFoot}>
        {trend ? <Sparkline values={trend} positive={change >= 0} /> : <View style={styles.chartPlaceholder} />}
        <Text style={styles.priceCaption}>24h change</Text>
      </View>
    </View>
  );
}

function CompactPrice({ ticker, price, change }: { ticker: string; price: number; change: number }) {
  return (
    <View style={styles.compactPrice}>
      <View style={styles.compactPriceTop}>
        <Text style={styles.coinTicker}>{ticker}</Text>
        <Change value={change} />
      </View>
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={styles.compactValue}>{formatPrice(price)}</Text>
    </View>
  );
}

function Change({ value, wide = false }: { value: number; wide?: boolean }) {
  return (
    <Text style={[styles.change, wide && styles.changeWide, value >= 0 ? styles.up : styles.down]}>
      {value >= 0 ? '+' : ''}{value.toFixed(1)}%
    </Text>
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

function formatPrice(price: number) {
  return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatTime(prices: MarketPrices) {
  return new Date(prices.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  wide: { flex: 1, gap: spacing.md },
  tile: { flex: 1, padding: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  headingLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulseDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: colors.ethereum },
  title: { ...typography.micro, color: colors.platinum, letterSpacing: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.emeraldWash, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusWide: { paddingVertical: spacing.xs },
  statusText: { ...typography.micro, color: colors.emerald },
  liveDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: colors.emerald },
  priceList: { flex: 1, flexDirection: 'row', gap: spacing.md },
  price: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  priceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  coinHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  coinSymbol: { ...typography.labelSmall, width: 22, height: 22, borderRadius: radius.full, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center' },
  bitcoin: { color: colors.bitcoin, backgroundColor: colors.glassRaised },
  ethereum: { color: colors.ethereum, backgroundColor: colors.glassRaised },
  coinTicker: { ...typography.labelSmall, color: colors.secondaryText },
  priceValue: { ...typography.subheading, color: colors.platinum, fontVariant: ['tabular-nums'] },
  change: { ...typography.micro, fontVariant: ['tabular-nums'], overflow: 'hidden', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xs, paddingVertical: 2 },
  changeWide: { paddingVertical: spacing.xs },
  up: { color: colors.emerald, backgroundColor: colors.emeraldWash },
  down: { color: colors.negative, backgroundColor: colors.negativeWash },
  priceFoot: { flex: 1, justifyContent: 'flex-end', gap: spacing.sm },
  priceCaption: { ...typography.micro, color: colors.faintText },
  chartPlaceholder: { height: 28 },
  stateCard: { flex: 1, borderRadius: radius.lg, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  compactList: { flex: 1, justifyContent: 'space-around' },
  compactPrice: { gap: 2 },
  compactPriceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  compactValue: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum, fontVariant: ['tabular-nums'] },
  compactState: { flex: 1, justifyContent: 'center', gap: spacing.sm },
  muted: { ...typography.caption, color: colors.mutedText },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  staleNote: { ...typography.micro, color: colors.warning, flexShrink: 1 },
  retryText: { ...typography.caption, color: colors.emerald },
  footnote: { ...typography.micro, color: colors.faintText, textAlign: 'center' },
});
