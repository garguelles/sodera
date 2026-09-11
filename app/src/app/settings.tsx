import { Stack } from 'expo-router/stack';

import { LauncherSettingsScreen } from '@/components/launcher-settings-screen';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';

export default function SettingsRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#171713' },
          headerTintColor: '#f3f0e8',
          title: 'Settings',
        }}
      />
      <LauncherSettingsScreen preferencesStorage={launcherPreferencesNativeStorage} />
    </>
  );
}
