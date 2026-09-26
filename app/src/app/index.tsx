import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';

import { readAgentConfigFromEnv } from '@/agent/agent-client';
import { HomeGrid } from '@/components/home-grid';
import { LauncherScreen } from '@/components/launcher-screen';
import { ActivityWidget } from '@/components/widgets/activity-widget';
import { IdentityWidget } from '@/components/widgets/identity-widget';
import { MarketPulseWidget } from '@/components/widgets/market-pulse-widget';
import { PhoneWidget } from '@/components/widgets/phone-widget';
import { SwapEarnWidget } from '@/components/widgets/swap-earn-widget';
import { WalletWidget } from '@/components/widgets/wallet-widget';
import { removeWidget, resizeWidget, type HomeLayout, type HomeLayoutItem, type WidgetId, type WidgetSize } from '@/launcher/home-layout';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';
import { useLauncherPreferences } from '@/launcher/use-launcher-preferences';
import { defaultHomeLayout, getWidgetDefinition, sizesAfter } from '@/launcher/widget-registry';
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
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<WidgetId | null>(null);
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const openPhone = () => router.push('/phone');

  // Editing waits for preferences so the first save starts from what is stored.
  const canEdit = preferences !== null;

  const enterEdit = useCallback((id: WidgetId | null) => {
    setSelectedId(id);
    setEditing(true);
  }, []);

  const exitEdit = useCallback(() => {
    setEditing(false);
    setSelectedId(null);
  }, []);

  // Settings' "Edit home" row opens the home with ?edit=1.
  useEffect(() => {
    if (edit !== '1' || !canEdit) return;
    enterEdit(null);
    router.setParams({ edit: undefined });
  }, [edit, canEdit, enterEdit]);

  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      exitEdit();
      return true;
    });
    return () => subscription.remove();
  }, [editing, exitEdit]);

  // Navigating away ends edit mode; every change is already saved.
  useFocusEffect(useCallback(() => exitEdit, [exitEdit]));

  const applyLayout = (next: HomeLayout | null) => {
    if (next) void save({ homeLayout: next }).catch(() => undefined);
  };

  const handleRemove = (id: WidgetId) => {
    if (!getWidgetDefinition(id).removable) return;
    applyLayout(removeWidget(layout, id));
    setSelectedId(null);
  };

  const handleResize = (id: WidgetId, size: WidgetSize) => applyLayout(resizeWidget(layout, id, size));

  const handleCycleSize = (id: WidgetId) => {
    const item = layout.items.find((entry) => entry.id === id);
    if (!item) return;
    for (const size of sizesAfter(getWidgetDefinition(id), item)) {
      const next = resizeWidget(layout, id, size);
      if (next) return applyLayout(next);
    }
  };

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
      editing={editing}
      onDone={exitEdit}
      homeContent={
        <HomeGrid
          layout={layout}
          renderWidget={renderWidget}
          editing={editing}
          selectedId={selectedId}
          onLongPress={canEdit ? enterEdit : undefined}
          onSelect={setSelectedId}
          onRemove={handleRemove}
          onResize={handleResize}
          onCycleSize={handleCycleSize}
          // Section 4 opens the widgets sheet from an empty cell.
          onAddAt={() => undefined}
        />
      }
      onOpenAssistant={agentConfigured && account ? () => router.push('/assistant') : undefined}
      onOpenPhone={openPhone}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
