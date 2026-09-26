import { SymbolView } from 'expo-symbols';
import { type ReactNode, useRef } from 'react';
import { type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platinum } from '@/constants/theme';

type LauncherScreenProps = {
  /** The widget grid. */
  homeContent: ReactNode;
  onOpenPhone: () => void;
  onOpenSettings: () => void;
  /** Shows the assistant button left of settings when the agent is configured. */
  onOpenAssistant?: () => void;
};

const { colors, radius, spacing, typography } = platinum;

export function LauncherScreen({
  homeContent,
  onOpenPhone,
  onOpenSettings,
  onOpenAssistant,
}: LauncherScreenProps) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (event: GestureResponderEvent) => {
    touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  };

  const handleTouchEnd = (event: GestureResponderEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const deltaX = event.nativeEvent.pageX - start.x;
    const deltaY = event.nativeEvent.pageY - start.y;
    if (deltaY < -60 && Math.abs(deltaY) > Math.abs(deltaX)) onOpenPhone();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
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
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} contentInsetAdjustmentBehavior="automatic">
        {homeContent}
      </ScrollView>
      <View onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={styles.gestureArea}>
        <Text style={styles.gestureChevron}>⌃</Text>
        <Text style={styles.gestureText}>SWIPE UP FOR PHONE</Text>
        <View style={styles.gestureBar} />
      </View>
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
  content: { flex: 1 },
  contentInner: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  gestureArea: { minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  gestureChevron: { ...typography.caption, color: colors.faintText },
  gestureText: { ...typography.micro, color: colors.faintText, letterSpacing: 2 },
  gestureBar: { width: 36, height: 4, borderRadius: radius.full, backgroundColor: colors.mutedText },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
