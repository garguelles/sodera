import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { HomeGrid } from './home-grid';
import { cellRect, columnWidth, HOME_GRID, rowHeights, type HomeLayout } from '@/launcher/home-layout';
import { defaultHomeLayout, getWidgetDefinition, widgetHeight } from '@/launcher/widget-registry';

const heightOf = (item: HomeLayout['items'][number]) => widgetHeight(getWidgetDefinition(item.id), item);

async function renderGrid(layout: HomeLayout) {
  const view = await render(<HomeGrid layout={layout} renderWidget={(item) => <Text>{item.id}</Text>} />);
  await fireEvent(screen.getByTestId('home-grid'), 'layout', { nativeEvent: { layout: { width: 360, height: 0, x: 0, y: 0 } } });
  return view;
}

describe('HomeGrid', () => {
  it('positions each item at its cell rectangle and sizes itself to the rows', async () => {
    const layout = defaultHomeLayout();
    await renderGrid(layout);
    const metrics = { columnWidth: columnWidth(360), gap: HOME_GRID.gap, rowHeights: rowHeights(layout.items, heightOf, 8) };

    for (const item of layout.items) {
      expect(StyleSheet.flatten(screen.getByTestId(`home-cell-${item.id}`).props.style)).toMatchObject({
        position: 'absolute',
        ...cellRect(item, metrics),
      });
    }
  });

  it('gives every default widget its natural height, stacked with only the grid gap between rows', async () => {
    const layout = defaultHomeLayout();
    await renderGrid(layout);
    const style = (id: string) => StyleSheet.flatten(screen.getByTestId(`home-cell-${id}`).props.style);

    expect(layout.items.map((item) => [item.id, style(item.id).height])).toEqual([
      ['identity', 106],
      ['wallet', 148],
      ['phone', 148],
      ['swap-earn', 110],
      ['market-pulse', 194],
      ['activity', 66],
    ]);
    expect(style('wallet').top).toBe(106 + 12);
    expect(style('swap-earn').top).toBe(106 + 12 + 148 + 12);
    expect(StyleSheet.flatten(screen.getByTestId('home-grid').props.style).height).toBe(106 + 148 + 110 + 194 + 66 + 4 * 12);
  });

  it('renders nothing until the width is known', async () => {
    await render(
      <HomeGrid layout={defaultHomeLayout()} renderWidget={(item) => <Text>{item.id}</Text>} />,
    );

    expect(screen.queryByText('wallet')).not.toBeOnTheScreen();
  });
});
