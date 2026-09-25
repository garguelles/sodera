import { router } from 'expo-router';

import { LauncherScreen } from '@/components/launcher-screen';
import { LauncherHome } from '@/components/launcher-home';

export default function HomeScreen() {
  return (
    <LauncherScreen
      homeContent={
        <LauncherHome
          onOpenEarn={() => router.push('/earn')}
          onOpenSwap={() => router.push('/swap')}
          onOpenActivity={() => router.push('/transactions')}
        />
      }
      onOpenWallet={() => router.push('/wallet')}
      onOpenPhone={() => router.push('/phone')}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
