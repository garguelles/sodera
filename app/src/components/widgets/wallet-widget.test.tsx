import { fireEvent, render, screen } from '@testing-library/react-native';

import { WalletWidget } from './wallet-widget';
import type { WalletHomeProvider, WalletHomeResult } from '@/wallet/wallet-home';

const identity = { username: 'anon.sodera.eth', address: '0x1234567890123456789012345678901234567890', avatarUrl: null } as const;

function providerFor(load: () => Promise<WalletHomeResult>): WalletHomeProvider {
  return { source: 'fixture', load, subscribeToChanges: () => () => undefined };
}

const ready = providerFor(async () => ({
  status: 'ready',
  snapshot: {
    identity,
    portfolio: {
      balances: [
        { id: 'eth', name: 'Ether', symbol: 'ETH', amount: '0.5', valueUsdCents: 134_455 },
        { id: 'usdc', name: 'USD Coin', symbol: 'USDC', amount: '245', valueUsdCents: 24_500 },
      ],
      positions: [],
    },
  },
}));

describe('WalletWidget', () => {
  it('shows the portfolio total and toggles visibility', async () => {
    const onToggleAmounts = jest.fn();
    const onOpenWallet = jest.fn();
    await render(
      <WalletWidget size={{ w: 2, h: 2 }} provider={ready} amountsVisible onToggleAmounts={onToggleAmounts} onOpenWallet={onOpenWallet} />,
    );

    expect(await screen.findByText('$1,589.55')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide financial amounts' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open Wallet' }));
    expect(onToggleAmounts).toHaveBeenCalledTimes(1);
    expect(onOpenWallet).toHaveBeenCalledTimes(1);
  });

  it('hides the total when amounts are hidden', async () => {
    await render(
      <WalletWidget size={{ w: 2, h: 2 }} provider={ready} amountsVisible={false} onToggleAmounts={jest.fn()} onOpenWallet={jest.fn()} />,
    );

    expect(await screen.findByText('$••••••')).toBeOnTheScreen();
    expect(screen.queryByText('$1,589.55')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Show financial amounts' })).toBeOnTheScreen();
  });

  it('shows a dash for an empty wallet in the 4×1 row', async () => {
    const empty = providerFor(async () => ({ status: 'empty', identity, message: 'Nothing yet' }));
    await render(
      <WalletWidget size={{ w: 4, h: 1 }} provider={empty} amountsVisible onToggleAmounts={jest.fn()} onOpenWallet={jest.fn()} />,
    );

    expect(await screen.findByText('—')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Hide financial amounts' })).not.toBeOnTheScreen();
  });

  it('falls back to the subtitle when the wallet cannot load', async () => {
    const failing = providerFor(async () => {
      throw new Error('Offline');
    });
    await render(
      <WalletWidget size={{ w: 2, h: 2 }} provider={failing} amountsVisible onToggleAmounts={jest.fn()} onOpenWallet={jest.fn()} />,
    );

    expect(await screen.findByText('Your onchain life, one tap away')).toBeOnTheScreen();
  });
});
