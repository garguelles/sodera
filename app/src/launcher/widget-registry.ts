import type { Address } from 'viem';

import { HOME_GRID, type HomeLayout, type HomeLayoutItem, type WidgetId, type WidgetSize } from './home-layout';

export type WidgetContext = { agentConfigured: boolean; account: Address | null };

export type WidgetDefinition = {
  id: WidgetId;
  title: string;
  subtitle: string;
  /** SymbolView names. */
  icon: { ios: string; android: string; web: string };
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  removable: boolean;
  isAvailable(context: WidgetContext): boolean;
};

const always = () => true;

export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
  {
    id: 'intent-bar',
    title: 'Intent bar',
    subtitle: 'Ask your wallet',
    icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
    sizes: [{ w: 4, h: 1 }],
    defaultSize: { w: 4, h: 1 },
    removable: true,
    isAvailable: (context) => context.agentConfigured && context.account !== null,
  },
  {
    id: 'identity',
    title: 'Identity',
    subtitle: 'ENS name, address, links',
    icon: { ios: 'person.fill', android: 'person', web: 'person' },
    sizes: [{ w: 4, h: 2 }],
    defaultSize: { w: 4, h: 2 },
    removable: true,
    isAvailable: always,
  },
  {
    id: 'wallet',
    title: 'Wallet',
    subtitle: 'Balance, opens wallet',
    icon: { ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'wallet' },
    sizes: [
      { w: 2, h: 2 },
      { w: 4, h: 1 },
    ],
    defaultSize: { w: 2, h: 2 },
    removable: true,
    isAvailable: always,
  },
  {
    id: 'phone',
    title: 'Phone',
    subtitle: 'All your apps',
    icon: { ios: 'square.grid.2x2.fill', android: 'apps', web: 'apps' },
    sizes: [
      { w: 2, h: 2 },
      { w: 4, h: 1 },
    ],
    defaultSize: { w: 2, h: 2 },
    removable: false,
    isAvailable: always,
  },
  {
    id: 'market-pulse',
    title: 'Market pulse',
    subtitle: 'BTC, ETH · 24h',
    icon: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
    sizes: [
      { w: 2, h: 2 },
      { w: 4, h: 2 },
    ],
    defaultSize: { w: 2, h: 2 },
    removable: true,
    isAvailable: always,
  },
  {
    id: 'swap-earn',
    title: 'Swap / Earn',
    subtitle: 'Quick entry points',
    icon: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
    sizes: [
      { w: 2, h: 2 },
      { w: 2, h: 1 },
    ],
    defaultSize: { w: 2, h: 2 },
    removable: true,
    isAvailable: always,
  },
  {
    id: 'activity',
    title: 'Activity',
    subtitle: 'Latest transaction',
    icon: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
    sizes: [{ w: 4, h: 1 }],
    defaultSize: { w: 4, h: 1 },
    removable: true,
    isAvailable: always,
  },
];

const DEFINITIONS_BY_ID = new Map(WIDGET_REGISTRY.map((definition) => [definition.id, definition]));

export function getWidgetDefinition(id: WidgetId): WidgetDefinition {
  const definition = DEFINITIONS_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown widget: ${id}`);
  return definition;
}

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && DEFINITIONS_BY_ID.has(value as WidgetId);
}

export function supportsSize(definition: WidgetDefinition, size: WidgetSize): boolean {
  return definition.sizes.some((supported) => supported.w === size.w && supported.h === size.h);
}

/** Default layout with the intent bar in row 0; every other item moves up a row when the bar is unavailable. */
const DEFAULT_ITEMS: readonly HomeLayoutItem[] = [
  { id: 'intent-bar', x: 0, y: 0, w: 4, h: 1 },
  { id: 'identity', x: 0, y: 1, w: 4, h: 2 },
  { id: 'wallet', x: 0, y: 3, w: 2, h: 2 },
  { id: 'phone', x: 2, y: 3, w: 2, h: 2 },
  { id: 'swap-earn', x: 0, y: 5, w: 2, h: 2 },
  { id: 'market-pulse', x: 2, y: 5, w: 2, h: 2 },
  { id: 'activity', x: 0, y: 7, w: 4, h: 1 },
];

export function defaultHomeLayout(context: WidgetContext): HomeLayout {
  const intentBar = getWidgetDefinition('intent-bar').isAvailable(context);
  const items = intentBar
    ? DEFAULT_ITEMS.map((item) => ({ ...item }))
    : DEFAULT_ITEMS.filter((item) => item.id !== 'intent-bar').map((item) => ({ ...item, y: item.y - 1 }));
  return { columns: HOME_GRID.columns, items };
}
