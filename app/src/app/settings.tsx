import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { LauncherSettingsScreen } from '@/components/launcher-settings-screen';
import { platinum } from '@/constants/theme';
import { launcherClient } from '@/launcher/launcher-client';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';

export default function SettingsRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: platinum.colors.canvas },
          headerTintColor: platinum.colors.platinum,
          title: 'Settings',
        }}
      />
      <LauncherSettingsScreen
        client={launcherClient}
        preferencesStorage={launcherPreferencesNativeStorage}
        onEditHome={() => router.dismissTo({ pathname: '/', params: { edit: '1' } })}
      />
    </>
  );
}
