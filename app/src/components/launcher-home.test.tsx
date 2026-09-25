import { fireEvent, render, screen } from '@testing-library/react-native';

import { LauncherHome } from './launcher-home';
import { loadMarketPrices } from '@/launcher/market-prices';

jest.mock('@/launcher/market-prices', () => ({ loadMarketPrices: jest.fn() }));

describe('LauncherHome', () => {
  beforeEach(() => {
    (loadMarketPrices as jest.Mock).mockReset();
  });

  it('shows an unavailable state and allows retry', async () => {
    (loadMarketPrices as jest.Mock)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({
        bitcoin: { usd: 84002, change24h: 0.2 },
        ethereum: { usd: 2673.55, change24h: -0.3 },
        updatedAt: 1790319880000,
      });
    const home = await render(<LauncherHome onOpenEarn={jest.fn()} onOpenSwap={jest.fn()} onOpenActivity={jest.fn()} />);

    expect(await screen.findByText('Prices unavailable right now')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Retry market prices' }));

    expect(await screen.findByText('$84,002.00')).toBeOnTheScreen();
    await home.unmount();
  });

  it('shows market data and opens the feature previews and activity', async () => {
    (loadMarketPrices as jest.Mock).mockResolvedValue({
      bitcoin: { usd: 84002, change24h: 0.2 },
      ethereum: { usd: 2673.55, change24h: -0.3 },
      updatedAt: 1790319880000,
    });
    const onOpenEarn = jest.fn();
    const onOpenSwap = jest.fn();
    const onOpenActivity = jest.fn();
    const home = await render(<LauncherHome onOpenEarn={onOpenEarn} onOpenSwap={onOpenSwap} onOpenActivity={onOpenActivity} />);

    expect(await screen.findByText('$84,002.00')).toBeOnTheScreen();
    expect(screen.getByText('$2,673.55')).toBeOnTheScreen();
    expect(screen.getByText('Global market prices · Wallet uses Sepolia testnet')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Explore Earn' }));
    fireEvent.press(screen.getByRole('button', { name: 'Explore Swap' }));
    fireEvent.press(screen.getByRole('button', { name: 'View activity' }));

    expect(onOpenEarn).toHaveBeenCalledTimes(1);
    expect(onOpenSwap).toHaveBeenCalledTimes(1);
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
    await home.unmount();
  });

});
