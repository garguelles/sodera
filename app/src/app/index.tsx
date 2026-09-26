import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, type ScrollView } from 'react-native';

import { readAgentConfigFromEnv } from '@/agent/agent-client';
import { HomeGrid } from '@/components/home-grid';
import { LauncherScreen } from '@/components/launcher-screen';
import { WIDGET_SHEET_COLLAPSED_HEIGHT, WidgetSheet } from '@/components/widget-sheet';
import { platinum } from '@/constants/theme';
import { ActivityWidget } from '@/components/widgets/activity-widget';
import { IdentityWidget } from '@/components/widgets/identity-widget';
import { MarketPulseWidget } from '@/components/widgets/market-pulse-widget';
import { PhoneWidget } from '@/components/widgets/phone-widget';
import { SwapEarnWidget } from '@/components/widgets/swap-earn-widget';
import { WalletWidget } from '@/components/widgets/wallet-widget';
import {
  addWidget,
  HOME_GRID,
  removeWidget,
  resizeWidget,
  rowTop,
  type GridCell,
  type HomeLayout,
  type HomeLayoutItem,
  type WidgetId,
  type WidgetSize,
} from '@/launcher/home-layout';
import { launcherPreferencesNativeStorage } from '@/launcher/launcher-preferences-native-storage';
import { useLauncherPreferences } from '@/launcher/use-launcher-preferences';
import { defaultHomeLayout, getWidgetDefinition, layoutRowHeights, sizesAfter, WIDGET_REGISTRY } from '@/launcher/widget-registry';
import { useOnboarding } from '@/onboarding/onboarding-context';
import { pendingSends } from '@/wallet/pending-sends';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';

const agentConfigured = readAgentConfigFromEnv() !== null;
/** Phone is the app drawer and cannot be removed, so it is never offered in the sheet. */
const SHEET_DEFINITIONS = WIDGET_REGISTRY.filter((definition) => definition.removable);
/** Top padding of the home scroll content in edit mode (`contentEditing` in `LauncherScreen`). */
const EDIT_CONTENT_TOP = platinum.spacing.lg;

export default function HomeScreen() {
  const { access } = useOnboarding();
  const profile = access?.status === 'complete' ? access.profile : null;
  const account = profile?.account ?? null;
  const { preferences, save } = useLauncherPreferences(launcherPreferencesNativeStorage);
  const layout = preferences?.homeLayout ?? defaultHomeLayout();
  const amountsVisible = preferences?.amountsVisible ?? true;
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<WidgetId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The empty cell the sheet was opened from; the next added widget goes there if it fits.
  const [pendingCell, setPendingCell] = useState<GridCell | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollMetrics = useRef({ offset: 0, viewportHeight: 0 });
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const openPhone = () => router.push('/phone');

  // Editing waits for preferences so the first save starts from what is stored.
  const canEdit = preferences !== null;

  const enterEdit = useCallback((id: WidgetId | null) => {
    setSelectedId(id);
    setEditing(true);
    setSheetOpen(true);
  }, []);

  const exitEdit = useCallback(() => {
    setEditing(false);
    setSelectedId(null);
    setSheetOpen(false);
    setPendingCell(null);
  }, []);

  const changeSheetOpen = (open: boolean) => {
    setSheetOpen(open);
    if (!open) setPendingCell(null);
  };

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

  const handleAddAt = (cell: GridCell) => {
    setPendingCell(cell);
    setSheetOpen(true);
  };

  const handleAdd = (id: WidgetId) => {
    const next = addWidget(layout, id, getWidgetDefinition(id).defaultSize, pendingCell);
    applyLayout(next);
    setSelectedId(id);
    setSheetOpen(false);
    setPendingCell(null);
    const added = next.items.find((item) => item.id === id);
    if (added) scrollIntoView(next, added);
  };

  /** Scrolls the home so a newly added widget is visible above the collapsed sheet. */
  const scrollIntoView = (next: HomeLayout, item: HomeLayoutItem) => {
    const metrics = { columnWidth: 0, gap: HOME_GRID.gap, rowHeights: layoutRowHeights(next.items, item.y + item.h) };
    const top = EDIT_CONTENT_TOP + rowTop(metrics, item.y);
    const bottom = EDIT_CONTENT_TOP + rowTop(metrics, item.y + item.h) - HOME_GRID.gap;
    const { offset, viewportHeight } = scrollMetrics.current;
    const visibleBottom = offset + viewportHeight - WIDGET_SHEET_COLLAPSED_HEIGHT;
    if (top < offset || bottom > visibleBottom) {
      scrollRef.current?.scrollTo({ y: Math.max(0, top - HOME_GRID.gap), animated: true });
    }
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
      scrollRef={scrollRef}
      onScrollMetrics={(metrics) => {
        scrollMetrics.current = metrics;
      }}
      contentInsetBottom={editing ? WIDGET_SHEET_COLLAPSED_HEIGHT : 0}
      overlay={
        editing ? (
          <WidgetSheet
            definitions={SHEET_DEFINITIONS}
            placedIds={new Set(layout.items.map((item) => item.id))}
            open={sheetOpen}
            onOpenChange={changeSheetOpen}
            onAdd={handleAdd}
          />
        ) : null
      }
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
          onAddAt={handleAddAt}
        />
      }
      onOpenAssistant={agentConfigured && account ? () => router.push('/assistant') : undefined}
      onOpenPhone={openPhone}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}
