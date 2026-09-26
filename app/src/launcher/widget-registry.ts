import type { SymbolViewProps } from 'expo-symbols';

import { HOME_GRID, rowHeights, type HomeLayout, type HomeLayoutItem, type WidgetId, type WidgetSize } from './home-layout';

export type WidgetDefinition = {
  id: WidgetId;
  title: string;
  subtitle: string;
  icon: SymbolViewProps['name'];
  sizes: readonly WidgetSize[];
  /** Natural height in dp of each size, keyed `${w}x${h}`; grid rows take their height from these. */
  heights: Readonly<Record<string, number>>;
  defaultSize: WidgetSize;
  removable: boolean;
};

export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
  {
    id: 'identity',
    title: 'Identity',
    subtitle: 'ENS name, address, links',
    icon: { ios: 'person.fill', android: 'person', web: 'person' },
    sizes: [{ w: 4, h: 2 }],
    heights: { '4x2': 106 },
    defaultSize: { w: 4, h: 2 },
    removable: true,
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
    heights: { '2x2': 148, '4x1': 66 },
    defaultSize: { w: 2, h: 2 },
    removable: true,
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
    heights: { '2x2': 148, '4x1': 66 },
    defaultSize: { w: 2, h: 2 },
    removable: false,
  },
  {
    id: 'market-pulse',
    title: 'Market pulse',
    subtitle: 'BTC, ETH · 24h',
    icon: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
    sizes: [
      { w: 4, h: 2 },
      { w: 2, h: 2 },
    ],
    heights: { '4x2': 194, '2x2': 148 },
    defaultSize: { w: 4, h: 2 },
    removable: true,
  },
  {
    id: 'swap-earn',
    title: 'Swap / Earn',
    subtitle: 'Quick entry points',
    icon: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
    sizes: [
      { w: 4, h: 1 },
      { w: 2, h: 2 },
      { w: 2, h: 1 },
    ],
    heights: { '4x1': 110, '2x2': 148, '2x1': 72 },
    defaultSize: { w: 4, h: 1 },
    removable: true,
  },
  {
    id: 'activity',
    title: 'Activity',
    subtitle: 'Latest transaction',
    icon: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
    sizes: [{ w: 4, h: 1 }],
    heights: { '4x1': 66 },
    defaultSize: { w: 4, h: 1 },
    removable: true,
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

/** Natural height of a widget at a size; falls back to whole 72 dp rows for sizes without an entry. */
export function widgetHeight(definition: WidgetDefinition, size: WidgetSize): number {
  return definition.heights[`${size.w}x${size.h}`] ?? size.h * HOME_GRID.rowHeight + (size.h - 1) * HOME_GRID.gap;
}

/** Row heights for a layout from each widget's natural height; see `rowHeights`. */
export function layoutRowHeights(items: readonly HomeLayoutItem[], rows: number): number[] {
  return rowHeights(items, (item) => widgetHeight(getWidgetDefinition(item.id), item), rows);
}

/**
 * The supported size nearest to `target` on one axis, used when a resize handle is released.
 * Ties prefer the size that keeps the other axis unchanged.
 */
export function nearestSupportedSize(
  definition: WidgetDefinition,
  current: WidgetSize,
  axis: 'w' | 'h',
  target: number,
): WidgetSize {
  const other = axis === 'w' ? 'h' : 'w';
  const score = (size: WidgetSize) => Math.abs(size[axis] - target) * 2 + (size[other] === current[other] ? 0 : 1);
  return definition.sizes.reduce((best, size) => (score(size) < score(best) ? size : best), definition.sizes[0]);
}

/** Supported sizes after `current`, in registry order and wrapping around, for cycling from the size tag. */
export function sizesAfter(definition: WidgetDefinition, current: WidgetSize): WidgetSize[] {
  const index = definition.sizes.findIndex((size) => size.w === current.w && size.h === current.h);
  return [...definition.sizes.slice(index + 1), ...definition.sizes.slice(0, Math.max(index, 0))];
}

export function supportsSize(definition: WidgetDefinition, size: WidgetSize): boolean {
  return definition.sizes.some((supported) => supported.w === size.w && supported.h === size.h);
}

/** Default layout: the pre-widget home in the same order and arrangement. */
const DEFAULT_ITEMS: readonly HomeLayoutItem[] = [
  { id: 'identity', x: 0, y: 0, w: 4, h: 2 },
  { id: 'wallet', x: 0, y: 2, w: 2, h: 2 },
  { id: 'phone', x: 2, y: 2, w: 2, h: 2 },
  { id: 'swap-earn', x: 0, y: 4, w: 4, h: 1 },
  { id: 'market-pulse', x: 0, y: 5, w: 4, h: 2 },
  { id: 'activity', x: 0, y: 7, w: 4, h: 1 },
];

export function defaultHomeLayout(): HomeLayout {
  return { columns: HOME_GRID.columns, items: DEFAULT_ITEMS.map((item) => ({ ...item })) };
}
