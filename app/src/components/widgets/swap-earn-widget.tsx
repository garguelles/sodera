import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { platinum } from '@/constants/theme';
import type { WidgetSize } from '@/launcher/home-layout';

type SwapEarnWidgetProps = {
  size: WidgetSize;
  onOpenSwap: () => void;
  onOpenEarn: () => void;
};

const { colors, radius, spacing, typography } = platinum;

const ENTRIES = [
  {
    key: 'swap',
    title: 'Swap',
    description: 'Move between worlds',
    icon: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  },
  {
    key: 'earn',
    title: 'Earn',
    description: 'Put your assets to work',
    icon: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  },
] as const;

/**
 * 4×1 side-by-side tiles (the default, as on the pre-widget home), 2×2 stacked rows,
 * or 2×1 side-by-side icon buttons for the Swap and Earn previews.
 */
export function SwapEarnWidget({ size, onOpenSwap, onOpenEarn }: SwapEarnWidgetProps) {
  const sideBySide = size.h === 1;
  const compact = sideBySide && size.w < 4;
  const handlers = { swap: onOpenSwap, earn: onOpenEarn };

  if (size.w >= 4) {
    // The pre-widget home's two tiles: icon on top, title and description at the bottom.
    return (
      <View style={[styles.container, styles.containerRow]}>
        {ENTRIES.map((entry) => (
          <Pressable
            key={entry.key}
            accessibilityRole="button"
            accessibilityLabel={`Explore ${entry.title}`}
            onPress={handlers[entry.key]}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
            <View style={styles.tileIcon}>
              <SymbolView importantForAccessibility="no" name={entry.icon} size={20} tintColor={colors.secondaryText} />
            </View>
            <View style={styles.tileCopy}>
              <Text style={styles.title}>{entry.title}</Text>
              <Text style={styles.description}>{entry.description}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.container, sideBySide && styles.containerRow]}>
      {ENTRIES.map((entry) => (
        <Pressable
          key={entry.key}
          accessibilityRole="button"
          accessibilityLabel={`Explore ${entry.title}`}
          onPress={handlers[entry.key]}
          style={({ pressed }) => [styles.entry, compact ? styles.entryCompact : styles.entryRow, pressed && styles.pressed]}>
          <View style={styles.icon}>
            <SymbolView importantForAccessibility="no" name={entry.icon} size={18} tintColor={colors.secondaryText} />
          </View>
          {compact ? (
            <Text style={styles.title}>{entry.title}</Text>
          ) : (
            <View style={styles.copy}>
              <Text style={styles.title}>{entry.title}</Text>
              <Text numberOfLines={2} style={styles.description}>{entry.description}</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.md },
  containerRow: { flexDirection: 'row' },
  entry: { flex: 1, minWidth: 0, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  entryCompact: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  tile: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  tileIcon: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.glassRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tileCopy: { gap: spacing.xs },
  icon: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.glassRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  description: { ...typography.micro, color: colors.mutedText },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
