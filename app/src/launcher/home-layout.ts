export type WidgetId = 'identity' | 'wallet' | 'phone' | 'market-pulse' | 'swap-earn' | 'activity';
export type WidgetSize = { w: number; h: number };
export type HomeLayoutItem = { id: WidgetId; x: number; y: number; w: number; h: number };
export type HomeLayout = { columns: 4; items: HomeLayoutItem[] };
/**
 * Grid geometry. Rows take their height from the widgets in them (see `rowHeights`);
 * rows past the end of `rowHeights` use `HOME_GRID.rowHeight`.
 */
export type GridMetrics = { columnWidth: number; gap: number; rowHeights: readonly number[] };
export type GridCell = { x: number; y: number };
export type CellRect = { left: number; top: number; width: number; height: number };

/** `rowHeight` is only the height of an empty row, such as the extra row shown in edit mode. */
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

/**
 * Places a widget at `preferred` (an empty cell the user chose) when it fits there, otherwise in the first free slot.
 * Replaces any existing instance.
 */
export function addWidget(layout: HomeLayout, id: WidgetId, size: WidgetSize, preferred: GridCell | null = null): HomeLayout {
  const base = removeWidget(layout, id);
  const candidate = preferred ? { id, ...preferred, ...size } : null;
  if (candidate && fits(base, candidate)) return { ...base, items: [...base.items, candidate] };
  return placeWidget(base, id, size);
}

/** Moves a widget to a new top-left cell, or returns null when it would not fit. */
export function moveWidget(layout: HomeLayout, id: WidgetId, x: number, y: number): HomeLayout | null {
  return replaceItem(layout, id, (item) => ({ ...item, x, y }));
}

/**
 * Swaps a widget with the one whose top-left cell is (x, y) when both are the same size: the dragged widget takes that
 * slot and the other takes the dragged widget's old slot. Returns null when there is no same-size widget there.
 */
export function swapWidgets(layout: HomeLayout, id: WidgetId, x: number, y: number): HomeLayout | null {
  const dragged = layout.items.find((item) => item.id === id);
  const other = layout.items.find((item) => item.id !== id && item.x === x && item.y === y);
  if (!dragged || !other || other.w !== dragged.w || other.h !== dragged.h) return null;
  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.id === dragged.id) return { ...item, x, y };
      if (item.id === other.id) return { ...item, x: dragged.x, y: dragged.y };
      return item;
    }),
  };
}

/** Where a dragged widget ends up when released at (x, y): moved into free space, swapped with a same-size widget, or null. */
export function dropWidget(layout: HomeLayout, id: WidgetId, x: number, y: number): HomeLayout | null {
  return moveWidget(layout, id, x, y) ?? swapWidgets(layout, id, x, y);
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

/**
 * Height of each row from 0 to `rows − 1`. Single-row items set their row's height to at least their own;
 * then each multi-row item spreads any missing height evenly over its rows. Rows nothing occupies get
 * `HOME_GRID.rowHeight`. The result reproduces each widget's natural height with no gaps when rows are
 * shared by widgets of the same height, as in the default layout.
 */
export function rowHeights(
  items: readonly HomeLayoutItem[],
  heightOf: (item: HomeLayoutItem) => number,
  rows: number,
  gap: number = HOME_GRID.gap,
): number[] {
  const heights = Array.from({ length: rows }, () => 0);
  for (const item of items) {
    if (item.h === 1 && item.y < rows) heights[item.y] = Math.max(heights[item.y], heightOf(item));
  }
  for (const item of [...items].filter((entry) => entry.h > 1).sort((a, b) => a.h - b.h)) {
    const span = heights.slice(item.y, item.y + item.h);
    if (span.length < item.h) continue;
    const deficit = heightOf(item) - (span.reduce((sum, height) => sum + height, 0) + (item.h - 1) * gap);
    if (deficit > 0) {
      for (let y = item.y; y < item.y + item.h; y += 1) heights[y] += deficit / item.h;
    }
  }
  return heights.map((height) => (height > 0 ? height : HOME_GRID.rowHeight));
}

function rowHeightAt(metrics: GridMetrics, y: number): number {
  return metrics.rowHeights[y] ?? HOME_GRID.rowHeight;
}

/** Offset of the top of row `y` from the top of the grid. */
export function rowTop(metrics: GridMetrics, y: number): number {
  let top = 0;
  for (let row = 0; row < y; row += 1) top += rowHeightAt(metrics, row) + metrics.gap;
  return top;
}

/** Total height of `rows` rows. */
export function gridHeight(metrics: GridMetrics, rows: number): number {
  return rows > 0 ? rowTop(metrics, rows) - metrics.gap : 0;
}

export function cellRect(item: Pick<HomeLayoutItem, 'x' | 'y' | 'w' | 'h'>, metrics: GridMetrics): CellRect {
  return {
    left: item.x * (metrics.columnWidth + metrics.gap),
    top: rowTop(metrics, item.y),
    width: item.w * metrics.columnWidth + (item.w - 1) * metrics.gap,
    height: rowTop(metrics, item.y + item.h) - rowTop(metrics, item.y) - metrics.gap,
  };
}

/**
 * Top-left cell for a widget of `size` dropped with the finger at `point`: its top row is the row under the finger and
 * it is centred on the finger's column, clamped to the grid. Rows past `metrics.rowHeights` use the empty-row height.
 */
export function dropSlot(point: { x: number; y: number }, size: WidgetSize, metrics: GridMetrics): GridCell {
  const column = Math.floor(point.x / (metrics.columnWidth + metrics.gap));
  let y = 0;
  while (rowTop(metrics, y + 1) <= point.y) y += 1;
  const x = column - Math.floor((size.w - 1) / 2);
  return { x: Math.min(Math.max(x, 0), Math.max(HOME_GRID.columns - size.w, 0)), y: Math.max(y, 0) };
}

/** Nearest top-left cell for a widget of `size` whose top-left corner is at `point`, clamped to the columns. */
export function slotAt(point: { x: number; y: number }, size: WidgetSize, metrics: GridMetrics): GridCell {
  const x = Math.round(point.x / (metrics.columnWidth + metrics.gap));
  let y = 0;
  while (rowTop(metrics, y + 1) <= point.y) y += 1;
  if (point.y - rowTop(metrics, y) > rowTop(metrics, y + 1) - point.y) y += 1;
  return {
    x: Math.min(Math.max(x, 0), Math.max(HOME_GRID.columns - size.w, 0)),
    y,
  };
}
