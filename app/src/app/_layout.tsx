import '@/global.css';

import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts as useGeistFonts } from '@expo-google-fonts/geist';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, useFonts as useMonoFonts } from '@expo-google-fonts/jetbrains-mono';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OnboardingProvider, useOnboarding } from '@/onboarding/onboarding-context';
import { platinum } from '@/constants/theme';

export default function RootLayout() {
  const [geistLoaded, geistError] = useGeistFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold });
  const [monoLoaded, monoError] = useMonoFonts({ JetBrainsMono_400Regular, JetBrainsMono_500Medium });
  if ((!geistLoaded && !geistError) || (!monoLoaded && !monoError)) return null;

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
        <ActivityIndicator color={platinum.colors.emerald} />
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
        <Stack.Screen name="plan" />
        <Stack.Screen name="assistant" />
        <Stack.Screen name="receive" />
        <Stack.Screen name="transactions" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="passkey-proof" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: platinum.colors.canvas },
});
