import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { WidgetSheet } from './widget-sheet';
import type { WidgetId } from '@/launcher/home-layout';
import { WIDGET_REGISTRY } from '@/launcher/widget-registry';

const definitions = WIDGET_REGISTRY.filter((definition) => definition.removable);

async function renderSheet(props: Partial<Parameters<typeof WidgetSheet>[0]> = {}) {
  const handlers = { onOpenChange: jest.fn(), onAdd: jest.fn(), onDrop: jest.fn() };
  await render(
    <WidgetSheet definitions={definitions} placedIds={new Set<WidgetId>()} open {...handlers} {...props} />,
  );
  return handlers;
}

describe('WidgetSheet', () => {
  it('lists each widget with its supported sizes', async () => {
    await renderSheet();

    expect(screen.getByText('Sodera widgets')).toBeOnTheScreen();
    expect(screen.getByText('drag onto home')).toBeOnTheScreen();
    expect(screen.getByText('Market pulse')).toBeOnTheScreen();
    expect(screen.getByText('BTC, ETH · 24h')).toBeOnTheScreen();
    expect(screen.getByText('4×2 · 2×2')).toBeOnTheScreen();
    expect(screen.getByText('4×1 · 2×2 · 2×1')).toBeOnTheScreen();
    expect(screen.queryByText('Phone')).not.toBeOnTheScreen();
  });

  it('shows a placed widget as on home and disabled', async () => {
    const { onAdd } = await renderSheet({ placedIds: new Set<WidgetId>(['wallet']) });

    const wallet = screen.getByRole('button', { name: 'Wallet, on home' });
    expect(screen.getByText('On home')).toBeOnTheScreen();
    expect(wallet).toBeDisabled();
    await fireEvent.press(wallet);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('adds a widget on press', async () => {
    const { onAdd } = await renderSheet();

    await fireEvent.press(screen.getByRole('button', { name: 'Add Activity' }));
    expect(onAdd).toHaveBeenCalledWith('activity');
  });

  it('collapses from the backdrop, the handle, or a downward drag', async () => {
    const { onOpenChange } = await renderSheet();

    await fireEvent.press(screen.getByTestId('widget-sheet-backdrop'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    onOpenChange.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Collapse widgets' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    onOpenChange.mockClear();
    fireGestureHandler(getByGestureTestId('widget-sheet-handle-drag'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 80 },
      { state: State.END, translationY: 80 },
    ]);
    await Promise.resolve();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('opens from the collapsed handle and has no backdrop while collapsed', async () => {
    const { onOpenChange } = await renderSheet({ open: false });

    expect(screen.queryByTestId('widget-sheet-backdrop')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Show widgets' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('collapses while a row is dragged and reports where it was dropped', async () => {
    const { onOpenChange, onDrop } = await renderSheet();

    await act(async () => {
      fireGestureHandler(getByGestureTestId('widget-sheet-row-drag-activity'), [
        { state: State.BEGAN, absoluteX: 100, absoluteY: 700 },
        { state: State.ACTIVE, absoluteX: 120, absoluteY: 400 },
        { state: State.END, absoluteX: 180, absoluteY: 300 },
      ]);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDrop).toHaveBeenCalledWith('activity', 180, 300);
  });
});
