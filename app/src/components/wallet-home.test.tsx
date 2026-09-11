import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Address } from 'viem';

import { WalletHome } from './wallet-home';
import {
  createWalletHomeFixtureProvider,
  emptyWalletHomeFixture,
  indexingWalletHomeFixture,
  populatedWalletHomeFixture,
  walletHomeErrorFixture,
} from '@/wallet/wallet-home-fixtures';
import type { WalletHomeProvider, WalletHomeResult } from '@/wallet/wallet-home';

const identity = {
  username: 'alex.rivera.sodera.eth',
  address: '0x7A36a07E7B97e8A4d1C5f6629A7E9f8d7e70C304' as Address,
  avatarUrl: null,
};

describe('WalletHome', () => {
  it('renders fixture identity, balances, a vault position, and a non-duplicated total', async () => {
    await render(<WalletHome provider={createWalletHomeFixtureProvider()} />);

    expect(await screen.findByText('alex.sodera.eth')).toBeOnTheScreen();
    expect(screen.getByLabelText('alex.sodera.eth initials')).toBeOnTheScreen();
    expect(screen.getByText('A')).toBeOnTheScreen();
    expect(screen.getByText('0.8200 ETH')).toBeOnTheScreen();
    expect(screen.getByText('Available USD Coin')).toBeOnTheScreen();
    expect(screen.getByText('245.00 USDC')).toBeOnTheScreen();
    expect(screen.getByText('Curated USDC vault')).toBeOnTheScreen();
    expect(screen.getByText('750.00 USDC')).toBeOnTheScreen();
    expect(screen.getByText('$3,045.00')).toBeOnTheScreen();
    expect(screen.queryByText('$3,795.00')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Development fixture data')).toBeOnTheScreen();
  });

  it('renders an avatar when the identity provider supplies one', async () => {
    const result: WalletHomeResult = {
      status: 'empty',
      identity: { ...identity, avatarUrl: 'https://example.com/alex.png' },
      message: 'No indexed holdings yet.',
    };

    await render(<WalletHome provider={createWalletHomeFixtureProvider(result)} />);

    expect(
      await screen.findByLabelText('alex.rivera.sodera.eth avatar'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('alex.rivera.sodera.eth initials')).not.toBeOnTheScreen();
  });

  it('hides and reveals every financial amount', async () => {
    await render(<WalletHome provider={createWalletHomeFixtureProvider()} />);
    await screen.findByText('$3,045.00');

    fireEvent.press(screen.getByRole('button', { name: 'Hide financial amounts' }));

    await waitFor(() => expect(screen.queryByText('$3,045.00')).toBeNull());
    expect(screen.queryByText('0.8200 ETH')).not.toBeOnTheScreen();
    expect(screen.queryByText('$2,050.00')).not.toBeOnTheScreen();
    expect(screen.queryByText('245.00 USDC')).not.toBeOnTheScreen();
    expect(screen.queryByText('$245.00')).not.toBeOnTheScreen();
    expect(screen.queryByText('750.00 USDC')).not.toBeOnTheScreen();
    expect(screen.queryByText('$750.00')).not.toBeOnTheScreen();
    expect(screen.getAllByLabelText('Hidden amount')).toHaveLength(7);

    fireEvent.press(screen.getByRole('button', { name: 'Show financial amounts' }));
    await waitFor(() => expect(screen.getByText('$3,045.00')).toBeOnTheScreen());
  });

  it('renders loading and indexing states supplied through the provider contract', async () => {
    let resolveResult: (result: WalletHomeResult) => void = () => undefined;
    const provider: WalletHomeProvider = {
      source: 'fixture',
      load: jest.fn(
        () =>
          new Promise<WalletHomeResult>((resolve) => {
            resolveResult = resolve;
          }),
      ),
      subscribeToChanges: jest.fn().mockReturnValue(() => undefined),
    };
    await render(<WalletHome provider={provider} />);

    expect(screen.getByLabelText('Loading wallet data')).toBeOnTheScreen();
    await act(async () =>
      resolveResult(indexingWalletHomeFixture),
    );

    expect(await screen.findByText('Portfolio indexing')).toBeOnTheScreen();
    expect(screen.getByText(/Available balances may be partial/)).toBeOnTheScreen();
    expect(screen.getByText('$3,045.00')).toBeOnTheScreen();
  });

  it('offers retry after a provider failure', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(walletHomeErrorFixture)
      .mockResolvedValueOnce(populatedWalletHomeFixture);
    const provider: WalletHomeProvider = {
      source: 'fixture',
      load,
      subscribeToChanges: jest.fn().mockReturnValue(() => undefined),
    };
    await render(<WalletHome provider={provider} />);

    expect(await screen.findByText('Portfolio provider unavailable')).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Retry wallet' })),
    );

    expect(await screen.findByText('$3,045.00')).toBeOnTheScreen();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reacts to provider updates and renders an empty portfolio', async () => {
    const provider = createWalletHomeFixtureProvider();
    await render(<WalletHome provider={provider} />);
    await screen.findByText('$3,045.00');

    await act(() => provider.update(emptyWalletHomeFixture));

    await waitFor(() => expect(screen.getByText('No portfolio activity yet')).toBeOnTheScreen());
    expect(screen.getByText(/Balances and positions will appear/)).toBeOnTheScreen();
    expect(screen.queryByText('$3,045.00')).not.toBeOnTheScreen();
  });
});
