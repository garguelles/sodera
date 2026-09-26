import { type ComponentType, type ReactNode, type RefObject, useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { EmptyCell, RemoveButton, ResizeHandle, SelectionOutline, SizeTag } from '@/components/home-edit-chrome';
import { platinum } from '@/constants/theme';
import {
  cellRect,
  columnWidth,
  gridHeight,
  HOME_GRID,
  dropWidget,
  rowCount,
  rowTop,
  slotAt,
  type GridCell,
  type GridMetrics,
  type HomeLayout,
  type HomeLayoutItem,
  type WidgetId,
  type WidgetSize,
} from '@/launcher/home-layout';
import { getWidgetDefinition, layoutRowHeights, nearestSupportedSize } from '@/launcher/widget-registry';

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
  /** The selected widget was dragged to a free slot, or onto a same-size widget to swap with it. */
  onMove?(id: WidgetId, x: number, y: number): void;
  /** A widget drag started or ended; the home disables scrolling while it is active. */
  onDragActiveChange?(active: boolean): void;
  /** The home's gesture-handler scroll view; a widget drag blocks it so the drag is not taken over by scrolling. */
  scrollGestureRef?: RefObject<unknown>;
  /** The grid's root view, for measuring where a widget dragged from the sheet was dropped. */
  gridRef?: RefObject<View | null>;
};

const { colors, radius } = platinum;
type Candidate = GridCell & { fits: boolean };

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
  onMove,
  onDragActiveChange,
  scrollGestureRef,
  gridRef,
}: HomeGridProps) {
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const rows = rowCount(layout) + (editing ? 1 : 0);
  const heights = layoutRowHeights(layout.items, rows);
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

  // Snap the dragged cell back to its (possibly new) position once the layout has caught up.
  useEffect(() => {
    dragX.value = 0;
    dragY.value = 0;
  }, [selected?.x, selected?.y, dragX, dragY]);

  const slotForDrag = (translationX: number, translationY: number): Candidate | null => {
    if (!selected) return null;
    const rect = cellRect(selected, metrics);
    const slot = slotAt({ x: rect.left + translationX, y: rect.top + translationY }, selected, metrics);
    return { ...slot, fits: dropWidget(layout, selected.id, slot.x, slot.y) !== null };
  };

  let movePan = Gesture.Pan()
    .minDistance(8)
    .enabled(selected !== null)
    .runOnJS(true)
    .onStart(() => {
      setDragging(true);
      onDragActiveChange?.(true);
    })
    .onUpdate((event) => {
      dragX.value = event.translationX;
      dragY.value = event.translationY;
      const next = slotForDrag(event.translationX, event.translationY);
      setCandidate((current) =>
        current && next && current.x === next.x && current.y === next.y && current.fits === next.fits ? current : next,
      );
    })
    .onEnd((event) => {
      const slot = slotForDrag(event.translationX, event.translationY);
      const moved = selected && slot?.fits && (slot.x !== selected.x || slot.y !== selected.y);
      if (moved) {
        onMove?.(selected.id, slot.x, slot.y);
      } else {
        dragX.value = withSpring(0);
        dragY.value = withSpring(0);
      }
    })
    .onFinalize(() => {
      setDragging(false);
      setCandidate(null);
      onDragActiveChange?.(false);
    })
    .withTestId('home-grid-move');
  if (scrollGestureRef) {
    movePan = movePan.blocksExternalGesture(scrollGestureRef as RefObject<ComponentType | null>);
  }
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value }, { translateY: dragY.value }] }));

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
      <View ref={gridRef} onLayout={handleLayout} style={[styles.grid, { height: gridHeight(metrics, rows) }]} testID="home-grid">
        {width > 0 ? (
          <>
            {editing
              ? emptyCells(layout.items, rows).map((cell) => (
                  <View key={`empty-${cell.x}-${cell.y}`} style={[styles.cell, cellRect({ ...cell, w: 1, h: 1 }, metrics)]} testID="home-empty-cell">
                    <EmptyCell onPress={() => onAddAt?.(cell)} />
                  </View>
                ))
              : null}
            {candidate && selected ? (
              <View
                pointerEvents="none"
                style={[styles.candidate, cellRect({ ...candidate, w: selected.w, h: selected.h }, metrics), candidate.fits ? styles.candidateFits : styles.candidateBlocked]}
                testID="home-drag-candidate"
              />
            ) : null}
            {[...layout.items].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId)).map((item) => {
              const rect = cellRect(item, metrics);
              if (!editing) {
                return (
                  <View key={item.id} style={[styles.cell, rect]} testID={`home-cell-${item.id}`}>
                    {renderWidget(item)}
                  </View>
                );
              }
              const isSelected = item.id === selectedId;
              const cell = (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${getWidgetDefinition(item.id).title}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelect?.(item.id)}
                  style={[styles.cell, isSelected ? styles.fillCell : rect, selected !== null && !isSelected && styles.faded]}
                  testID={`home-cell-${item.id}`}>
                  <View pointerEvents="none" style={styles.fill} testID={`home-widget-${item.id}`}>
                    {renderWidget(item)}
                  </View>
                </Pressable>
              );
              if (!isSelected) return cell;
              // The selected cell follows the finger while it is dragged.
              return (
                <GestureDetector key={item.id} gesture={movePan}>
                  <Animated.View style={[styles.cell, rect, dragStyle]}>{cell}</Animated.View>
                </GestureDetector>
              );
            })}
            {selected && !dragging ? (
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
  fillCell: { top: 0, left: 0, right: 0, bottom: 0 },
  candidate: { position: 'absolute', borderRadius: radius.xl, borderCurve: 'continuous' },
  candidateFits: { backgroundColor: colors.cyanWash, borderWidth: 1, borderColor: colors.cyan },
  candidateBlocked: { backgroundColor: colors.negativeWash, borderWidth: 1, borderColor: colors.negative },
  faded: { opacity: 0.5 },
});
