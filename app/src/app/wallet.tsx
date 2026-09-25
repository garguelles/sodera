import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { WalletHome } from '@/components/wallet-home';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';

export default function WalletRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Wallet',
          headerStyle: { backgroundColor: '#171713' },
          headerTintColor: '#f3f0e8',
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
  screen: { flex: 1, backgroundColor: '#171713' },
  historyButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  historyText: { color: '#f3f0e8', fontSize: 14, fontWeight: '600' },
});
