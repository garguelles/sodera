import { Stack } from 'expo-router';

import { PhoneScreen } from '@/components/phone-screen';
import { launcherClient } from '@/launcher/launcher-client';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';

export default function PhoneRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Phone', headerStyle: { backgroundColor: '#171713' }, headerTintColor: '#f3f0e8' }} />
      <PhoneScreen client={launcherClient} preferencesStorage={launcherPreferencesNativeStorage} />
    </>
  );
}
