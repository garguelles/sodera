import { fits, rowCount, type HomeLayout } from './home-layout';
import {
  defaultHomeLayout,
  getWidgetDefinition,
  isWidgetId,
  supportsSize,
  WIDGET_REGISTRY,
  type WidgetContext,
} from './widget-registry';

const account = '0x1234567890123456789012345678901234567890' as const;
const withAgent: WidgetContext = { agentConfigured: true, account };
const withoutAgent: WidgetContext = { agentConfigured: false, account };

function expectValid(layout: HomeLayout) {
  for (const item of layout.items) {
    const others: HomeLayout = { ...layout, items: layout.items.filter((other) => other !== item) };
    expect(fits(others, item)).toBe(true);
    expect(supportsSize(getWidgetDefinition(item.id), item)).toBe(true);
  }
}

describe('widget registry', () => {
  it('lists every widget once with its default size among its sizes', () => {
    expect(new Set(WIDGET_REGISTRY.map((definition) => definition.id)).size).toBe(7);
    for (const definition of WIDGET_REGISTRY) {
      expect(supportsSize(definition, definition.defaultSize)).toBe(true);
    }
  });

  it('marks only the phone as not removable', () => {
    expect(WIDGET_REGISTRY.filter((definition) => !definition.removable).map((definition) => definition.id)).toEqual([
      'phone',
    ]);
  });

  it('makes the intent bar available only with the agent and an account', () => {
    const intentBar = getWidgetDefinition('intent-bar');
    expect(intentBar.isAvailable(withAgent)).toBe(true);
    expect(intentBar.isAvailable(withoutAgent)).toBe(false);
    expect(intentBar.isAvailable({ agentConfigured: true, account: null })).toBe(false);
  });

  it('recognises widget ids', () => {
    expect(isWidgetId('wallet')).toBe(true);
    expect(isWidgetId('calendar')).toBe(false);
    expect(isWidgetId(3)).toBe(false);
  });

  it('builds a valid default layout with the intent bar in row 0', () => {
    const layout = defaultHomeLayout(withAgent);
    expectValid(layout);
    expect(layout.items[0]).toEqual({ id: 'intent-bar', x: 0, y: 0, w: 4, h: 1 });
    expect(layout.items).toHaveLength(7);
    expect(rowCount(layout)).toBe(8);
  });

  it('shifts the default layout up without leaving an empty row when the agent is unavailable', () => {
    const layout = defaultHomeLayout(withoutAgent);
    expectValid(layout);
    expect(layout.items.map((item) => item.id)).not.toContain('intent-bar');
    expect(layout.items[0]).toEqual({ id: 'identity', x: 0, y: 0, w: 4, h: 2 });
    expect(rowCount(layout)).toBe(7);
  });
});
