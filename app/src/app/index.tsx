import { router } from 'expo-router';

import { LauncherScreen } from '@/components/launcher-screen';
import { WalletHome } from '@/components/wallet-home';
import { launcherClient } from '@/launcher/launcher-client';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';
import { walletHomeFixtureProvider } from '@/wallet/wallet-home-fixtures';

export default function HomeScreen() {
  return (
    <LauncherScreen
      client={launcherClient}
      homeContent={__DEV__ ? <WalletHome provider={walletHomeFixtureProvider} /> : undefined}
      preferencesStorage={launcherPreferencesNativeStorage}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
