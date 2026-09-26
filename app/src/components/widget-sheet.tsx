import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
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
  /** A row was dragged out of the sheet and released at this window position. */
  onDrop(id: WidgetId, absoluteX: number, absoluteY: number): void;
};

const { colors, radius, spacing, typography } = platinum;

/** Height of the sheet when collapsed to its grab handle; the home scroll content leaves this much room at the bottom. */
export const WIDGET_SHEET_COLLAPSED_HEIGHT = 32;
const OPEN_FRACTION = 0.55;
const DRAG_THRESHOLD = 40;
const ANIMATION_MS = 220;
/** Hold before a row starts dragging, so a quick swipe still scrolls the list and a tap still adds. */
const ROW_DRAG_HOLD_MS = 200;
const GHOST_WIDTH = 200;
const GHOST_HEIGHT = 56;

/**
 * Bottom sheet listing the widgets that can be added. Open, it covers 55 % of the window; collapsed, only the grab
 * handle shows. Tapping the handle toggles it, dragging the handle down collapses it, and tapping outside collapses it.
 */
export function WidgetSheet({ definitions, placedIds, open, onOpenChange, onAdd, onDrop }: WidgetSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * OPEN_FRACTION);
  const hiddenOffset = sheetHeight - WIDGET_SHEET_COLLAPSED_HEIGHT;
  const offset = useSharedValue(open ? 0 : hiddenOffset);
  const drag = useSharedValue(0);
  // Dragging a row: the ghost follows the finger in the coordinates of the screen container, measured on drag start.
  const originRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [draggingId, setDraggingId] = useState<WidgetId | null>(null);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ghostX.value }, { translateY: ghostY.value }] }));

  const moveGhost = (absoluteX: number, absoluteY: number) => {
    ghostX.value = absoluteX - origin.current.x - GHOST_WIDTH / 2;
    ghostY.value = absoluteY - origin.current.y - GHOST_HEIGHT / 2;
  };

  const rowDrag = (id: WidgetId) =>
    Gesture.Pan()
      .activateAfterLongPress(ROW_DRAG_HOLD_MS)
      .runOnJS(true)
      .onStart((event) => {
        originRef.current?.measureInWindow((x, y) => {
          origin.current = { x, y };
          moveGhost(event.absoluteX, event.absoluteY);
        });
        moveGhost(event.absoluteX, event.absoluteY);
        setDraggingId(id);
        onOpenChange(false);
      })
      .onUpdate((event) => moveGhost(event.absoluteX, event.absoluteY))
      .onEnd((event) => onDrop(id, event.absoluteX, event.absoluteY))
      .onFinalize(() => setDraggingId(null))
      .withTestId(`widget-sheet-row-drag-${id}`);
  const draggingDefinition = definitions.find((definition) => definition.id === draggingId);

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
      <View ref={originRef} pointerEvents="none" style={StyleSheet.absoluteFill} />
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
          <Text style={styles.hint}>drag onto home</Text>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {definitions.map((definition) => {
            const placed = placedIds.has(definition.id);
            return (
              <GestureDetector key={definition.id} gesture={rowDrag(definition.id).enabled(!placed)}>
                <Pressable
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
              </GestureDetector>
            );
          })}
        </ScrollView>
      </Animated.View>
      {draggingDefinition ? (
        <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]} testID="widget-sheet-drag-ghost">
          <View style={styles.ghostIcon}>
            <SymbolView importantForAccessibility="no" name={draggingDefinition.icon} size={18} tintColor={colors.platinum} />
          </View>
          <Text numberOfLines={1} style={styles.rowTitle}>{draggingDefinition.title}</Text>
        </Animated.View>
      ) : null}
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
  ghost: { position: 'absolute', left: 0, top: 0, width: GHOST_WIDTH, height: GHOST_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.cyan, boxShadow: platinum.shadow.raised },
  ghostIcon: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center' },
});
