import { router } from 'expo-router';

import { LauncherScreen } from '@/components/launcher-screen';
import { launcherClient } from '@/launcher/launcher-client';

export default function HomeScreen() {
  return (
    <LauncherScreen
      client={launcherClient}
      onOpenPasskeyProof={() => router.push('/passkey-proof')}
    />
  );
}
