import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import {
  cellRect,
  columnWidth,
  gridHeight,
  HOME_GRID,
  rowCount,
  rowHeights,
  type GridCell,
  type GridMetrics,
  type HomeLayout,
  type HomeLayoutItem,
} from '@/launcher/home-layout';
import { getWidgetDefinition, widgetHeight } from '@/launcher/widget-registry';

type HomeGridProps = {
  layout: HomeLayout;
  renderWidget(item: HomeLayoutItem): ReactNode;
  /** Section 3 renders one extra row in edit mode. */
  extraRows?: number;
  renderEmptyCell?(cell: GridCell): ReactNode;
  onLayoutMetrics?(metrics: GridMetrics): void;
};

/** Positions widgets on the 4-column home grid. Widgets fill the cell rectangle they are given. */
export function HomeGrid({ layout, renderWidget, extraRows = 0, renderEmptyCell, onLayoutMetrics }: HomeGridProps) {
  const [width, setWidth] = useState(0);
  const rows = rowCount(layout) + extraRows;
  const heights = rowHeights(layout.items, (item) => widgetHeight(getWidgetDefinition(item.id), item), rows);
  const metrics: GridMetrics = { columnWidth: columnWidth(width), gap: HOME_GRID.gap, rowHeights: heights };

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next === width) return;
    setWidth(next);
    onLayoutMetrics?.({ ...metrics, columnWidth: columnWidth(next) });
  };

  return (
    <View
      onLayout={handleLayout}
      style={[styles.grid, { height: gridHeight(metrics, rows) }]}
      testID="home-grid">
      {width > 0 ? (
        <>
          {renderEmptyCell ? emptyCells(layout.items, rows).map((cell) => (
            <View key={`empty-${cell.x}-${cell.y}`} style={[styles.cell, cellRect({ ...cell, w: 1, h: 1 }, metrics)]}>
              {renderEmptyCell(cell)}
            </View>
          )) : null}
          {layout.items.map((item) => (
            <View key={item.id} style={[styles.cell, cellRect(item, metrics)]} testID={`home-cell-${item.id}`}>
              {renderWidget(item)}
            </View>
          ))}
        </>
      ) : null}
    </View>
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
});
