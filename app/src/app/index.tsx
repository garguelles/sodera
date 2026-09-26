import { router } from 'expo-router';

import { readAgentConfigFromEnv } from '@/agent/agent-client';
import { HomeGrid } from '@/components/home-grid';
import { LauncherScreen } from '@/components/launcher-screen';
import { ActivityWidget } from '@/components/widgets/activity-widget';
import { IdentityWidget } from '@/components/widgets/identity-widget';
import { MarketPulseWidget } from '@/components/widgets/market-pulse-widget';
import { PhoneWidget } from '@/components/widgets/phone-widget';
import { SwapEarnWidget } from '@/components/widgets/swap-earn-widget';
import { WalletWidget } from '@/components/widgets/wallet-widget';
import type { HomeLayoutItem } from '@/launcher/home-layout';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';
import { useLauncherPreferences } from '@/launcher/use-launcher-preferences';
import { defaultHomeLayout } from '@/launcher/widget-registry';
import { useOnboarding } from '@/onboarding/onboarding-context';
import { pendingSends } from '@/wallet/pending-sends';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';

const agentConfigured = readAgentConfigFromEnv() !== null;

export default function HomeScreen() {
  const { access } = useOnboarding();
  const profile = access?.status === 'complete' ? access.profile : null;
  const account = profile?.account ?? null;
  const { preferences, save } = useLauncherPreferences(launcherPreferencesNativeStorage);
  const layout = preferences?.homeLayout ?? defaultHomeLayout();
  const amountsVisible = preferences?.amountsVisible ?? true;
  const openPhone = () => router.push('/phone');

  const renderWidget = (item: HomeLayoutItem) => {
    const size = { w: item.w, h: item.h };
    switch (item.id) {
      case 'identity':
        return <IdentityWidget size={size} accountAddress={account} username={profile?.username} onOpenWallet={() => router.push('/wallet')} />;
      case 'wallet':
        return (
          <WalletWidget
            size={size}
            provider={walletHomeLiveProvider}
            amountsVisible={amountsVisible}
            onToggleAmounts={() => void save({ amountsVisible: !amountsVisible }).catch(() => undefined)}
            onOpenWallet={() => router.push('/wallet')}
          />
        );
      case 'phone':
        return <PhoneWidget size={size} onOpenPhone={openPhone} />;
      case 'swap-earn':
        return <SwapEarnWidget size={size} onOpenSwap={() => router.push('/swap')} onOpenEarn={() => router.push('/earn')} />;
      case 'market-pulse':
        return <MarketPulseWidget size={size} />;
      case 'activity':
        return <ActivityWidget size={size} provider={pendingSends.provider} onOpenActivity={() => router.push('/transactions')} />;
    }
  };

  return (
    <LauncherScreen
      homeContent={<HomeGrid layout={layout} renderWidget={renderWidget} />}
      onOpenAssistant={agentConfigured && account ? () => router.push('/assistant') : undefined}
      onOpenPhone={openPhone}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
