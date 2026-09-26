import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { platinum } from '@/constants/theme';
import type { CellRect, WidgetSize } from '@/launcher/home-layout';

const { colors, radius, spacing, typography } = platinum;

const OUTLINE_OFFSET = 4;
const REMOVE_SIZE = 36;
const HANDLE_LENGTH = 28;
const HANDLE_THICKNESS = 6;
const HANDLE_HIT = 44;

/** 2 px cyan outline drawn 4 px outside the selected cell. */
export function SelectionOutline({ rect }: { rect: CellRect }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.outline,
        {
          left: rect.left - OUTLINE_OFFSET,
          top: rect.top - OUTLINE_OFFSET,
          width: rect.width + OUTLINE_OFFSET * 2,
          height: rect.height + OUTLINE_OFFSET * 2,
        },
      ]}
    />
  );
}

/** `w×h` tag anchored to the top-right corner of the selected cell; tapping it cycles through supported sizes. */
export function SizeTag({ rect, size, onCycleSize }: { rect: CellRect; size: WidgetSize; onCycleSize: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Size ${size.w} by ${size.h}, change size`}
      hitSlop={8}
      onPress={onCycleSize}
      style={[styles.sizeTag, { top: rect.top - OUTLINE_OFFSET - 10, left: rect.left + rect.width - 40 }]}>
      <Text style={styles.sizeTagText}>{`${size.w}×${size.h}`}</Text>
    </Pressable>
  );
}

/** × button anchored to the top-left corner of the selected cell. Renders nothing for widgets that cannot be removed. */
export function RemoveButton({
  rect,
  title,
  removable,
  onRemove,
}: {
  rect: CellRect;
  title: string;
  removable: boolean;
  onRemove: () => void;
}) {
  if (!removable) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${title}`}
      onPress={onRemove}
      style={({ pressed }) => [
        styles.remove,
        { left: rect.left - REMOVE_SIZE / 2 + OUTLINE_OFFSET, top: rect.top - REMOVE_SIZE / 2 + OUTLINE_OFFSET },
        pressed && styles.pressed,
      ]}>
      <Text style={styles.removeText}>×</Text>
    </Pressable>
  );
}

/**
 * Cyan pill centred on the right or bottom edge of the selected cell. Dragging it follows the finger on one axis;
 * on release it reports the translation and springs back. The grid turns the translation into a supported size.
 */
export function ResizeHandle({
  rect,
  edge,
  onResizeEnd,
}: {
  rect: CellRect;
  edge: 'right' | 'bottom';
  onResizeEnd: (translation: number) => void;
}) {
  const translation = useSharedValue(0);
  const horizontal = edge === 'right';
  const pan = Gesture.Pan()
    .onUpdate((event) => {
      translation.value = horizontal ? event.translationX : event.translationY;
    })
    .onEnd((event) => {
      scheduleOnRN(onResizeEnd, horizontal ? event.translationX : event.translationY);
    })
    .onFinalize(() => {
      translation.value = 0;
    })
    .withTestId(`resize-${edge}`);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: horizontal ? [{ translateX: translation.value }] : [{ translateY: translation.value }],
  }));

  const position = horizontal
    ? { left: rect.left + rect.width - HANDLE_HIT / 2, top: rect.top + rect.height / 2 - HANDLE_HIT / 2 }
    : { left: rect.left + rect.width / 2 - HANDLE_HIT / 2, top: rect.top + rect.height - HANDLE_HIT / 2 };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityLabel={horizontal ? 'Resize width' : 'Resize height'}
        style={[styles.handleHit, position, animatedStyle]}
        testID={`resize-handle-${edge}`}>
        <View style={horizontal ? styles.handleVertical : styles.handleHorizontal} />
      </Animated.View>
    </GestureDetector>
  );
}

/** Dashed drop target for an empty grid cell. */
export function EmptyCell({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add widget here"
      onPress={onPress}
      style={({ pressed }) => [styles.empty, pressed && styles.pressed]}>
      <Text style={styles.emptyText}>+</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outline: { position: 'absolute', borderWidth: 2, borderColor: colors.cyan, borderRadius: radius.xl + OUTLINE_OFFSET, borderCurve: 'continuous' },
  sizeTag: { position: 'absolute', minWidth: 36, alignItems: 'center', paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.cyan },
  sizeTagText: { ...typography.labelSmall, color: colors.onPlatinum },
  remove: { position: 'absolute', width: REMOVE_SIZE, height: REMOVE_SIZE, borderRadius: radius.full, backgroundColor: colors.platinum, alignItems: 'center', justifyContent: 'center', boxShadow: platinum.shadow.raised },
  removeText: { ...typography.subheading, lineHeight: 22, color: colors.onPlatinum },
  handleHit: { position: 'absolute', width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center' },
  handleVertical: { width: HANDLE_THICKNESS, height: HANDLE_LENGTH, borderRadius: radius.full, backgroundColor: colors.cyan },
  handleHorizontal: { width: HANDLE_LENGTH, height: HANDLE_THICKNESS, borderRadius: radius.full, backgroundColor: colors.cyan },
  empty: { flex: 1, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderLit, borderRadius: radius.xl, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.subheading, color: colors.mutedText },
  pressed: { opacity: 0.7 },
});
