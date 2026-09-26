import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityWidget, formatRelativeTime } from './activity-widget';
import type { TransactionActivityProvider, TransactionActivityResult } from '@/wallet/transaction-activity';

const account = '0x1234567890123456789012345678901234567890' as const;
const now = Date.parse('2026-09-26T12:00:00Z');

function providerFor(load: () => Promise<TransactionActivityResult>): TransactionActivityProvider {
  return { source: 'fixture', load, subscribeToChanges: () => () => undefined };
}

describe('ActivityWidget', () => {
  it('describes the newest transfer', async () => {
    const provider = providerFor(async () => ({
      status: 'ready',
      account,
      items: [
        {
          kind: 'transfer',
          id: 'newest',
          transactionHash: null,
          direction: 'sent',
          asset: 'ETH',
          amount: '0.01',
          counterparty: '0xabcdef0000000000000000000000000000001234',
          timestamp: '2026-09-26T10:00:00Z',
          blockNumber: 2,
          operation: null,
        },
        {
          kind: 'operation',
          id: 'older',
          transactionHash: '0x01',
          userOperationHash: '0x02',
          success: true,
          sponsored: true,
          actualGasCostWei: '0',
          timestamp: '2026-09-25T10:00:00Z',
          blockNumber: 1,
        },
      ],
    }));
    const onOpenActivity = jest.fn();
    await render(<ActivityWidget size={{ w: 4, h: 1 }} provider={provider} onOpenActivity={onOpenActivity} now={() => now} />);

    expect(await screen.findByText('Sent 0.01 ETH to 0xabcd...1234 · 2h ago')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'View activity' }));
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
  });

  it('describes a sponsored account operation', async () => {
    const provider = providerFor(async () => ({
      status: 'partial',
      account,
      message: 'Some sources failed',
      items: [
        {
          kind: 'operation',
          id: 'op',
          transactionHash: '0x01',
          userOperationHash: '0x02',
          success: true,
          sponsored: true,
          actualGasCostWei: '0',
          timestamp: '2026-09-26T11:59:30Z',
          blockNumber: 1,
        },
      ],
    }));
    await render(<ActivityWidget size={{ w: 4, h: 1 }} provider={provider} onOpenActivity={jest.fn()} now={() => now} />);

    expect(await screen.findByText('Account operation · Sponsored · just now')).toBeOnTheScreen();
  });

  it('shows empty copy', async () => {
    const provider = providerFor(async () => ({ status: 'empty', account }));
    await render(<ActivityWidget size={{ w: 4, h: 1 }} provider={provider} onOpenActivity={jest.fn()} />);

    expect(await screen.findByText('No activity yet')).toBeOnTheScreen();
  });

  it('falls back to the subtitle on error', async () => {
    const provider = providerFor(async () => {
      throw new Error('Offline');
    });
    await render(<ActivityWidget size={{ w: 4, h: 1 }} provider={provider} onOpenActivity={jest.fn()} />);

    expect(await screen.findByText('Your Sepolia transaction history')).toBeOnTheScreen();
  });

  it('formats relative times', () => {
    expect(formatRelativeTime('2026-09-26T11:55:00Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-09-24T12:00:00Z', now)).toBe('2d ago');
    expect(formatRelativeTime('2026-09-01T12:00:00Z', now)).toBe('Sep 1');
  });
});
