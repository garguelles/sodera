import type { Address, Hash } from 'viem';

import { createBlockscoutReceivedEthReader, normalizeReceivedEth } from './received-eth-blockscout';

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const hash = (byte: string) => `0x${byte.repeat(32)}` as Hash;

describe('normalizeReceivedEth', () => {
  it('keeps successful incoming ETH from direct and internal transactions', () => {
    const result = normalizeReceivedEth({
      account,
      transactions: [transaction({ hash: hash('aa'), value: '1000000000000000' })],
      internalTransactions: [internal({ transaction_hash: hash('bb'), index: 2, value: '2000000000000000' })],
    });

    expect(result.skippedCount).toBe(0);
    expect(result.items).toEqual([
      {
        kind: 'transfer',
        id: `eth-in:${hash('aa')}`,
        transactionHash: hash('aa'),
        direction: 'received',
        asset: 'ETH',
        amount: '0.001',
        counterparty: other,
        timestamp: '2026-09-26T01:00:00.000Z',
        blockNumber: 10,
        operation: null,
      },
      expect.objectContaining({ id: `eth-in:${hash('bb')}:2`, amount: '0.002', counterparty: other }),
    ]);
  });

  it('drops pending, failed, zero-value, outgoing, and self transfers', () => {
    const result = normalizeReceivedEth({
      account,
      transactions: [
        transaction({ status: 'error' }),
        transaction({ result: 'reverted' }),
        transaction({ value: '0' }),
        transaction({ from: { hash: account }, to: { hash: other } }),
        transaction({ from: { hash: account } }),
        transaction({ status: null, result: 'pending', block_number: null, timestamp: null }),
      ],
      internalTransactions: [internal({ success: false })],
    });

    expect(result).toEqual({ items: [], skippedCount: 0 });
  });

  it('counts malformed records as skipped', () => {
    const result = normalizeReceivedEth({
      account,
      transactions: [
        transaction({ status: undefined }),
        transaction({ hash: '0x12' }),
        transaction({ value: 1 }),
        transaction({ from: null }),
      ],
      internalTransactions: [internal({ success: 'yes' }), internal({ index: -1 }), internal({ timestamp: 'x' })],
    });

    expect(result).toEqual({ items: [], skippedCount: 7 });
  });
});

describe('createBlockscoutReceivedEthReader', () => {
  it('requests only incoming transactions for the account', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ items: [] }),
    });

    await createBlockscoutReceivedEthReader({ fetcher }).load(account);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://eth-sepolia.blockscout.com/api/v2/addresses/${account}/transactions?filter=to`,
      `https://eth-sepolia.blockscout.com/api/v2/addresses/${account}/internal-transactions?filter=to`,
    ]);
  });

  it('maps transport, HTTP, and payload failures to stable messages', async () => {
    const load = (fetcher: jest.Mock) => createBlockscoutReceivedEthReader({ fetcher }).load(account);

    await expect(load(jest.fn().mockRejectedValue(new TypeError('offline')))).rejects.toThrow(
      'Received ETH could not reach Blockscout',
    );
    await expect(load(jest.fn().mockResolvedValue({ ok: false, status: 502 }))).rejects.toThrow(
      'Blockscout returned HTTP 502',
    );
    await expect(
      load(jest.fn().mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({}) })),
    ).rejects.toThrow('Blockscout returned invalid data');
  });
});

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    hash: hash('aa'),
    block_number: 10,
    timestamp: '2026-09-26T01:00:00Z',
    value: '1000000000000000',
    status: 'ok',
    result: 'success',
    from: { hash: other },
    to: { hash: account },
    ...overrides,
  } as Parameters<typeof normalizeReceivedEth>[0]['transactions'][number];
}

function internal(overrides: Record<string, unknown> = {}) {
  return {
    transaction_hash: hash('bb'),
    block_number: 11,
    index: 1,
    timestamp: '2026-09-26T00:00:00Z',
    value: '2000000000000000',
    success: true,
    from: { hash: other },
    to: { hash: account },
    ...overrides,
  } as Parameters<typeof normalizeReceivedEth>[0]['internalTransactions'][number];
}
