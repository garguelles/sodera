import type { Address, Hash } from 'viem';

import { normalizeActivity } from './transaction-activity-blockscout';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';

jest.mock('./wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const transactionHash = `0x${'33'.repeat(32)}` as Hash;

describe('normalizeActivity', () => {
  it('combines real direct, internal, and pinned-USDC transfers newest first', () => {
    const result = normalizeActivity({
      account,
      transactions: [
        {
          hash: transactionHash,
          block_number: 10,
          timestamp: '2026-09-12T20:54:24.000Z',
          value: '1000000000000000',
          status: 'ok',
          result: 'success',
          from: { hash: other },
          to: { hash: account },
        },
      ],
      internalTransactions: [
        {
          transaction_hash: `0x${'44'.repeat(32)}`,
          block_number: 11,
          index: 4,
          timestamp: '2026-09-12T20:59:12.000Z',
          value: '1000000000000',
          success: true,
          from: { hash: account },
          to: { hash: other },
        },
        {
          transaction_hash: `0x${'44'.repeat(32)}`,
          block_number: 11,
          index: 3,
          timestamp: '2026-09-12T20:59:12.000Z',
          value: '0',
          success: true,
          from: { hash: account },
          to: { hash: other },
        },
      ],
      tokenTransfers: [
        {
          transaction_hash: `0x${'55'.repeat(32)}`,
          block_number: 12,
          log_index: 2,
          timestamp: '2026-09-12T21:02:00.000Z',
          from: { hash: other },
          to: { hash: account },
          token: { address_hash: SEPOLIA_USDC_ADDRESS, symbol: 'USDC', decimals: '6' },
          total: { value: '2500000', decimals: '6' },
        },
      ],
    });

    expect(result.items).toMatchObject([
      { direction: 'received', asset: 'USDC', amount: '2.5', counterparty: other },
      { direction: 'sent', asset: 'ETH', amount: '0.000001', counterparty: other },
      { direction: 'received', asset: 'ETH', amount: '0.001', counterparty: other },
    ]);
    expect(result.skippedCount).toBe(0);
  });

  it('excludes failed, zero-value, unrelated, and unpinned token activity', () => {
    const result = normalizeActivity({
      account,
      transactions: [
        {
          hash: transactionHash,
          block_number: 10,
          timestamp: '2026-09-12T20:54:24.000Z',
          value: '1',
          status: 'error',
          result: 'failed',
          from: { hash: other },
          to: { hash: account },
        },
      ],
      internalTransactions: [],
      tokenTransfers: [
        {
          transaction_hash: transactionHash,
          block_number: 10,
          log_index: 2,
          timestamp: '2026-09-12T20:54:24.000Z',
          from: { hash: other },
          to: { hash: account },
          token: {
            address_hash: '0x3333333333333333333333333333333333333333',
            symbol: 'OTHER',
            decimals: '6',
          },
          total: { value: '1000000', decimals: '6' },
        },
      ],
    });

    expect(result).toEqual({ items: [], skippedCount: 0 });
  });

  it('reports malformed records separately from verified empty activity', () => {
    const result = normalizeActivity({
      account,
      transactions: [
        {
          hash: transactionHash,
          block_number: 10,
          timestamp: 'not-a-date',
          value: '1',
          status: 'ok',
          result: 'success',
          from: { hash: other },
          to: { hash: account },
        },
        {
          hash: transactionHash,
          block_number: 11,
          timestamp: '2026-09-12T20:54:24.000Z',
          value: '1',
          status: undefined as unknown as string,
          result: 'success',
          from: { hash: other },
          to: { hash: account },
        },
        {
          hash: 'not-a-hash' as Hash,
          block_number: 12,
          timestamp: '2026-09-12T20:54:24.000Z',
          value: '1',
          status: 'ok',
          result: 'success',
          from: { hash: other },
          to: { hash: account },
        },
        {
          hash: transactionHash,
          block_number: 13,
          timestamp: '2026-09-12T20:54:24.000Z',
          value: '1',
          status: 'garbage',
          result: 'garbage',
          from: { hash: other },
          to: { hash: account },
        },
      ],
      internalTransactions: [],
      tokenTransfers: [],
    });

    expect(result).toEqual({ items: [], skippedCount: 4 });
  });
});
