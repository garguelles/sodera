export type WidgetId = 'intent-bar' | 'identity' | 'wallet' | 'phone' | 'market-pulse' | 'swap-earn' | 'activity';
export type WidgetSize = { w: number; h: number };
export type HomeLayoutItem = { id: WidgetId; x: number; y: number; w: number; h: number };
export type HomeLayout = { columns: 4; items: HomeLayoutItem[] };
export type GridMetrics = { columnWidth: number; rowHeight: number; gap: number };
export type GridCell = { x: number; y: number };
export type CellRect = { left: number; top: number; width: number; height: number };

export const HOME_GRID = { columns: 4, rowHeight: 72, gap: 12 } as const;

/** Number of rows occupied by the lowest item; 0 when the layout is empty. */
export function rowCount(layout: HomeLayout): number {
  return layout.items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

function inBounds(rect: HomeLayoutItem): boolean {
  return (
    [rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) &&
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= HOME_GRID.columns
  );
}

function overlaps(a: HomeLayoutItem, b: HomeLayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when `rect` is inside the grid and overlaps no item other than one with the same id. */
export function fits(layout: HomeLayout, rect: HomeLayoutItem): boolean {
  return inBounds(rect) && layout.items.every((item) => item.id === rect.id || !overlaps(item, rect));
}

/** Places a widget in the first free slot, row-major, replacing any existing instance. */
export function placeWidget(layout: HomeLayout, id: WidgetId, size: WidgetSize): HomeLayout {
  const base = removeWidget(layout, id);
  const lastRow = rowCount(base);

  for (let y = 0; y <= lastRow; y += 1) {
    for (let x = 0; x + size.w <= HOME_GRID.columns; x += 1) {
      const candidate = { id, x, y, ...size };
      if (fits(base, candidate)) return { ...base, items: [...base.items, candidate] };
    }
  }

  // Only reachable when the size is wider than the grid; clamp it to the left edge below everything.
  return { ...base, items: [...base.items, { id, x: 0, y: lastRow, ...size }] };
}

/** Moves a widget to a new top-left cell, or returns null when it would not fit. */
export function moveWidget(layout: HomeLayout, id: WidgetId, x: number, y: number): HomeLayout | null {
  return replaceItem(layout, id, (item) => ({ ...item, x, y }));
}

/** Resizes a widget in place, keeping its top-left cell, or returns null when it would not fit. */
export function resizeWidget(layout: HomeLayout, id: WidgetId, size: WidgetSize): HomeLayout | null {
  return replaceItem(layout, id, (item) => ({ ...item, w: size.w, h: size.h }));
}

export function removeWidget(layout: HomeLayout, id: WidgetId): HomeLayout {
  return { ...layout, items: layout.items.filter((item) => item.id !== id) };
}

function replaceItem(
  layout: HomeLayout,
  id: WidgetId,
  update: (item: HomeLayoutItem) => HomeLayoutItem,
): HomeLayout | null {
  const current = layout.items.find((item) => item.id === id);
  if (!current) return null;

  const next = update(current);
  if (!fits(layout, next)) return null;

  return { ...layout, items: layout.items.map((item) => (item.id === id ? next : item)) };
}

export function columnWidth(gridWidth: number): number {
  return (gridWidth - (HOME_GRID.columns - 1) * HOME_GRID.gap) / HOME_GRID.columns;
}

export function cellRect(item: Pick<HomeLayoutItem, 'x' | 'y' | 'w' | 'h'>, metrics: GridMetrics): CellRect {
  return {
    left: item.x * (metrics.columnWidth + metrics.gap),
    top: item.y * (metrics.rowHeight + metrics.gap),
    width: item.w * metrics.columnWidth + (item.w - 1) * metrics.gap,
    height: item.h * metrics.rowHeight + (item.h - 1) * metrics.gap,
  };
}

/** Nearest top-left cell for a widget of `size` whose top-left corner is at `point`, clamped to the columns. */
export function slotAt(point: { x: number; y: number }, size: WidgetSize, metrics: GridMetrics): GridCell {
  const x = Math.round(point.x / (metrics.columnWidth + metrics.gap));
  const y = Math.round(point.y / (metrics.rowHeight + metrics.gap));
  return {
    x: Math.min(Math.max(x, 0), Math.max(HOME_GRID.columns - size.w, 0)),
    y: Math.max(y, 0),
  };
}
