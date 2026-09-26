import { fireEvent, render, screen } from '@testing-library/react-native';

import { MarketPulseWidget } from './market-pulse-widget';
import { loadMarketPrices, loadMarketTrends } from '@/launcher/market-prices';

jest.mock('@/launcher/market-prices', () => ({ loadMarketPrices: jest.fn(), loadMarketTrends: jest.fn() }));

const prices = {
  bitcoin: { usd: 84002, change24h: 0.2 },
  ethereum: { usd: 2673.55, change24h: -0.3 },
  updatedAt: 1790319880000,
};

describe('MarketPulseWidget', () => {
  beforeEach(() => {
    (loadMarketPrices as jest.Mock).mockReset();
    (loadMarketTrends as jest.Mock).mockReset().mockResolvedValue({ bitcoin: null, ethereum: null });
  });

  it('shows an unavailable state and allows retry inside the cell', async () => {
    (loadMarketPrices as jest.Mock).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(prices);
    const widget = await render(<MarketPulseWidget size={{ w: 4, h: 2 }} />);

    expect(await screen.findByText('Prices unavailable right now')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry market prices' }));

    expect(await screen.findByText('$84,002.00')).toBeOnTheScreen();
    await widget.unmount();
  });

  it('shows price cards and the footnote at 4×2', async () => {
    (loadMarketPrices as jest.Mock).mockResolvedValue(prices);
    const widget = await render(<MarketPulseWidget size={{ w: 4, h: 2 }} />);

    expect(await screen.findByText('$84,002.00')).toBeOnTheScreen();
    expect(screen.getByText('$2,673.55')).toBeOnTheScreen();
    expect(screen.getByText('Global market prices · Wallet uses Sepolia testnet')).toBeOnTheScreen();
    await widget.unmount();
  });

  it('shows compact rows without the footnote at 2×2', async () => {
    (loadMarketPrices as jest.Mock).mockResolvedValue(prices);
    const widget = await render(<MarketPulseWidget size={{ w: 2, h: 2 }} />);

    expect(await screen.findByText('$84,002.00')).toBeOnTheScreen();
    expect(screen.getByText('BTC')).toBeOnTheScreen();
    expect(screen.getByText('-0.3%')).toBeOnTheScreen();
    expect(screen.queryByText('Global market prices · Wallet uses Sepolia testnet')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('24 hour price trend')).not.toBeOnTheScreen();
    await widget.unmount();
  });
});
