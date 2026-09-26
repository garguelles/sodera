import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhoneWidget } from './phone-widget';
import { SwapEarnWidget } from './swap-earn-widget';

describe('SwapEarnWidget', () => {
  it.each([
    [{ w: 4, h: 1 }, true],
    [{ w: 2, h: 2 }, true],
    [{ w: 2, h: 1 }, false],
  ])('opens Swap and Earn at %j', async (size, showsDescriptions) => {
    const onOpenSwap = jest.fn();
    const onOpenEarn = jest.fn();
    await render(<SwapEarnWidget size={size} onOpenSwap={onOpenSwap} onOpenEarn={onOpenEarn} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Explore Swap' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Explore Earn' }));
    expect(onOpenSwap).toHaveBeenCalledTimes(1);
    expect(onOpenEarn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Move between worlds') !== null).toBe(showsDescriptions);
  });
});

describe('PhoneWidget', () => {
  it.each([
    [{ w: 2, h: 2 }, 'All your apps, in one place'],
    [{ w: 4, h: 1 }, 'All your apps'],
  ])('opens the phone at %j', async (size, subtitle) => {
    const onOpenPhone = jest.fn();
    await render(<PhoneWidget size={size} onOpenPhone={onOpenPhone} />);

    expect(screen.getByText(subtitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Phone' }));
    expect(onOpenPhone).toHaveBeenCalledTimes(1);
  });
});
