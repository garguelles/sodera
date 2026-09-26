import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { readAgentConfigFromEnv } from '@/agent/agent-client';
import { LauncherScreen } from '@/components/launcher-screen';
import { LauncherHome } from '@/components/launcher-home';
import { createEnsIdentityReader } from '@/ens/identity-client';
import { useOnboarding } from '@/onboarding/onboarding-context';
import { shortenAddress } from '@/wallet/sepolia';

const agentConfigured = readAgentConfigFromEnv() !== null;

export default function HomeScreen() {
  const { access } = useOnboarding();
  const profile = access?.status === 'complete' ? access.profile : null;
  const [verifiedName, setVerifiedName] = useState<{ key: string; name: string } | null>(null);
  const nameKey = profile?.claimMode === 'ens' ? `${profile.account}:${profile.username}` : null;

  useEffect(() => {
    if (!profile || profile.claimMode !== 'ens') return;
    let active = true;
    let requestId = 0;
    const refresh = async () => {
      const id = ++requestId;
      try {
        const verified = await createEnsIdentityReader().verify(profile.username, profile.account);
        if (active && id === requestId) setVerifiedName(verified ? { key: `${profile.account}:${profile.username}`, name: profile.username } : null);
      } catch {
        if (active && id === requestId) setVerifiedName(null);
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { setVerifiedName(null); void refresh(); }
    });
    return () => { active = false; subscription.remove(); };
  }, [profile]);

  return (
    <LauncherScreen
      accountAddress={profile?.account}
      username={verifiedName?.key === nameKey ? verifiedName.name : (profile ? shortenAddress(profile.account) : null)}
      ensVerified={Boolean(nameKey && verifiedName?.key === nameKey)}
      homeContent={
        <LauncherHome
          onOpenEarn={() => router.push('/earn')}
          onOpenSwap={() => router.push('/swap')}
          onOpenActivity={() => router.push('/transactions')}
        />
      }
      onOpenAssistant={agentConfigured && profile?.account ? () => router.push('/assistant') : undefined}
      onOpenWallet={() => router.push('/wallet')}
      onOpenPhone={() => router.push('/phone')}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
