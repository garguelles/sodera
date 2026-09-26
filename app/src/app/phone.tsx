import { Stack } from 'expo-router';

import { PhoneScreen } from '@/components/phone-screen';
import { platinum } from '@/constants/theme';
import { launcherClient } from '@/launcher/launcher-client';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';

export default function PhoneRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Phone', headerStyle: { backgroundColor: platinum.colors.canvas }, headerTintColor: platinum.colors.platinum, headerShadowVisible: false }} />
      <PhoneScreen client={launcherClient} preferencesStorage={launcherPreferencesNativeStorage} />
    </>
  );
}
