import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Address, Hash } from 'viem';

import { TransactionsScreen, transactionExplorerUrl } from './transactions-screen';
import type { TransactionActivityProvider } from '@/wallet/transaction-activity';

const account = '0x1111111111111111111111111111111111111111' as Address;
const counterparty = '0x2222222222222222222222222222222222222222' as Address;
const transactionHash = `0x${'33'.repeat(32)}` as Hash;

describe('TransactionsScreen', () => {
  it('renders real normalized activity and opens its explorer transaction', async () => {
    const openTransaction = jest.fn().mockResolvedValue(undefined);
    await act(async () => {
      render(
        <TransactionsScreen
          openTransaction={openTransaction}
          provider={createProvider({
            status: 'ready',
            account,
            items: [
              {
                id: 'transaction-1',
                transactionHash,
                direction: 'received',
                asset: 'ETH',
                amount: '0.001',
                counterparty,
                timestamp: '2026-09-12T20:54:24.000Z',
                blockNumber: 10,
              },
            ],
          })}
        />,
      );
    });

    const transaction = await screen.findByRole('link', {
      name: 'Received 0.001 ETH, From 0x2222...2222',
    });
    await act(async () => {
      fireEvent.press(transaction);
    });

    expect(screen.getByText('+0.001')).toBeOnTheScreen();
    expect(openTransaction).toHaveBeenCalledWith(transactionExplorerUrl(transactionHash));
  });

  it('distinguishes an indexed empty account from an unavailable explorer', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('Explorer unavailable'))
      .mockResolvedValue({ status: 'empty', account });
    await act(async () => {
      render(<TransactionsScreen provider={createProvider(undefined, load)} />);
    });

    expect(await screen.findByText('Activity unavailable')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });

    await waitFor(() => expect(screen.getByText('No transactions yet')).toBeOnTheScreen());
    expect(load).toHaveBeenCalledTimes(2);
  });
});

function createProvider(
  result: Awaited<ReturnType<TransactionActivityProvider['load']>> | undefined,
  load = jest.fn().mockResolvedValue(result),
): TransactionActivityProvider {
  return {
    source: 'fixture',
    load,
    subscribeToChanges: jest.fn().mockReturnValue(() => undefined),
  };
}
