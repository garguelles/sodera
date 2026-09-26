import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { WalletHome } from '@/components/wallet-home';
import { platinum } from '@/constants/theme';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';

export default function WalletRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Wallet',
          headerStyle: { backgroundColor: platinum.colors.canvas },
          headerTintColor: platinum.colors.platinum,
          headerShadowVisible: false,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Transactions"
              onPress={() => router.push('/transactions')}
              style={styles.historyButton}>
              <Text style={styles.historyText}>History</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.screen}>
        <WalletHome
          provider={walletHomeLiveProvider}
          onAction={(action) => {
            if (action === 'send') router.push('/send');
            if (action === 'receive') router.push('/receive');
            if (action === 'swap') router.push('/swap');
          }}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: platinum.colors.canvas },
  historyButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: platinum.spacing.sm },
  historyText: { ...platinum.typography.bodySmall, color: platinum.colors.platinum },
});
