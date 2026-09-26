import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import type { Address, Hash } from 'viem';

import { TransactionsScreen } from './transactions-screen';
import { platinum } from '@/constants/theme';
import { sepoliaTransactionUrl } from '@/wallet/sepolia';
import type { TransactionActivityProvider } from '@/wallet/transaction-activity';

const account = '0x1111111111111111111111111111111111111111' as Address;
const counterparty = '0x2222222222222222222222222222222222222222' as Address;
const transactionHash = `0x${'33'.repeat(32)}` as Hash;
const userOperationHash = `0x${'44'.repeat(32)}` as Hash;

describe('TransactionsScreen', () => {
  it('keeps the same horizontal padding while activity loads', async () => {
    let resolveLoad!: (result: Awaited<ReturnType<TransactionActivityProvider['load']>>) => void;
    const load = jest.fn().mockReturnValue(new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    await act(async () => {
      render(<TransactionsScreen provider={createProvider(undefined, load)} />);
    });

    const loadingList = screen.getByTestId('transactions-list');
    expect(StyleSheet.flatten(loadingList.props.contentContainerStyle)).toMatchObject({
      paddingHorizontal: platinum.spacing.lg,
    });

    await act(async () => {
      resolveLoad({ status: 'empty', account });
    });

    expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('transactions-list').props.contentContainerStyle))
      .toMatchObject({ paddingHorizontal: platinum.spacing.lg });
  });

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
                kind: 'transfer',
                id: 'transaction-1',
                transactionHash,
                direction: 'received',
                asset: 'ETH',
                amount: '0.001',
                counterparty,
                timestamp: '2026-09-12T20:54:24.000Z',
                blockNumber: 10,
                operation: null,
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
    expect(openTransaction).toHaveBeenCalledWith(sepoliaTransactionUrl(transactionHash));
  });

  it('shows the operation behind a sponsored USDC send', async () => {
    await act(async () => {
      render(
        <TransactionsScreen
          provider={createProvider({
            status: 'ready',
            account,
            items: [
              {
                kind: 'transfer',
                id: 'usdc-1',
                transactionHash,
                direction: 'sent',
                asset: 'USDC',
                amount: '1.5',
                counterparty,
                timestamp: '2026-09-12T20:54:24.000Z',
                blockNumber: 10,
                operation: {
                  userOperationHash,
                  success: true,
                  sponsored: true,
                  actualGasCostWei: '12000000000000',
                },
              },
            ],
          })}
        />,
      );
    });

    expect(
      await screen.findByRole('link', {
        name: 'Sent 1.5 USDC, To 0x2222...2222, Sponsored, gas 0.000012 ETH',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('-1.5')).toBeOnTheScreen();
    expect(screen.getByText('Sponsored · gas 0.000012 ETH')).toBeOnTheScreen();
  });

  it('shows a Pay with payment as one row with what was swapped', async () => {
    await act(async () => {
      render(
        <TransactionsScreen
          provider={createProvider({
            status: 'ready',
            account,
            items: [
              {
                kind: 'payment',
                id: 'pay-1',
                transactionHash,
                asset: 'USDC',
                amount: '10',
                counterparty,
                paidAsset: 'ETH',
                paidAmount: '0.00028241',
                paidAmountIsMaximum: false,
                timestamp: '2026-09-12T20:54:24.000Z',
                blockNumber: 10,
                operation: { userOperationHash, success: true, sponsored: true, actualGasCostWei: '12000000000000' },
              },
            ],
          })}
        />,
      );
    });

    expect(
      await screen.findByRole('link', {
        name: 'Paid 10 USDC, To 0x2222...2222, Swapped from 0.00028241 ETH, Sponsored, gas 0.000012 ETH',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Paid USDC')).toBeOnTheScreen();
    expect(screen.getByText('-10')).toBeOnTheScreen();
  });

  it('renders a standalone account operation without an amount', async () => {
    const openTransaction = jest.fn().mockResolvedValue(undefined);
    await act(async () => {
      render(
        <TransactionsScreen
          openTransaction={openTransaction}
          provider={createProvider({
            status: 'ready',
            account,
            items: [operationItem({ success: true, sponsored: false })],
          })}
        />,
      );
    });

    const row = await screen.findByRole('link', {
      name: 'Account operation, Self-funded, gas 0.000012 ETH',
    });
    expect(screen.getByText('Account operation')).toBeOnTheScreen();
    expect(screen.queryByText(/^[+-]/)).not.toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(row);
    });
    expect(openTransaction).toHaveBeenCalledWith(sepoliaTransactionUrl(transactionHash));
  });

  it('marks a failed operation', async () => {
    await act(async () => {
      render(
        <TransactionsScreen
          provider={createProvider({
            status: 'ready',
            account,
            items: [operationItem({ success: false, sponsored: true })],
          })}
        />,
      );
    });

    expect(
      await screen.findByRole('link', {
        name: 'Account operation, Failed, Sponsored, gas 0.000012 ETH',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Failed · ')).toBeOnTheScreen();
  });

  it('opens the explorer through Linking by default', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockImplementation(function (this: unknown) {
      if (this !== Linking) throw new TypeError("Cannot read property '_validateURL' of undefined");
      return Promise.resolve(true);
    });
    await act(async () => {
      render(
        <TransactionsScreen
          provider={createProvider({
            status: 'ready',
            account,
            items: [operationItem({ success: true, sponsored: true })],
          })}
        />,
      );
    });

    await act(async () => {
      fireEvent.press(await screen.findByRole('link', { name: /^Account operation/ }));
    });

    expect(openURL).toHaveBeenCalledWith(sepoliaTransactionUrl(transactionHash));
    expect(screen.queryByText(/_validateURL/)).not.toBeOnTheScreen();
    openURL.mockRestore();
  });

  it('distinguishes an indexed empty account from an unavailable indexer', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('MultiBaas could not be reached'))
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

  it('does not present malformed indexer data as verified empty activity', async () => {
    await act(async () => {
      render(
        <TransactionsScreen
          provider={createProvider({
            status: 'partial',
            account,
            items: [],
            message: '1 malformed indexer record was omitted.',
          })}
        />,
      );
    });

    expect(await screen.findByText('Activity may be incomplete')).toBeOnTheScreen();
    expect(screen.queryByText('No transactions yet')).not.toBeOnTheScreen();
  });

  it('shows a submitted send without claiming it has a transaction hash yet', async () => {
    const openTransaction = jest.fn();
    await act(async () => {
      render(<TransactionsScreen openTransaction={openTransaction} provider={createProvider({
        status: 'ready', account,
        items: [{
          kind: 'transfer', id: 'pending', transactionHash: null, userOperationHash: transactionHash,
          status: 'submitted', direction: 'sent', asset: 'USDC', amount: '1.25',
          counterparty, timestamp: '2026-09-26T12:00:00.000Z', blockNumber: 0, operation: null,
        }],
      })} />);
    });
    expect(await screen.findByText('Submitted · awaiting confirmation')).toBeOnTheScreen();
    expect(screen.getByText('Operation: 0x3333...3333')).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: /Sent 1.25 USDC/ })).not.toBeOnTheScreen();
    expect(openTransaction).not.toHaveBeenCalled();
  });
});

function operationItem({ success, sponsored }: { success: boolean; sponsored: boolean }) {
  return {
    kind: 'operation' as const,
    id: `userop:${userOperationHash}`,
    transactionHash,
    userOperationHash,
    success,
    sponsored,
    actualGasCostWei: '12000000000000',
    timestamp: '2026-09-12T20:54:24.000Z',
    blockNumber: 10,
  };
}

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
