import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyCell, RemoveButton, SizeTag } from './home-edit-chrome';

const rect = { left: 0, top: 0, width: 160, height: 148 };

describe('home edit chrome', () => {
  it('renders the size tag and cycles on tap', async () => {
    const onCycleSize = jest.fn();
    await render(<SizeTag rect={rect} size={{ w: 2, h: 2 }} onCycleSize={onCycleSize} />);

    expect(screen.getByText('2×2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Size 2 by 2, change size' }));
    expect(onCycleSize).toHaveBeenCalledTimes(1);
  });

  it('removes a removable widget', async () => {
    const onRemove = jest.fn();
    await render(<RemoveButton rect={rect} title="Wallet" removable onRemove={onRemove} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Wallet' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shows no remove button for a widget that cannot be removed', async () => {
    await render(<RemoveButton rect={rect} title="Phone" removable={false} onRemove={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Remove Phone' })).not.toBeOnTheScreen();
  });

  it('reports taps on an empty cell', async () => {
    const onPress = jest.fn();
    await render(<EmptyCell onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Add widget here' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
