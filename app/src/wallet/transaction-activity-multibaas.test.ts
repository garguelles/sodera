import { zeroAddress, type Address, type Hash, type Hex } from 'viem';

import type { MultiBaasClient } from './multibaas';
import type { ReceivedEthReader } from './received-eth-blockscout';
import type { TransactionActivityTransfer } from './transaction-activity';
import {
  createMultiBaasTransactionActivityProvider,
  normalizeMultiBaasActivity,
  parseBytes32,
  parseTimestamp,
} from './transaction-activity-multibaas';
import type { UserOperationTransactionReader } from './user-operation-calls';
import { encodeBundle, encodeKernelCalls } from './user-operation-calls-fixtures';
import { CURRENT_WALLET_IDENTITY_PINS, type WalletIdentityStorage } from './wallet-identity';

jest.mock('./wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const paymaster = '0x5555555555555555555555555555555555555555' as Address;
const hash = (byte: string) => `0x${byte.repeat(32)}` as Hash;

describe('normalizeMultiBaasActivity', () => {
  it('lists USDC transfers in and out newest first', () => {
    const result = normalize({
      usdcSent: [transferRow({ txHash: hash('aa'), from: account, to: other, value: '1500000', block: 10 })],
      usdcReceived: [
        transferRow({ txHash: hash('bb'), from: other, to: account, value: '2500000', block: 12 }),
      ],
    });

    expect(result.skippedCount).toBe(0);
    expect(result.items).toEqual([
      expect.objectContaining({
        kind: 'transfer',
        direction: 'received',
        asset: 'USDC',
        amount: '2.5',
        counterparty: other,
        blockNumber: 12,
        operation: null,
      }),
      expect.objectContaining({
        kind: 'transfer',
        direction: 'sent',
        asset: 'USDC',
        amount: '1.5',
        counterparty: other,
        blockNumber: 10,
      }),
    ]);
  });

  it('merges a USDC send with its user operation into one row', () => {
    const result = normalize({
      usdcSent: [transferRow({ txHash: hash('aa'), from: account, to: other, value: '1000000' })],
      operations: [operationRow({ txHash: hash('aa'), userOpHash: hash('cc'), paymaster })],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: 'transfer',
      asset: 'USDC',
      operation: {
        userOperationHash: hash('cc'),
        success: true,
        sponsored: true,
        actualGasCostWei: '12000000000000',
      },
    });
  });

  it('shows an ETH send decoded from its transaction', () => {
    const result = normalize({
      operations: [operationRow({ txHash: hash('aa'), userOpHash: hash('cc'), paymaster, block: 20 })],
      ethTransfers: new Map([[hash('cc'), [{ to: other.toLowerCase() as Address, valueWei: '100000000000000000' }]]]),
    });

    expect(result.items).toEqual([
      {
        kind: 'transfer',
        id: `eth:${hash('cc')}:0`,
        transactionHash: hash('aa'),
        direction: 'sent',
        asset: 'ETH',
        amount: '0.1',
        counterparty: other,
        timestamp: '2026-09-26T01:00:00.000Z',
        blockNumber: 20,
        operation: {
          userOperationHash: hash('cc'),
          success: true,
          sponsored: true,
          actualGasCostWei: '12000000000000',
        },
      },
    ]);
  });

  it('keeps a standalone failed self-funded operation', () => {
    const result = normalize({
      operations: [
        operationRow({
          txHash: hash('aa'),
          userOpHash: hash('cc'),
          paymaster: zeroAddress,
          success: 'false',
          blockNumber: '30',
        }),
      ],
    });

    expect(result.items).toEqual([
      {
        kind: 'operation',
        id: `userop:${hash('cc')}`,
        transactionHash: hash('aa'),
        userOperationHash: hash('cc'),
        success: false,
        sponsored: false,
        actualGasCostWei: '12000000000000',
        timestamp: '2026-09-26T01:00:00.000Z',
        blockNumber: 30,
      },
    ]);
  });

  it('reads an operation row in the shape MultiBaas returns', () => {
    const userOpBytes = Array.from({ length: 32 }, () => 0xcc);
    const result = normalize({
      operations: [
        {
          actualGasCost: '133746347871830',
          actualGasUsed: '121054',
          blockNumber: '11784436',
          nonce: '7',
          paymaster: '0x777777777777aec03fd955926dbf81597e66834c',
          success: 'true',
          timestamp: '2026-09-26 06:26:00+00',
          txHash: hash('aa'),
          userOpHash: `[${userOpBytes.join(', ')}]`,
        },
      ],
    });

    expect(result).toEqual({
      skippedCount: 0,
      items: [
        expect.objectContaining({
          kind: 'operation',
          userOperationHash: hash('cc'),
          success: true,
          sponsored: true,
          blockNumber: 11784436,
          timestamp: '2026-09-26T06:26:00.000Z',
        }),
      ],
    });
  });

  it('counts malformed rows as skipped', () => {
    const result = normalize({
      usdcSent: [
        transferRow({ txHash: '0x1234', from: account, to: other }),
        transferRow({ from: account, to: other, value: '-1' }),
        transferRow({ from: account, to: 'not-an-address' }),
        { ...transferRow({ from: account, to: other }), timestamp: 'yesterday' },
        transferRow({ from: other, to: account }),
      ],
      operations: [
        operationRow({ success: 'maybe' }),
        { ...operationRow({}), actualGasCost: undefined },
        { ...operationRow({}), blockNumber: -1 },
      ],
    });

    expect(result.items).toEqual([]);
    expect(result.skippedCount).toBe(8);
  });

  it('drops zero-value and self-transfer rows', () => {
    const result = normalize({
      usdcSent: [
        transferRow({ from: account, to: other, value: '0' }),
        transferRow({ from: account, to: account, value: '1' }),
      ],
      usdcReceived: [transferRow({ from: account, to: account, value: '1' })],
    });

    expect(result).toEqual({ items: [], skippedCount: 0 });
  });

  it('orders by timestamp, then block, then id', () => {
    const result = normalize({
      usdcSent: [
        transferRow({ txHash: hash('01'), from: account, to: other, block: 5, timestamp: '2026-09-26T02:00:00Z' }),
        transferRow({ txHash: hash('02'), from: account, to: other, block: 7, timestamp: '2026-09-26T02:00:00Z' }),
      ],
      operations: [
        operationRow({ txHash: hash('03'), userOpHash: hash('04'), timestamp: '2026-09-26T03:00:00Z' }),
        operationRow({ txHash: hash('05'), userOpHash: hash('06'), timestamp: '2026-09-25T03:00:00Z' }),
      ],
    });

    expect(result.items.map((item) => item.transactionHash)).toEqual([
      hash('03'),
      hash('02'),
      hash('01'),
      hash('05'),
    ]);
  });
});

describe('parseBytes32', () => {
  it('accepts hex and the byte array form MultiBaas returns', () => {
    const bytes = Array.from({ length: 32 }, (_, index) => index * 8);
    const hex = `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;

    expect(parseBytes32(hex)).toBe(hex);
    expect(parseBytes32(`[${bytes.join(', ')}]`)).toBe(hex);
  });

  it('rejects wrong lengths and values', () => {
    expect(parseBytes32('[1, 2, 3]')).toBeNull();
    expect(parseBytes32(`[${Array(32).fill(256).join(',')}]`)).toBeNull();
    expect(parseBytes32('[not json')).toBeNull();
    expect(parseBytes32(12)).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('accepts the timestamp forms MultiBaas and ISO-8601 use', () => {
    expect(parseTimestamp('2026-09-26 05:45:12+00')).toBe('2026-09-26T05:45:12.000Z');
    expect(parseTimestamp('2026-09-26 14:45:12.5+09:00')).toBe('2026-09-26T05:45:12.500Z');
    expect(parseTimestamp('2026-09-26T05:45:12Z')).toBe('2026-09-26T05:45:12.000Z');
    expect(parseTimestamp('2026-09-26T05:45:12-0130')).toBe('2026-09-26T07:15:12.000Z');
  });

  it('rejects anything else', () => {
    expect(parseTimestamp('yesterday')).toBeNull();
    expect(parseTimestamp('2026-09-26')).toBeNull();
    expect(parseTimestamp(1790401512)).toBeNull();
  });
});

describe('createMultiBaasTransactionActivityProvider', () => {
  it('sends the three event queries and reports an empty account', async () => {
    const client = createClient();
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: createReceivedEth(),
      client,
      transactionReader: createReader(),
      limit: 50,
    });

    await expect(provider.load()).resolves.toEqual({ status: 'empty', account });

    expect(provider.source).toBe('multibaas');
    expect(client.executeEventQuery).toHaveBeenCalledTimes(3);
    const calls = jest.mocked(client.executeEventQuery).mock.calls;
    for (const [, options] of calls) expect(options).toEqual({ limit: 50 });

    const [sent, received, operations] = calls.map(([query]) => query);
    expect(sent).toEqual({
      events: [
        {
          eventName: 'Transfer',
          select: [
            { type: 'tx_hash', alias: 'txHash' },
            { type: 'block_number', alias: 'blockNumber' },
            { type: 'triggered_at', alias: 'timestamp' },
            { type: 'input', inputIndex: 0, alias: 'from' },
            { type: 'input', inputIndex: 1, alias: 'to' },
            { type: 'input', inputIndex: 2, alias: 'value' },
          ],
          filter: {
            rule: 'and',
            children: [
              { fieldType: 'contract_address', operator: 'equal', value: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
              { fieldType: 'input', inputIndex: 0, operator: 'equal', value: account },
            ],
          },
        },
      ],
      orderBy: 'timestamp',
      order: 'DESC',
    });
    expect(received.events[0].filter).toEqual({
      rule: 'and',
      children: [
        { fieldType: 'contract_address', operator: 'equal', value: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
        { fieldType: 'input', inputIndex: 1, operator: 'equal', value: account },
      ],
    });
    expect(operations).toEqual({
      events: [
        {
          eventName: 'UserOperationEvent',
          select: [
            { type: 'tx_hash', alias: 'txHash' },
            { type: 'block_number', alias: 'blockNumber' },
            { type: 'triggered_at', alias: 'timestamp' },
            { type: 'input', inputIndex: 0, alias: 'userOpHash' },
            { type: 'input', inputIndex: 2, alias: 'paymaster' },
            { type: 'input', inputIndex: 3, alias: 'nonce' },
            { type: 'input', inputIndex: 4, alias: 'success' },
            { type: 'input', inputIndex: 5, alias: 'actualGasCost' },
            { type: 'input', inputIndex: 6, alias: 'actualGasUsed' },
          ],
          filter: {
            rule: 'and',
            children: [
              { fieldType: 'contract_address', operator: 'equal', value: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' },
              { fieldType: 'input', inputIndex: 1, operator: 'equal', value: account },
            ],
          },
        },
      ],
      orderBy: 'timestamp',
      order: 'DESC',
    });
  });

  it('reports partial activity when rows are malformed', async () => {
    const client = createClient({
      sent: [transferRow({ from: account, to: other }), transferRow({ txHash: 'bad', from: account, to: other })],
    });
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: createReceivedEth(),
      client,
      transactionReader: createReader(),
    });

    await expect(provider.load()).resolves.toMatchObject({
      status: 'partial',
      message: '1 malformed record was omitted.',
      items: [expect.objectContaining({ asset: 'USDC' })],
    });
  });

  it('reads ETH send details from the chain only for operations without a USDC transfer', async () => {
    const reader = createReader(
      encodeBundle(account, 7n, await encodeKernelCalls([{ to: other, value: 100000000000000000n }])),
    );
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: createReceivedEth(),
      client: createClient({
        sent: [transferRow({ txHash: hash('aa'), from: account, to: other })],
        operations: [
          operationRow({ txHash: hash('aa'), userOpHash: hash('cc') }),
          { ...operationRow({ txHash: hash('bb'), userOpHash: hash('dd') }), nonce: '7' },
        ],
      }),
      transactionReader: reader,
    });

    const result = await provider.load();

    expect(reader.getTransaction).toHaveBeenCalledTimes(1);
    expect(reader.getTransaction).toHaveBeenCalledWith({ hash: hash('bb') });
    expect(result).toMatchObject({
      status: 'ready',
      items: expect.arrayContaining([
        expect.objectContaining({ asset: 'ETH', amount: '0.1', counterparty: other, transactionHash: hash('bb') }),
        expect.objectContaining({ asset: 'USDC', transactionHash: hash('aa') }),
      ]),
    });
  });

  it('keeps an operation row when its transaction cannot be read', async () => {
    const reader = createReader();
    jest.mocked(reader.getTransaction).mockRejectedValue(new Error('rpc down'));
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: createReceivedEth(),
      client: createClient({ operations: [{ ...operationRow({}), nonce: '1' }] }),
      transactionReader: reader,
    });

    await expect(provider.load()).resolves.toMatchObject({
      status: 'ready',
      items: [expect.objectContaining({ kind: 'operation' })],
    });
  });

  it('adds ETH received from other wallets, newest first', async () => {
    const received = {
      kind: 'transfer' as const,
      id: `eth-in:${hash('ee')}`,
      transactionHash: hash('ee'),
      direction: 'received' as const,
      asset: 'ETH' as const,
      amount: '0.05',
      counterparty: other,
      timestamp: '2026-09-26T05:00:00.000Z',
      blockNumber: 99,
      operation: null,
    };
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: createReceivedEth([received]),
      client: createClient({ sent: [transferRow({ from: account, to: other })] }),
      transactionReader: createReader(),
    });

    const result = await provider.load();

    expect(result).toMatchObject({ status: 'ready' });
    expect(result.status === 'ready' && result.items.map((item) => item.id)).toEqual([
      received.id,
      expect.stringMatching(/^erc20:/),
    ]);
  });

  it('keeps MultiBaas activity and says so when Blockscout fails', async () => {
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: { load: jest.fn().mockRejectedValue(new Error('Blockscout returned HTTP 502')) },
      client: createClient({ sent: [transferRow({ from: account, to: other })] }),
      transactionReader: createReader(),
    });

    await expect(provider.load()).resolves.toMatchObject({
      status: 'partial',
      message: 'Received ETH could not be loaded from Blockscout.',
      items: [expect.objectContaining({ asset: 'USDC' })],
    });
  });

  it('surfaces MultiBaas failures to the screen', async () => {
    const client = createClient();
    jest.mocked(client.executeEventQuery).mockRejectedValue(new Error('MultiBaas returned HTTP 401'));
    const provider = createMultiBaasTransactionActivityProvider({
      storage: createStorage(),
      receivedEth: createReceivedEth(),
      client,
      transactionReader: createReader(),
    });

    await expect(provider.load()).rejects.toThrow('MultiBaas returned HTTP 401');
  });
});

function normalize(
  input: Partial<Omit<Parameters<typeof normalizeMultiBaasActivity>[0], 'account'>>,
) {
  return normalizeMultiBaasActivity({
    account,
    usdcSent: [],
    usdcReceived: [],
    operations: [],
    ...input,
  });
}

function transferRow({
  txHash = hash('aa'),
  from,
  to,
  value = '1000000',
  block = 10,
  timestamp = '2026-09-26T01:00:00Z',
}: {
  txHash?: string;
  from: string;
  to: string;
  value?: string;
  block?: number;
  timestamp?: string;
}) {
  return { txHash, blockNumber: block, timestamp, from, to, value };
}

function operationRow({
  txHash = hash('aa'),
  userOpHash = hash('cc'),
  paymaster: rowPaymaster = paymaster,
  success = true,
  block = 10,
  blockNumber,
  timestamp = '2026-09-26T01:00:00Z',
}: {
  txHash?: string;
  userOpHash?: string;
  paymaster?: string;
  success?: unknown;
  block?: number;
  blockNumber?: unknown;
  timestamp?: string;
}) {
  return {
    txHash,
    blockNumber: blockNumber ?? block,
    timestamp,
    userOpHash,
    paymaster: rowPaymaster,
    success,
    actualGasCost: '12000000000000',
    actualGasUsed: '90000',
  };
}

function createClient(rows: { sent?: unknown[]; received?: unknown[]; operations?: unknown[] } = {}) {
  const client: MultiBaasClient = {
    executeEventQuery: jest.fn(async (query) => {
      const event = query.events[0];
      if (event.eventName === 'UserOperationEvent') return (rows.operations ?? []) as Record<string, unknown>[];
      const filter = event.filter as { children: { inputIndex?: number }[] };
      const sent = filter.children.some((child) => child.inputIndex === 0);
      return ((sent ? rows.sent : rows.received) ?? []) as Record<string, unknown>[];
    }),
    callMethod: jest.fn(),
    getAddress: jest.fn(),
    getChainStatus: jest.fn(),
  };
  return client;
}

function createReceivedEth(items: TransactionActivityTransfer[] = []): ReceivedEthReader {
  return { load: jest.fn().mockResolvedValue({ items, skippedCount: 0 }) };
}

function createReader(input: Hex = '0x') {
  return { getTransaction: jest.fn().mockResolvedValue({ input }) } satisfies UserOperationTransactionReader;
}

function createStorage(): WalletIdentityStorage {
  const value = JSON.stringify({
    schemaVersion: 1,
    phase: 'accountDeployed',
    pins: CURRENT_WALLET_IDENTITY_PINS,
    credential: {
      id: 'credential',
      publicKeyX: `0x${'11'.repeat(32)}`,
      publicKeyY: `0x${'22'.repeat(32)}`,
      aaguid: `0x${'00'.repeat(16)}`,
      origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
      authenticatorAttachment: 'platform',
    },
    account,
  });
  return {
    read: async () => value,
    write: async () => undefined,
    clear: async () => undefined,
  };
}
