import { SymbolView } from 'expo-symbols';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, type ScrollView as RNScrollView, StyleSheet, Text, View } from 'react-native';
// Gesture handler's ScrollView, so a widget drag can block scrolling instead of racing it.
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platinum } from '@/constants/theme';

type LauncherScreenProps = {
  /** The widget grid. */
  homeContent: ReactNode;
  onOpenPhone: () => void;
  onOpenSettings: () => void;
  /** Shows the assistant button left of settings when the agent is configured. */
  onOpenAssistant?: () => void;
  /** Edit mode: the header shows `EDIT HOME` and a Done pill, and swipe-up is disabled. */
  editing?: boolean;
  onDone?: () => void;
  /** Drawn over everything below the header, such as the widgets sheet in edit mode; the header stays usable. */
  overlay?: ReactNode;
  /** Extra space at the end of the scroll content so an overlay does not cover the last row. */
  contentInsetBottom?: number;
  scrollRef?: RefObject<RNScrollView | null>;
  /** False while a widget is being dragged. */
  scrollEnabled?: boolean;
  /** Scroll offset and visible height of the home scroll view. */
  onScrollMetrics?: (metrics: { offset: number; viewportHeight: number }) => void;
};

const { colors, radius, spacing, typography } = platinum;

export function LauncherScreen({
  homeContent,
  onOpenPhone,
  onOpenSettings,
  onOpenAssistant,
  editing = false,
  onDone,
  overlay,
  contentInsetBottom = 0,
  scrollRef,
  scrollEnabled = true,
  onScrollMetrics,
}: LauncherScreenProps) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const scrollMetrics = useRef({ offset: 0, viewportHeight: 0 });
  const [headerBottom, setHeaderBottom] = useState(0);
  const measureHeader = (event: { nativeEvent: { layout: { y: number; height: number } } }) =>
    setHeaderBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height);

  const reportScroll = (next: Partial<{ offset: number; viewportHeight: number }>) => {
    scrollMetrics.current = { ...scrollMetrics.current, ...next };
    onScrollMetrics?.(scrollMetrics.current);
  };

  const handleTouchStart = (event: GestureResponderEvent) => {
    touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  };

  const handleTouchEnd = (event: GestureResponderEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || editing) return;
    const deltaX = event.nativeEvent.pageX - start.x;
    const deltaY = event.nativeEvent.pageY - start.y;
    if (deltaY < -60 && Math.abs(deltaY) > Math.abs(deltaX)) onOpenPhone();
  };

  return (
    <SafeAreaView style={styles.screen}>
      {editing ? (
        <View onLayout={measureHeader} style={styles.header}>
          <Text style={styles.editTitle}>EDIT HOME</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done editing home"
            hitSlop={{ top: 3, bottom: 3 }}
            onPress={onDone}
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <View onLayout={measureHeader} style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.mark}><View style={styles.markCore} /></View>
            <Text style={styles.wordmark}>SODERA</Text>
          </View>
          <View style={styles.headerActions}>
            {onOpenAssistant ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Dera"
                onPress={onOpenAssistant}
                style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
                <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={20} tintColor={colors.ethereum} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open launcher settings"
              onPress={onOpenSettings}
              style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
              <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={20} tintColor={colors.secondaryText} />
            </Pressable>
          </View>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        scrollEnabled={scrollEnabled}
        style={styles.content}
        contentContainerStyle={[styles.contentInner, editing && styles.contentEditing, { paddingBottom: spacing.md + contentInsetBottom }]}
        contentInsetAdjustmentBehavior="automatic"
        onLayout={(event) => reportScroll({ viewportHeight: event.nativeEvent.layout.height })}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => reportScroll({ offset: event.nativeEvent.contentOffset.y })}
        scrollEventThrottle={32}>
        {homeContent}
      </ScrollView>
      <View onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={[styles.gestureArea, editing && styles.gestureDisabled]}>
        <Text style={styles.gestureChevron}>⌃</Text>
        <Text style={styles.gestureText}>SWIPE UP FOR PHONE</Text>
        <View style={styles.gestureBar} />
      </View>
      {overlay ? (
        <View pointerEvents="box-none" style={[styles.overlay, { top: headerBottom }]}>
          {overlay}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 24, height: 24, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(244, 245, 247, 0.3)' },
  markCore: { width: 13, height: 13, borderRadius: radius.full, backgroundColor: colors.platinum },
  wordmark: { ...typography.label, color: colors.platinum, letterSpacing: 3 },
  settingsButton: { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  editTitle: { ...typography.label, color: colors.platinum, letterSpacing: 3 },
  // 38 tall like the header buttons, so the header does not change height; the hit slop brings it to 44.
  doneButton: { height: 38, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: colors.platinum, alignItems: 'center', justifyContent: 'center' },
  doneText: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  content: { flex: 1 },
  // Room above the top row for the remove button and size tag, which sit outside the selected cell.
  contentEditing: { paddingTop: spacing.lg },
  contentInner: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  gestureDisabled: { opacity: 0.3 },
  gestureArea: { minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  gestureChevron: { ...typography.caption, color: colors.faintText },
  gestureText: { ...typography.micro, color: colors.faintText, letterSpacing: 2 },
  gestureBar: { width: 36, height: 4, borderRadius: radius.full, backgroundColor: colors.mutedText },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
