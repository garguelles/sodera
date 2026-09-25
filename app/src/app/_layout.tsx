import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OnboardingProvider, useOnboarding } from '@/onboarding/onboarding-context';

export default function RootLayout() {
  return (
    <OnboardingProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </OnboardingProvider>
  );
}

function RootNavigator() {
  const { access } = useOnboarding();
  if (!access) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#d4f06a" />
      </View>
    );
  }

  const onboardingComplete = access.status === 'complete';
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!onboardingComplete}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={onboardingComplete}>
        <Stack.Screen name="index" />
        <Stack.Screen name="wallet" />
        <Stack.Screen name="phone" />
        <Stack.Screen name="earn" />
        <Stack.Screen name="swap" />
        <Stack.Screen name="send" />
        <Stack.Screen name="receive" />
        <Stack.Screen name="transactions" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="passkey-proof" />
        <Stack.Screen name="explore" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#171713' },
});
