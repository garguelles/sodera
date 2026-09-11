import { router } from 'expo-router';

import { LauncherScreen } from '@/components/launcher-screen';
import { launcherClient } from '@/launcher/launcher-client';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';

export default function HomeScreen() {
  return (
    <LauncherScreen
      client={launcherClient}
      preferencesStorage={launcherPreferencesNativeStorage}
      onOpenPasskeyProof={() => router.push('/passkey-proof')}
    />
  );
}
