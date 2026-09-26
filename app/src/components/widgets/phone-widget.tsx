import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { platinum } from '@/constants/theme';
import type { WidgetSize } from '@/launcher/home-layout';

type PhoneWidgetProps = {
  size: WidgetSize;
  onOpenPhone: () => void;
};

const { colors, radius, spacing, typography } = platinum;

/** 2×2 tile or 4×1 row that opens the app drawer. */
export function PhoneWidget({ size, onOpenPhone }: PhoneWidgetProps) {
  const icon = (
    <View style={styles.icon}>
      <SymbolView
        importantForAccessibility="no"
        name={{ ios: 'square.grid.2x2.fill', android: 'apps', web: 'apps' }}
        size={size.h === 1 ? 20 : 24}
        tintColor={colors.cyan}
      />
    </View>
  );

  if (size.h === 1) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Phone"
        onPress={onOpenPhone}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        {icon}
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Phone</Text>
          <Text numberOfLines={1} style={styles.subtitle}>All your apps</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Phone"
      onPress={onOpenPhone}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      {icon}
      <View style={styles.tileCopy}>
        <Text style={styles.tileTitle}>Phone</Text>
        <Text numberOfLines={2} style={styles.subtitle}>All your apps, in one place</Text>
      </View>
      <Text style={styles.tileArrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: radius.xl, borderCurve: 'continuous', padding: spacing.md, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  tileCopy: { gap: spacing.xs },
  tileTitle: { ...typography.cardTitle, color: colors.platinum },
  tileArrow: { ...typography.subheading, color: colors.mutedText, position: 'absolute', top: spacing.md, right: spacing.md },
  row: { flex: 1, paddingHorizontal: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowCopy: { flex: 1, gap: spacing.xs },
  rowTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  icon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center' },
  subtitle: { ...typography.caption, color: colors.mutedText },
  chevron: { ...typography.heading, color: colors.secondaryText },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
