import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { HomeGrid } from './home-grid';
import { cellRect, columnWidth, HOME_GRID, rowHeights, type HomeLayout } from '@/launcher/home-layout';
import { defaultHomeLayout, getWidgetDefinition, widgetHeight } from '@/launcher/widget-registry';

const heightOf = (item: HomeLayout['items'][number]) => widgetHeight(getWidgetDefinition(item.id), item);

async function renderGrid(layout: HomeLayout, props: Partial<Parameters<typeof HomeGrid>[0]> = {}) {
  const view = await render(<HomeGrid layout={layout} renderWidget={(item) => <Text>{item.id}</Text>} {...props} />);
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

  describe('edit mode', () => {
    it('selects a cell on press, fades the others, and blocks taps inside widgets', async () => {
      const onSelect = jest.fn();
      await renderGrid(defaultHomeLayout(), { editing: true, selectedId: 'wallet', onSelect });

      await fireEvent.press(screen.getByRole('button', { name: 'Select Phone' }));
      expect(onSelect).toHaveBeenCalledWith('phone');
      expect(StyleSheet.flatten(screen.getByTestId('home-cell-phone').props.style).opacity).toBe(0.5);
      expect(StyleSheet.flatten(screen.getByTestId('home-cell-wallet').props.style).opacity).toBeUndefined();
      expect(screen.getByTestId('home-widget-wallet').props.pointerEvents).toBe('none');
    });

    it('fades nothing when nothing is selected', async () => {
      await renderGrid(defaultHomeLayout(), { editing: true });

      expect(StyleSheet.flatten(screen.getByTestId('home-cell-phone').props.style).opacity).toBeUndefined();
    });

    it('adds an extra row of four empty cells that report their position', async () => {
      const onAddAt = jest.fn();
      await renderGrid(defaultHomeLayout(), { editing: true, onAddAt });

      const cells = screen.getAllByRole('button', { name: 'Add widget here' });
      expect(cells).toHaveLength(4);
      await fireEvent.press(cells[2]);
      expect(onAddAt).toHaveBeenCalledWith({ x: 2, y: 8 });
    });

    it('shows the selection chrome for the selected widget only', async () => {
      await renderGrid(defaultHomeLayout(), { editing: true, selectedId: 'market-pulse' });

      expect(screen.getByText('4×2')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Remove Market pulse' })).toBeOnTheScreen();
      expect(screen.getByTestId('resize-handle-right')).toBeOnTheScreen();
      expect(screen.queryByTestId('resize-handle-bottom')).not.toBeOnTheScreen();
    });

    it('snaps a right-handle drag to the nearest supported size', async () => {
      const onResize = jest.fn();
      await renderGrid(defaultHomeLayout(), { editing: true, selectedId: 'market-pulse', onResize });

      fireGestureHandler(getByGestureTestId('resize-right'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -150 },
        { state: State.END, translationX: -150 },
      ]);
      await Promise.resolve(); // scheduleOnRN runs the callback in a microtask
      expect(onResize).toHaveBeenCalledWith('market-pulse', { w: 2, h: 2 });
    });

    it('ignores a drag that stays at the current size', async () => {
      const onResize = jest.fn();
      await renderGrid(defaultHomeLayout(), { editing: true, selectedId: 'market-pulse', onResize });

      fireGestureHandler(getByGestureTestId('resize-right'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -20 },
        { state: State.END, translationX: -20 },
      ]);
      await Promise.resolve();
      expect(onResize).not.toHaveBeenCalled();
    });
  });

  it('long-press reports the widget under the finger, or null for empty space', async () => {
    const onLongPress = jest.fn();
    await renderGrid(defaultHomeLayout(), { onLongPress });

    fireGestureHandler(getByGestureTestId('home-grid-long-press'), [
      { state: State.BEGAN, x: 300, y: 130 },
      { state: State.ACTIVE, x: 300, y: 130 },
      { state: State.END, x: 300, y: 130 },
    ]);
    expect(onLongPress).toHaveBeenLastCalledWith('phone');

    fireGestureHandler(getByGestureTestId('home-grid-long-press'), [
      { state: State.BEGAN, x: 10, y: 5000 },
      { state: State.ACTIVE, x: 10, y: 5000 },
      { state: State.END, x: 10, y: 5000 },
    ]);
    expect(onLongPress).toHaveBeenLastCalledWith(null);
  });
});
