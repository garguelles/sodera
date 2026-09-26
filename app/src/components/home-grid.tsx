import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { EmptyCell, RemoveButton, ResizeHandle, SelectionOutline, SizeTag } from '@/components/home-edit-chrome';
import {
  cellRect,
  columnWidth,
  gridHeight,
  HOME_GRID,
  rowCount,
  rowHeights,
  rowTop,
  type GridCell,
  type GridMetrics,
  type HomeLayout,
  type HomeLayoutItem,
  type WidgetId,
  type WidgetSize,
} from '@/launcher/home-layout';
import { getWidgetDefinition, nearestSupportedSize, widgetHeight } from '@/launcher/widget-registry';

type HomeGridProps = {
  layout: HomeLayout;
  renderWidget(item: HomeLayoutItem): ReactNode;
  onLayoutMetrics?(metrics: GridMetrics): void;
  /** Long-press anywhere on the grid: the widget under the finger, or null for empty space. Disabled while editing. */
  onLongPress?(id: WidgetId | null): void;
  editing?: boolean;
  selectedId?: WidgetId | null;
  onSelect?(id: WidgetId): void;
  onRemove?(id: WidgetId): void;
  /** A resize handle was released; the size is a supported size and may not fit. */
  onResize?(id: WidgetId, size: WidgetSize): void;
  onCycleSize?(id: WidgetId): void;
  onAddAt?(cell: GridCell): void;
};

const LONG_PRESS_MS = 450;

/** Positions widgets on the 4-column home grid. Widgets fill the cell rectangle they are given. */
export function HomeGrid({
  layout,
  renderWidget,
  onLayoutMetrics,
  onLongPress,
  editing = false,
  selectedId = null,
  onSelect,
  onRemove,
  onResize,
  onCycleSize,
  onAddAt,
}: HomeGridProps) {
  const [width, setWidth] = useState(0);
  const rows = rowCount(layout) + (editing ? 1 : 0);
  const heights = rowHeights(layout.items, (item) => widgetHeight(getWidgetDefinition(item.id), item), rows);
  const metrics: GridMetrics = { columnWidth: columnWidth(width), gap: HOME_GRID.gap, rowHeights: heights };
  const selected = editing ? (layout.items.find((item) => item.id === selectedId) ?? null) : null;

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next === width) return;
    setWidth(next);
    onLayoutMetrics?.({ ...metrics, columnWidth: columnWidth(next) });
  };

  // One long-press on the whole grid, hit-tested against the cells. A long-press on each cell would never fire,
  // because the widgets' own buttons take the touch first.
  const longPress = Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .enabled(!editing && onLongPress !== undefined)
    .runOnJS(true)
    .onStart((event) => {
      const hit = layout.items.find((item) => {
        const rect = cellRect(item, metrics);
        return event.x >= rect.left && event.x <= rect.left + rect.width && event.y >= rect.top && event.y <= rect.top + rect.height;
      });
      onLongPress?.(hit?.id ?? null);
    })
    .withTestId('home-grid-long-press');

  const resizeFromHandle = (item: HomeLayoutItem, axis: 'w' | 'h', translation: number) => {
    const definition = getWidgetDefinition(item.id);
    const rect = cellRect(item, metrics);
    let target = 1;
    if (axis === 'w') {
      target = Math.round((rect.width + translation + metrics.gap) / (metrics.columnWidth + metrics.gap));
    } else {
      const bottom = rect.top + rect.height + translation;
      const distance = (h: number) => Math.abs(rowTop(metrics, item.y + h) - metrics.gap - bottom);
      const maxH = Math.max(...definition.sizes.map((size) => size.h));
      for (let h = 2; h <= maxH; h += 1) if (distance(h) < distance(target)) target = h;
    }
    const size = nearestSupportedSize(definition, item, axis, target);
    if (size.w !== item.w || size.h !== item.h) onResize?.(item.id, size);
  };

  return (
    <GestureDetector gesture={longPress}>
      <View onLayout={handleLayout} style={[styles.grid, { height: gridHeight(metrics, rows) }]} testID="home-grid">
        {width > 0 ? (
          <>
            {editing
              ? emptyCells(layout.items, rows).map((cell) => (
                  <View key={`empty-${cell.x}-${cell.y}`} style={[styles.cell, cellRect({ ...cell, w: 1, h: 1 }, metrics)]} testID="home-empty-cell">
                    <EmptyCell onPress={() => onAddAt?.(cell)} />
                  </View>
                ))
              : null}
            {layout.items.map((item) => {
              const rect = cellRect(item, metrics);
              if (!editing) {
                return (
                  <View key={item.id} style={[styles.cell, rect]} testID={`home-cell-${item.id}`}>
                    {renderWidget(item)}
                  </View>
                );
              }
              const isSelected = item.id === selectedId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${getWidgetDefinition(item.id).title}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelect?.(item.id)}
                  style={[styles.cell, rect, selected !== null && !isSelected && styles.faded]}
                  testID={`home-cell-${item.id}`}>
                  <View pointerEvents="none" style={styles.fill} testID={`home-widget-${item.id}`}>
                    {renderWidget(item)}
                  </View>
                </Pressable>
              );
            })}
            {selected ? (
              <SelectionChrome item={selected} metrics={metrics} onRemove={onRemove} onCycleSize={onCycleSize} onResizeFromHandle={resizeFromHandle} />
            ) : null}
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function SelectionChrome({
  item,
  metrics,
  onRemove,
  onCycleSize,
  onResizeFromHandle,
}: {
  item: HomeLayoutItem;
  metrics: GridMetrics;
  onRemove?(id: WidgetId): void;
  onCycleSize?(id: WidgetId): void;
  onResizeFromHandle(item: HomeLayoutItem, axis: 'w' | 'h', translation: number): void;
}) {
  const definition = getWidgetDefinition(item.id);
  const rect = cellRect(item, metrics);
  const canChangeWidth = new Set(definition.sizes.map((size) => size.w)).size > 1;
  const canChangeHeight = new Set(definition.sizes.map((size) => size.h)).size > 1;
  const sizeKey = `${item.id}-${item.w}x${item.h}`;

  return (
    <>
      <SelectionOutline rect={rect} />
      {canChangeWidth ? (
        <ResizeHandle key={`right-${sizeKey}`} rect={rect} edge="right" onResizeEnd={(translation) => onResizeFromHandle(item, 'w', translation)} />
      ) : null}
      {canChangeHeight ? (
        <ResizeHandle key={`bottom-${sizeKey}`} rect={rect} edge="bottom" onResizeEnd={(translation) => onResizeFromHandle(item, 'h', translation)} />
      ) : null}
      <SizeTag rect={rect} size={item} onCycleSize={() => onCycleSize?.(item.id)} />
      <RemoveButton rect={rect} title={definition.title} removable={definition.removable} onRemove={() => onRemove?.(item.id)} />
    </>
  );
}

function emptyCells(items: HomeLayoutItem[], rows: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < HOME_GRID.columns; x += 1) {
      const occupied = items.some((item) => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h);
      if (!occupied) cells.push({ x, y });
    }
  }
  return cells;
}

const styles = StyleSheet.create({
  grid: { position: 'relative', width: '100%' },
  cell: { position: 'absolute' },
  fill: { flex: 1 },
  faded: { opacity: 0.5 },
});
