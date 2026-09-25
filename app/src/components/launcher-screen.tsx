import { SymbolView } from 'expo-symbols';
import { type ReactNode, useRef } from 'react';
import { type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type LauncherScreenProps = {
  homeContent: ReactNode;
  onOpenWallet: () => void;
  onOpenPhone: () => void;
  onOpenSettings: () => void;
};

export function LauncherScreen({ homeContent, onOpenWallet, onOpenPhone, onOpenSettings }: LauncherScreenProps) {
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
          style={styles.settingsButton}>
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Wallet"
          onPress={onOpenWallet}
          style={({ pressed }) => [styles.wallet, pressed && styles.pressed]}>
          <View style={styles.walletCopy}>
            <Text style={styles.walletEyebrow}>YOUR GATEWAY</Text>
            <Text style={styles.walletTitle}>Wallet</Text>
            <Text style={styles.walletSubtitle}>Your onchain life, one tap away.</Text>
          </View>
          <View style={styles.walletIcon}>
            <SymbolView
              importantForAccessibility="no"
              name={{ ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'wallet' }}
              size={28}
              tintColor="#171713"
            />
          </View>
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
              tintColor="#b3c9ef"
            />
          </View>
          <View style={styles.phoneCopy}>
            <Text style={styles.phoneTitle}>Phone</Text>
            <Text style={styles.phoneSubtitle}>All your apps, in one place</Text>
          </View>
          <Text style={styles.phoneArrow}>↗</Text>
        </Pressable>
        {homeContent}
      </ScrollView>
      <View onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={styles.gestureArea}>
        <View style={styles.gestureBar} />
        <Text style={styles.gestureText}>SWIPE UP FOR PHONE</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#d4f06a', alignItems: 'center', justifyContent: 'center' },
  markCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4f06a' },
  wordmark: { color: '#f3f0e8', fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  settingsButton: { minHeight: 48, justifyContent: 'center' },
  settingsText: { color: '#f3f0e8', fontSize: 13, fontWeight: '600' },
  content: { flex: 1 },
  contentInner: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 12 },
  wallet: { minHeight: 130, borderRadius: 24, borderCurve: 'continuous', padding: 20, backgroundColor: '#d4f06a', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  walletCopy: { flex: 1, gap: 4 },
  walletEyebrow: { color: '#424c29', fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  walletTitle: { color: '#171713', fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  walletSubtitle: { color: '#424c29', fontSize: 12 },
  walletIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#b5d050', alignItems: 'center', justifyContent: 'center' },
  phone: { minHeight: 82, borderRadius: 20, borderCurve: 'continuous', paddingHorizontal: 16, backgroundColor: '#283341', flexDirection: 'row', alignItems: 'center', gap: 14 },
  phoneIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#394c62', alignItems: 'center', justifyContent: 'center' },
  phoneCopy: { flex: 1, gap: 3 },
  phoneTitle: { color: '#f3f0e8', fontSize: 17, fontWeight: '700' },
  phoneSubtitle: { color: '#b3c9ef', fontSize: 11 },
  phoneArrow: { color: '#b3c9ef', fontSize: 19 },
  gestureArea: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 5 },
  gestureBar: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#666b60' },
  gestureText: { color: '#929188', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
