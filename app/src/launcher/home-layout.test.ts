import {
  cellRect,
  columnWidth,
  fits,
  gridHeight,
  HOME_GRID,
  moveWidget,
  placeWidget,
  removeWidget,
  resizeWidget,
  rowCount,
  rowHeights,
  rowTop,
  slotAt,
  type GridMetrics,
  type HomeLayout,
} from './home-layout';

const layoutOf = (...items: HomeLayout['items']): HomeLayout => ({ columns: 4, items });

const metrics: GridMetrics = { columnWidth: columnWidth(360), gap: HOME_GRID.gap, rowHeights: [] };
const uneven: GridMetrics = { columnWidth: columnWidth(360), gap: HOME_GRID.gap, rowHeights: [49, 49, 68, 68, 110] };

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
        'swap-earn',
        { w: 4, h: 1 },
      );
      expect(layout.items.at(-1)).toEqual({ id: 'swap-earn', x: 0, y: 2, w: 4, h: 1 });
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

  describe('rowHeights', () => {
    const heightOf = (item: HomeLayout['items'][number]) =>
      ({ identity: 106, wallet: 148, phone: 148, 'swap-earn': 110, activity: 66 } as Record<string, number>)[item.id] ?? 0;

    it('gives each widget its natural height with no gaps', () => {
      const items: HomeLayout['items'] = [
        { id: 'identity', x: 0, y: 0, w: 4, h: 2 },
        { id: 'wallet', x: 0, y: 2, w: 2, h: 2 },
        { id: 'phone', x: 2, y: 2, w: 2, h: 2 },
        { id: 'swap-earn', x: 0, y: 4, w: 4, h: 1 },
        { id: 'activity', x: 0, y: 5, w: 4, h: 1 },
      ];
      const heights = rowHeights(items, heightOf, 6);
      const geometry = { columnWidth: 81, gap: 12, rowHeights: heights };

      expect(heights).toEqual([47, 47, 68, 68, 110, 66]);
      for (const item of items) expect(cellRect(item, geometry).height).toBe(heightOf(item));
    });

    it('uses the empty-row height for unoccupied rows and the extra edit row', () => {
      expect(rowHeights([{ id: 'activity', x: 0, y: 1, w: 4, h: 1 }], heightOf, 3)).toEqual([72, 66, 72]);
    });

    it('lets the taller of two widgets sharing a row set its height', () => {
      const heights = rowHeights(
        [
          { id: 'swap-earn', x: 0, y: 0, w: 2, h: 1 },
          { id: 'activity', x: 2, y: 0, w: 2, h: 1 },
        ],
        heightOf,
        1,
      );
      expect(heights).toEqual([110]);
    });
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

    it('uses per-row heights for positions and sizes', () => {
      expect(rowTop(uneven, 2)).toBe(49 + 12 + 49 + 12);
      expect(cellRect({ x: 0, y: 0, w: 4, h: 2 }, uneven).height).toBe(49 + 12 + 49);
      expect(cellRect({ x: 2, y: 2, w: 2, h: 2 }, uneven)).toMatchObject({ top: 122, height: 68 + 12 + 68 });
      expect(cellRect({ x: 0, y: 5, w: 4, h: 1 }, uneven).height).toBe(HOME_GRID.rowHeight);
      expect(gridHeight(uneven, 5)).toBe(49 + 49 + 68 + 68 + 110 + 4 * 12);
      expect(gridHeight(uneven, 0)).toBe(0);
    });

    it('round-trips cellRect and slotAt with uneven rows', () => {
      for (let y = 0; y < 7; y += 1) {
        const rect = cellRect({ x: 0, y, w: 1, h: 1 }, uneven);
        expect(slotAt({ x: rect.left, y: rect.top + 5 }, { w: 1, h: 1 }, uneven)).toEqual({ x: 0, y });
      }
    });

    it('snaps to the nearest slot and clamps to the columns', () => {
      expect(slotAt({ x: 60, y: 30 }, { w: 1, h: 1 }, metrics)).toEqual({ x: 1, y: 0 });
      expect(slotAt({ x: 1000, y: -50 }, { w: 2, h: 2 }, metrics)).toEqual({ x: 2, y: 0 });
      expect(slotAt({ x: -40, y: 400 }, { w: 4, h: 1 }, metrics)).toEqual({ x: 0, y: 5 });
    });
  });
});
