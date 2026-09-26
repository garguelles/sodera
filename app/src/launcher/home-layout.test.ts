import {
  cellRect,
  columnWidth,
  fits,
  HOME_GRID,
  moveWidget,
  placeWidget,
  removeWidget,
  resizeWidget,
  rowCount,
  slotAt,
  type GridMetrics,
  type HomeLayout,
} from './home-layout';

const layoutOf = (...items: HomeLayout['items']): HomeLayout => ({ columns: 4, items });

const metrics: GridMetrics = { columnWidth: columnWidth(360), rowHeight: HOME_GRID.rowHeight, gap: HOME_GRID.gap };

describe('home layout', () => {
  it('counts rows from the lowest item', () => {
    expect(rowCount(layoutOf())).toBe(0);
    expect(
      rowCount(layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 }, { id: 'activity', x: 0, y: 4, w: 4, h: 1 })),
    ).toBe(5);
  });

  describe('fits', () => {
    const layout = layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 });

    it('rejects overlap with another item', () => {
      expect(fits(layout, { id: 'phone', x: 1, y: 1, w: 2, h: 2 })).toBe(false);
      expect(fits(layout, { id: 'phone', x: 2, y: 0, w: 2, h: 2 })).toBe(true);
    });

    it('rejects rectangles outside the columns', () => {
      expect(fits(layout, { id: 'phone', x: 3, y: 2, w: 2, h: 2 })).toBe(false);
      expect(fits(layout, { id: 'phone', x: -1, y: 2, w: 2, h: 2 })).toBe(false);
      expect(fits(layout, { id: 'phone', x: 0, y: -1, w: 2, h: 1 })).toBe(false);
      expect(fits(layout, { id: 'phone', x: 0.5, y: 2, w: 2, h: 1 })).toBe(false);
    });

    it('ignores the item with the same id', () => {
      expect(fits(layout, { id: 'wallet', x: 1, y: 0, w: 2, h: 2 })).toBe(true);
    });

    it('allows any row below the content', () => {
      expect(fits(layout, { id: 'phone', x: 0, y: 99, w: 4, h: 1 })).toBe(true);
    });
  });

  describe('placeWidget', () => {
    it('fills row-major from the top-left', () => {
      const layout = placeWidget(placeWidget(layoutOf(), 'wallet', { w: 2, h: 2 }), 'phone', { w: 2, h: 2 });
      expect(layout.items).toEqual([
        { id: 'wallet', x: 0, y: 0, w: 2, h: 2 },
        { id: 'phone', x: 2, y: 0, w: 2, h: 2 },
      ]);
    });

    it('skips occupied cells', () => {
      const layout = placeWidget(
        layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 }, { id: 'phone', x: 2, y: 1, w: 2, h: 2 }),
        'swap-earn',
        { w: 2, h: 1 },
      );
      expect(layout.items.at(-1)).toEqual({ id: 'swap-earn', x: 2, y: 0, w: 2, h: 1 });
    });

    it('fills a gap left in the middle of the grid', () => {
      const layout = placeWidget(
        layoutOf({ id: 'identity', x: 0, y: 0, w: 4, h: 2 }, { id: 'activity', x: 0, y: 3, w: 4, h: 1 }),
        'intent-bar',
        { w: 4, h: 1 },
      );
      expect(layout.items.at(-1)).toEqual({ id: 'intent-bar', x: 0, y: 2, w: 4, h: 1 });
    });

    it('appends below the content when no slot is free', () => {
      const layout = placeWidget(
        layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 }, { id: 'phone', x: 2, y: 0, w: 2, h: 2 }),
        'activity',
        { w: 4, h: 1 },
      );
      expect(layout.items.at(-1)).toEqual({ id: 'activity', x: 0, y: 2, w: 4, h: 1 });
    });

    it('replaces an existing instance instead of duplicating it', () => {
      const layout = placeWidget(
        layoutOf({ id: 'identity', x: 0, y: 0, w: 4, h: 2 }, { id: 'wallet', x: 0, y: 2, w: 2, h: 2 }),
        'wallet',
        { w: 4, h: 1 },
      );
      expect(layout.items.filter((item) => item.id === 'wallet')).toEqual([{ id: 'wallet', x: 0, y: 2, w: 4, h: 1 }]);
    });

    it('does not mutate the input layout', () => {
      const layout = layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 });
      placeWidget(layout, 'phone', { w: 2, h: 2 });
      expect(layout.items).toHaveLength(1);
    });
  });

  describe('moveWidget', () => {
    const layout = layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 }, { id: 'phone', x: 2, y: 0, w: 2, h: 2 });

    it('returns null on collision', () => {
      expect(moveWidget(layout, 'wallet', 1, 0)).toBeNull();
      expect(moveWidget(layout, 'wallet', 3, 2)).toBeNull();
    });

    it('succeeds when the only overlap is the item itself', () => {
      expect(moveWidget(layout, 'wallet', 0, 1)?.items[0]).toEqual({ id: 'wallet', x: 0, y: 1, w: 2, h: 2 });
    });

    it('returns null for a widget that is not placed', () => {
      expect(moveWidget(layout, 'activity', 0, 4)).toBeNull();
    });
  });

  describe('resizeWidget', () => {
    const layout = layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 }, { id: 'phone', x: 2, y: 0, w: 2, h: 2 });

    it('returns null on collision', () => {
      expect(resizeWidget(layout, 'wallet', { w: 4, h: 1 })).toBeNull();
    });

    it('succeeds when the only overlap is the item itself', () => {
      const resized = resizeWidget(layout, 'wallet', { w: 2, h: 1 });
      expect(resized?.items[0]).toEqual({ id: 'wallet', x: 0, y: 0, w: 2, h: 1 });
      expect(resized?.items[1]).toEqual(layout.items[1]);
    });
  });

  it('removes a widget and lowers the row count', () => {
    const layout = layoutOf({ id: 'wallet', x: 0, y: 0, w: 2, h: 2 }, { id: 'activity', x: 0, y: 2, w: 4, h: 1 });
    const removed = removeWidget(layout, 'activity');
    expect(removed.items.map((item) => item.id)).toEqual(['wallet']);
    expect(rowCount(removed)).toBeLessThan(rowCount(layout));
  });

  describe('geometry', () => {
    it('computes column width from the grid width', () => {
      expect(columnWidth(360)).toBe(81);
    });

    it('computes cell rectangles for multi-cell items', () => {
      expect(cellRect({ x: 2, y: 1, w: 2, h: 2 }, metrics)).toEqual({
        left: 2 * (81 + 12),
        top: 72 + 12,
        width: 2 * 81 + 12,
        height: 2 * 72 + 12,
      });
    });

    it('round-trips cellRect and slotAt for every cell', () => {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < HOME_GRID.columns; x += 1) {
          const rect = cellRect({ x, y, w: 1, h: 1 }, metrics);
          expect(slotAt({ x: rect.left, y: rect.top }, { w: 1, h: 1 }, metrics)).toEqual({ x, y });
        }
      }
    });

    it('snaps to the nearest slot and clamps to the columns', () => {
      expect(slotAt({ x: 60, y: 30 }, { w: 1, h: 1 }, metrics)).toEqual({ x: 1, y: 0 });
      expect(slotAt({ x: 1000, y: -50 }, { w: 2, h: 2 }, metrics)).toEqual({ x: 2, y: 0 });
      expect(slotAt({ x: -40, y: 400 }, { w: 4, h: 1 }, metrics)).toEqual({ x: 0, y: 5 });
    });
  });
});
