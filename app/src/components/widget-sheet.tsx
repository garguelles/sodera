import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { platinum } from '@/constants/theme';
import type { WidgetId } from '@/launcher/home-layout';
import type { WidgetDefinition } from '@/launcher/widget-registry';

type WidgetSheetProps = {
  definitions: readonly WidgetDefinition[];
  placedIds: ReadonlySet<WidgetId>;
  open: boolean;
  onOpenChange(open: boolean): void;
  onAdd(id: WidgetId): void;
};

const { colors, radius, spacing, typography } = platinum;

/** Height of the sheet when collapsed to its grab handle; the home scroll content leaves this much room at the bottom. */
export const WIDGET_SHEET_COLLAPSED_HEIGHT = 32;
const OPEN_FRACTION = 0.55;
const DRAG_THRESHOLD = 40;
const ANIMATION_MS = 220;

/**
 * Bottom sheet listing the widgets that can be added. Open, it covers 55 % of the window; collapsed, only the grab
 * handle shows. Tapping the handle toggles it, dragging the handle down collapses it, and tapping outside collapses it.
 */
export function WidgetSheet({ definitions, placedIds, open, onOpenChange, onAdd }: WidgetSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * OPEN_FRACTION);
  const hiddenOffset = sheetHeight - WIDGET_SHEET_COLLAPSED_HEIGHT;
  const offset = useSharedValue(open ? 0 : hiddenOffset);
  const drag = useSharedValue(0);

  useEffect(() => {
    offset.value = withTiming(open ? 0 : hiddenOffset, { duration: ANIMATION_MS });
  }, [open, hiddenOffset, offset]);

  const handleDrag = Gesture.Pan()
    .onUpdate((event) => {
      drag.value = event.translationY;
    })
    .onEnd((event) => {
      if (event.translationY > DRAG_THRESHOLD) scheduleOnRN(onOpenChange, false);
      else if (event.translationY < -DRAG_THRESHOLD) scheduleOnRN(onOpenChange, true);
    })
    .onFinalize(() => {
      drag.value = 0;
    })
    .withTestId('widget-sheet-handle-drag');

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(Math.max(offset.value + drag.value, 0), hiddenOffset) }],
  }));

  return (
    <>
      {open ? (
        <Pressable
          accessibilityLabel="Close widgets"
          onPress={() => onOpenChange(false)}
          style={StyleSheet.absoluteFill}
          testID="widget-sheet-backdrop"
        />
      ) : null}
      <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]} testID="widget-sheet">
        <GestureDetector gesture={handleDrag}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={open ? 'Collapse widgets' : 'Show widgets'}
            accessibilityState={{ expanded: open }}
            onPress={() => onOpenChange(!open)}
            style={styles.handleArea}>
            <View style={styles.handle} />
          </Pressable>
        </GestureDetector>
        <View style={styles.header}>
          <Text style={styles.title}>Sodera widgets</Text>
          {/* Section 5 adds dragging and changes this to the mock's "drag onto home". */}
          <Text style={styles.hint}>tap to add</Text>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {definitions.map((definition) => {
            const placed = placedIds.has(definition.id);
            return (
              <Pressable
                key={definition.id}
                accessibilityRole="button"
                accessibilityLabel={placed ? `${definition.title}, on home` : `Add ${definition.title}`}
                accessibilityState={{ disabled: placed }}
                disabled={placed}
                onPress={() => onAdd(definition.id)}
                style={({ pressed }) => [styles.row, placed && styles.placed, pressed && styles.pressed]}>
                <View style={styles.icon}>
                  <SymbolView importantForAccessibility="no" name={definition.icon} size={20} tintColor={colors.secondaryText} />
                </View>
                <View style={styles.copy}>
                  <Text style={styles.rowTitle}>{definition.title}</Text>
                  <Text numberOfLines={1} style={styles.subtitle}>{definition.subtitle}</Text>
                </View>
                <Text style={styles.chip}>
                  {placed ? 'On home' : definition.sizes.map((size) => `${size.w}×${size.h}`).join(' · ')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    boxShadow: '0 -12px 32px rgba(0, 0, 0, 0.45)',
  },
  handleArea: { height: WIDGET_SHEET_COLLAPSED_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: radius.full, backgroundColor: colors.mutedText },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { ...typography.cardTitle, color: colors.platinum },
  hint: { ...typography.micro, color: colors.mutedText },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  placed: { opacity: 0.5 },
  icon: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  subtitle: { ...typography.caption, color: colors.mutedText },
  chip: { ...typography.labelSmall, color: colors.emerald, backgroundColor: colors.emeraldWash, borderRadius: radius.sm, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
});
