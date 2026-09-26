import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import { type ReactNode, useRef } from 'react';
import { type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platinum } from '@/constants/theme';
import { shortenAddress } from '@/wallet/sepolia';

type LauncherScreenProps = {
  accountAddress?: string | null;
  username?: string | null;
  homeContent: ReactNode;
  onOpenWallet: () => void;
  onOpenPhone: () => void;
  onOpenSettings: () => void;
};

const { colors, radius, spacing, typography } = platinum;

export function LauncherScreen({ accountAddress, username, homeContent, onOpenWallet, onOpenPhone, onOpenSettings }: LauncherScreenProps) {
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open launcher settings"
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
          <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={20} tintColor={colors.secondaryText} />
        </Pressable>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.identity}>
          <View style={styles.identityTop}>
            <View style={styles.identityMark}>
              <View style={styles.identityAvatar}>
                <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={22} tintColor={colors.platinum} />
              </View>
              {accountAddress ? <View style={styles.presenceDot} /> : null}
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.identityTitle}>{username ?? 'Your smart account'}</Text>
              {accountAddress ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Copy account address" onPress={() => void Clipboard.setStringAsync(accountAddress)} style={styles.addressRow}>
                  <Text style={styles.identityAddress}>{shortenAddress(accountAddress)}</Text>
                  <SymbolView name={{ ios: 'square.on.square', android: 'content_copy', web: 'content_copy' }} size={12} tintColor={colors.faintText} />
                </Pressable>
              ) : <Text style={styles.identityAddress}>Sepolia smart wallet</Text>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="View smart account" onPress={onOpenWallet} style={styles.identityArrow}>
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.identityFooter}>
            <Text style={styles.identityChip}>𝕏 @anon_builder</Text>
            <Text style={styles.identityChip}>github/anon</Text>
            <Text style={styles.identityChipActive}>sodera.xyz</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile wallet" onPress={onOpenWallet} style={styles.identityFooterArrow}>
              <Text style={styles.footerArrowText}>›</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.primaryRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Wallet"
            onPress={onOpenWallet}
            style={({ pressed }) => [styles.wallet, pressed && styles.pressed]}>
            <View style={styles.walletIcon}>
              <SymbolView
                importantForAccessibility="no"
                name={{ ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'wallet' }}
                size={26}
                tintColor={colors.onPlatinum}
              />
            </View>
            <View style={styles.walletCopy}>
              <Text style={styles.walletTitle}>Wallet</Text>
              <Text style={styles.walletSubtitle}>Your onchain life, one tap away</Text>
            </View>
            <Text style={styles.walletArrow}>›</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Phone"
            onPress={onOpenPhone}
            style={({ pressed }) => [styles.phone, pressed && styles.pressed]}>
            <View style={styles.phoneIcon}>
              <SymbolView
                importantForAccessibility="no"
                name={{ ios: 'square.grid.2x2.fill', android: 'apps', web: 'apps' }}
                size={24}
                tintColor={colors.cyan}
              />
            </View>
            <View style={styles.phoneCopy}>
              <Text style={styles.phoneTitle}>Phone</Text>
              <Text style={styles.phoneSubtitle}>All your apps, in one place</Text>
            </View>
            <Text style={styles.phoneArrow}>›</Text>
          </Pressable>
        </View>
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
  mark: { width: 24, height: 24, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(244, 245, 247, 0.3)' },
  markCore: { width: 13, height: 13, borderRadius: radius.full, backgroundColor: colors.platinum },
  wordmark: { ...typography.label, color: colors.platinum, letterSpacing: 3 },
  settingsButton: { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  contentInner: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  identity: { minHeight: 106, paddingHorizontal: spacing.md, paddingTop: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityMark: { width: 42, height: 42, borderRadius: radius.full, backgroundColor: colors.cyan, padding: 3, alignItems: 'center', justifyContent: 'center' },
  identityAvatar: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  presenceDot: { position: 'absolute', width: 11, height: 11, borderRadius: radius.full, backgroundColor: colors.emerald, borderWidth: 2, borderColor: colors.canvas, bottom: -1, right: -1 },
  identityCopy: { flex: 1, gap: spacing.xs },
  identityTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 20 },
  identityAddress: { ...typography.micro, color: colors.mutedText },
  identityArrow: { width: 30, height: 30, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center' },
  arrowText: { ...typography.subheading, color: colors.mutedText },
  identityFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  identityChip: { ...typography.micro, color: colors.mutedText, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  identityChipActive: { ...typography.micro, color: colors.emerald, backgroundColor: colors.emeraldWash, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  identityFooterArrow: { marginLeft: 'auto', minWidth: 20, alignItems: 'flex-end' },
  footerArrowText: { ...typography.subheading, color: colors.mutedText },
  primaryRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md },
  wallet: { flex: 1, minWidth: 0, minHeight: 148, borderRadius: radius.xl, borderCurve: 'continuous', padding: spacing.md, backgroundColor: colors.platinum, boxShadow: platinum.shadow.raised, justifyContent: 'space-between' },
  walletCopy: { gap: spacing.xs },
  walletTitle: { ...typography.cardTitle, color: colors.onPlatinum },
  walletSubtitle: { ...typography.caption, color: colors.onPlatinum },
  walletArrow: { ...typography.subheading, color: colors.faintText, position: 'absolute', right: spacing.md, top: spacing.md },
  walletIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: platinum.colors.platinumSoft, alignItems: 'center', justifyContent: 'center' },
  phone: { flex: 1, minWidth: 0, minHeight: 148, borderRadius: radius.xl, borderCurve: 'continuous', padding: spacing.md, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  phoneIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center' },
  phoneCopy: { gap: spacing.xs },
  phoneTitle: { ...typography.cardTitle, color: colors.platinum },
  phoneSubtitle: { ...typography.caption, color: colors.mutedText },
  phoneArrow: { ...typography.subheading, color: colors.mutedText, position: 'absolute', top: spacing.md, right: spacing.md },
  gestureArea: { minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  gestureChevron: { ...typography.caption, color: colors.faintText },
  gestureText: { ...typography.micro, color: colors.faintText, letterSpacing: 2 },
  gestureBar: { width: 36, height: 4, borderRadius: radius.full, backgroundColor: colors.mutedText },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
