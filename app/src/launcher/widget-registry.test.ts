import { fits, rowCount, type HomeLayout } from './home-layout';
import {
  defaultHomeLayout,
  getWidgetDefinition,
  isWidgetId,
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
});
