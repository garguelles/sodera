import { fits, rowCount, type HomeLayout } from './home-layout';
import {
  defaultHomeLayout,
  getWidgetDefinition,
  isWidgetId,
  nearestSupportedSize,
  sizesAfter,
  supportsSize,
  WIDGET_REGISTRY,
} from './widget-registry';

function expectValid(layout: HomeLayout) {
  for (const item of layout.items) {
    const others: HomeLayout = { ...layout, items: layout.items.filter((other) => other !== item) };
    expect(fits(others, item)).toBe(true);
    expect(supportsSize(getWidgetDefinition(item.id), item)).toBe(true);
  }
}

describe('widget registry', () => {
  it('lists every widget once with its default size among its sizes', () => {
    expect(new Set(WIDGET_REGISTRY.map((definition) => definition.id)).size).toBe(6);
    for (const definition of WIDGET_REGISTRY) {
      expect(supportsSize(definition, definition.defaultSize)).toBe(true);
      for (const size of definition.sizes) expect(definition.heights[`${size.w}x${size.h}`]).toBeGreaterThan(0);
    }
  });

  it('marks only the phone as not removable', () => {
    expect(WIDGET_REGISTRY.filter((definition) => !definition.removable).map((definition) => definition.id)).toEqual([
      'phone',
    ]);
  });

  it('recognises widget ids', () => {
    expect(isWidgetId('wallet')).toBe(true);
    expect(isWidgetId('calendar')).toBe(false);
    expect(isWidgetId('intent-bar')).toBe(false);
    expect(isWidgetId(3)).toBe(false);
  });

  it('keeps the pre-widget home arrangement: side-by-side Swap and Earn, then a full-width pulse', () => {
    const layout = defaultHomeLayout();
    expect(layout.items.map(({ id, x, w, h }) => [id, x, w, h])).toEqual([
      ['identity', 0, 4, 2],
      ['wallet', 0, 2, 2],
      ['phone', 2, 2, 2],
      ['swap-earn', 0, 4, 1],
      ['market-pulse', 0, 4, 2],
      ['activity', 0, 4, 1],
    ]);
  });

  it('builds a valid default layout with no empty rows', () => {
    const layout = defaultHomeLayout();
    expectValid(layout);
    expect(layout.items[0]).toEqual({ id: 'identity', x: 0, y: 0, w: 4, h: 2 });
    expect(rowCount(layout)).toBe(8);
  });

  it('snaps a handle target to the nearest supported size on that axis', () => {
    const pulse = getWidgetDefinition('market-pulse');
    expect(nearestSupportedSize(pulse, { w: 4, h: 2 }, 'w', 2)).toEqual({ w: 2, h: 2 });
    expect(nearestSupportedSize(pulse, { w: 4, h: 2 }, 'w', 3)).toEqual({ w: 4, h: 2 });
    const wallet = getWidgetDefinition('wallet');
    expect(nearestSupportedSize(wallet, { w: 2, h: 2 }, 'w', 4)).toEqual({ w: 4, h: 1 });
    const swapEarn = getWidgetDefinition('swap-earn');
    expect(nearestSupportedSize(swapEarn, { w: 2, h: 2 }, 'h', 1)).toEqual({ w: 2, h: 1 });
  });

  it('lists the sizes after the current one, wrapping around', () => {
    expect(sizesAfter(getWidgetDefinition('swap-earn'), { w: 2, h: 2 })).toEqual([
      { w: 2, h: 1 },
      { w: 4, h: 1 },
    ]);
    expect(sizesAfter(getWidgetDefinition('activity'), { w: 4, h: 1 })).toEqual([]);
  });
});
