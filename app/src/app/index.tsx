import { router } from 'expo-router';

import { LauncherScreen } from '@/components/launcher-screen';
import { WalletHome } from '@/components/wallet-home';
import { launcherClient } from '@/launcher/launcher-client';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';

export default function HomeScreen() {
  return (
    <LauncherScreen
      client={launcherClient}
      homeContent={
        <WalletHome
          provider={walletHomeLiveProvider}
          onAction={(action) => {
            if (action === 'send') router.push('/send');
          }}
        />
      }
      preferencesStorage={launcherPreferencesNativeStorage}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
