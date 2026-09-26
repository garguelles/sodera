import { router } from 'expo-router';

import { LauncherScreen } from '@/components/launcher-screen';
import { LauncherHome } from '@/components/launcher-home';
import { useOnboarding } from '@/onboarding/onboarding-context';

export default function HomeScreen() {
  const { access } = useOnboarding();
  const profile = access?.status === 'complete' ? access.profile : null;

  return (
    <LauncherScreen
      accountAddress={profile?.account}
      username={profile?.username}
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
