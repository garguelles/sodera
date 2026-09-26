import { createPendingSends, type PendingSend } from './pending-sends';
import type { TransactionActivityProvider } from './transaction-activity';

jest.mock('./wallet-identity', () => ({
  ...jest.requireActual('./wallet-identity'),
  readPersistedWalletIdentity: jest.fn().mockResolvedValue({ account: '0x1111111111111111111111111111111111111111' }),
}));
jest.mock('./wallet-identity-native-storage', () => ({ walletIdentityNativeStorage: {} }));

const account = '0x1111111111111111111111111111111111111111' as const;
const recipient = '0x2222222222222222222222222222222222222222' as const;
const operationHash = `0x${'33'.repeat(32)}` as const;
const transactionHash = `0x${'44'.repeat(32)}` as const;
const send: PendingSend = {
  account, recipient, userOperationHash: operationHash, transactionHash: null,
  asset: 'USDC', amount: '1.25', timestamp: '2026-09-26T12:00:00.000Z', status: 'submitted',
};

function setup() {
  let value: string | null = null;
  const storage = {
    getItem: jest.fn().mockImplementation(async () => value),
    setItem: jest.fn().mockImplementation(async (_key: string, next: string) => { value = next; }),
  };
  const activity: TransactionActivityProvider = {
    source: 'fixture',
    load: jest.fn().mockResolvedValue({ status: 'empty', account }),
    subscribeToChanges: jest.fn().mockReturnValue(() => undefined),
  };
  const lookup = jest.fn().mockResolvedValue(null);
  return { storage, activity, lookup };
}

it('persists submitted sends and restores them before explorer indexing', async () => {
  const dependencies = setup();
  const first = createPendingSends(dependencies);
  await first.update(send);
  const restored = createPendingSends(dependencies);
  const result = await restored.provider.load();
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(result.items[0]).toMatchObject({ status: 'submitted', asset: 'USDC', transactionHash: null });
  expect(dependencies.lookup).toHaveBeenCalledWith(operationHash);
});

it('reconciles a receipt and deduplicates the indexed transfer', async () => {
  const dependencies = setup();
  const sends = createPendingSends(dependencies);
  await sends.update(send);
  dependencies.lookup.mockResolvedValue({ success: true, transactionHash });
  const result = await sends.provider.load();
  if (result.status !== 'ready') throw new Error('Expected activity');
  expect(result.items[0]).toMatchObject({ status: 'confirmed', transactionHash });

  jest.mocked(dependencies.activity.load).mockResolvedValue({ status: 'ready', account, items: [{
    kind: 'transfer', id: 'indexed', transactionHash, direction: 'sent', asset: 'USDC', amount: '1.25',
    counterparty: recipient, timestamp: send.timestamp, blockNumber: 10, operation: null,
  }] });
  const indexed = await sends.provider.load();
  if (indexed.status !== 'ready') throw new Error('Expected activity');
  expect(indexed.items).toHaveLength(1);
  expect(indexed.items[0].id).toBe('indexed');
});

it('surfaces a failed Bundler receipt rather than calling it a confirmed transfer', async () => {
  const dependencies = setup();
  const sends = createPendingSends(dependencies);
  await sends.update(send);
  dependencies.lookup.mockResolvedValue({ success: false, transactionHash });
  const result = await sends.provider.load();
  if (result.status !== 'ready') throw new Error('Expected activity');
  expect(result.items[0]).toMatchObject({ kind: 'transfer', status: 'failed' });
});
