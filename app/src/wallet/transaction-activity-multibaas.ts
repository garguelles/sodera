import { AppState } from 'react-native';
import {
  createPublicClient,
  decodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHash,
  keccak256,
  zeroAddress,
  type Address,
  type Hash,
} from 'viem';
import { sepolia } from 'viem/chains';

import {
  MULTIBAAS_CONTRACTS,
  MULTIBAAS_MAX_QUERY_LIMIT,
  createMultiBaasClient,
  formatAddressFilterValue,
  readMultiBaasConfigFromEnv,
  type EventQuery,
  type EventQueryField,
  type MultiBaasClient,
} from './multibaas';
import { aquaAbi } from './aqua-calls';
import { SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS } from './sepolia';
import type {
  TransactionActivityEarn,
  TransactionActivityItem,
  TransactionActivityOperation,
  TransactionActivityOperationSummary,
  TransactionActivityProvider,
  TransactionActivityTransfer,
} from './transaction-activity';
import { createBlockscoutReceivedEthReader, type ReceivedEthReader } from './received-eth-blockscout';
import { groupPayWithActivity } from './pay-with-activity';
import {
  ethTransfersOf,
  readUserOperationCalls,
  type UserOperationCall,
  type UserOperationEthTransfer,
  type UserOperationTransactionReader,
} from './user-operation-calls';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';

const USDC_DECIMALS = 6;

type EventRow = Record<string, unknown>;

const TRANSFER_SELECT: EventQueryField[] = [
  { type: 'tx_hash', alias: 'txHash' },
  { type: 'block_number', alias: 'blockNumber' },
  { type: 'triggered_at', alias: 'timestamp' },
  { type: 'input', inputIndex: 0, alias: 'from' },
  { type: 'input', inputIndex: 1, alias: 'to' },
  { type: 'input', inputIndex: 2, alias: 'value' },
];

const OPERATION_SELECT: EventQueryField[] = [
  { type: 'tx_hash', alias: 'txHash' },
  { type: 'block_number', alias: 'blockNumber' },
  { type: 'triggered_at', alias: 'timestamp' },
  { type: 'input', inputIndex: 0, alias: 'userOpHash' },
  { type: 'input', inputIndex: 2, alias: 'paymaster' },
  { type: 'input', inputIndex: 3, alias: 'nonce' },
  { type: 'input', inputIndex: 4, alias: 'success' },
  { type: 'input', inputIndex: 5, alias: 'actualGasCost' },
  { type: 'input', inputIndex: 6, alias: 'actualGasUsed' },
];

export function buildUsdcTransferQuery(account: Address, direction: 'sent' | 'received'): EventQuery {
  return {
    events: [
      {
        eventName: 'Transfer',
        select: TRANSFER_SELECT,
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.usdc.address },
            {
              fieldType: 'input',
              inputIndex: direction === 'sent' ? 0 : 1,
              operator: 'equal',
              value: formatAddressFilterValue(account),
            },
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC',
  };
}

const AQUA_SELECT: EventQueryField[] = [
  { type: 'tx_hash', alias: 'txHash' },
  { type: 'block_number', alias: 'blockNumber' },
  { type: 'triggered_at', alias: 'timestamp' },
  { type: 'input', inputIndex: 2, alias: 'strategyHash' },
];

const AQUA_FLOW_SELECT: EventQueryField[] = [
  ...AQUA_SELECT,
  { type: 'input', inputIndex: 3, alias: 'token' },
  { type: 'input', inputIndex: 4, alias: 'amount' },
];

/**
 * Aqua events for the account's Earn positions. Shipped opens a position (deposit) and Docked closes
 * it (withdraw); neither carries amounts. Pulled and Pushed are the trades that change a position's
 * balances, which give the amounts a withdrawal closed with. All four start (maker, app, strategyHash).
 */
export const AQUA_EVENT_NAMES = ['Shipped', 'Docked', 'Pulled', 'Pushed'] as const;
export type AquaEventName = (typeof AQUA_EVENT_NAMES)[number];

export function buildAquaEventQuery(account: Address, eventName: AquaEventName): EventQuery {
  return {
    events: [
      {
        eventName,
        select: eventName === 'Pulled' || eventName === 'Pushed' ? AQUA_FLOW_SELECT : AQUA_SELECT,
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.aqua.address },
            { fieldType: 'input', inputIndex: 0, operator: 'equal', value: formatAddressFilterValue(account) },
            {
              fieldType: 'input',
              inputIndex: 1,
              operator: 'equal',
              value: formatAddressFilterValue(MULTIBAAS_CONTRACTS.aquaSwapVmRouter.address),
            },
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC',
  };
}

export function buildUserOperationQuery(account: Address): EventQuery {
  return {
    events: [
      {
        eventName: 'UserOperationEvent',
        select: OPERATION_SELECT,
        filter: {
          rule: 'and',
          children: [
            {
              fieldType: 'contract_address',
              operator: 'equal',
              value: MULTIBAAS_CONTRACTS.entryPoint.address,
            },
            {
              fieldType: 'input',
              inputIndex: 1,
              operator: 'equal',
              value: formatAddressFilterValue(account),
            },
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC',
  };
}

export function createMultiBaasTransactionActivityProvider({
  storage = walletIdentityNativeStorage,
  client,
  transactionReader,
  receivedEth = createBlockscoutReceivedEthReader(),
  limit = MULTIBAAS_MAX_QUERY_LIMIT,
}: {
  storage?: WalletIdentityStorage;
  client?: MultiBaasClient;
  transactionReader?: UserOperationTransactionReader;
  receivedEth?: ReceivedEthReader;
  limit?: number;
} = {}) {
  let resolvedClient = client;
  const getClient = () => {
    resolvedClient ??= createMultiBaasClient({ config: readMultiBaasConfigFromEnv() });
    return resolvedClient;
  };
  let resolvedReader = transactionReader;
  const getReader = () => {
    resolvedReader ??= createSepoliaTransactionReader();
    return resolvedReader;
  };
  const listeners = new Set<() => void>();
  const provider: TransactionActivityProvider & { refresh(): void } = {
    source: 'multibaas',
    async load() {
      const { account } = await readPersistedWalletIdentity(storage);
      const multiBaas = getClient();
      const receivedEthLoad = receivedEth.load(account).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      );
      // Earn rows are extra detail: when Aqua's events cannot be read, the rest of the feed still loads.
      const aquaLoad = Promise.all(
        AQUA_EVENT_NAMES.map((eventName) =>
          multiBaas.executeEventQuery(buildAquaEventQuery(account, eventName), { limit }),
        ),
      ).then(
        ([shipped, docked, pulled, pushed]) => ({ ok: true as const, shipped, docked, pulled, pushed }),
        () => ({ ok: false as const }),
      );
      const [usdcSent, usdcReceived, operations] = await Promise.all([
        multiBaas.executeEventQuery(buildUsdcTransferQuery(account, 'sent'), { limit }),
        multiBaas.executeEventQuery(buildUsdcTransferQuery(account, 'received'), { limit }),
        multiBaas.executeEventQuery(buildUserOperationQuery(account), { limit }),
      ]);
      const operationCalls = await readOperationCalls({
        account,
        reader: getReader(),
        operationRows: operations,
      });
      const ethTransfers = new Map<string, UserOperationEthTransfer[]>();
      operationCalls.forEach((calls, hash) => {
        const sends = ethTransfersOf(calls);
        if (sends && sends.length > 0) ethTransfers.set(hash, sends);
      });
      const indexed = normalizeMultiBaasActivity({
        account,
        usdcSent,
        usdcReceived,
        operations,
        ethTransfers,
      });
      const [received, aqua] = await Promise.all([receivedEthLoad, aquaLoad]);
      const earn = aqua.ok
        ? normalizeAquaActivity({
            ...aqua,
            operations,
            operationCalls,
            // A full page may leave out older trades, so withdrawal amounts would be wrong.
            flowsComplete: aqua.pulled.length < limit && aqua.pushed.length < limit,
          })
        : { items: [], skippedCount: 0 };
      const items = sortActivity(
        mergeEarnActivity(
          groupPayWithActivity({
            items: [...indexed.items, ...(received.ok ? received.value.items : [])],
            operationCalls,
            receivedEthLoaded: received.ok,
          }),
          earn.items,
        ),
      );
      const skippedCount =
        indexed.skippedCount + earn.skippedCount + (received.ok ? received.value.skippedCount : 0);
      const messages = [
        ...(skippedCount > 0
          ? [`${skippedCount} malformed ${skippedCount === 1 ? 'record was' : 'records were'} omitted.`]
          : []),
        ...(received.ok ? [] : ['Received ETH could not be loaded from Blockscout.']),
        ...(aqua.ok ? [] : ['Earn activity could not be loaded from MultiBaas.']),
      ];
      if (messages.length > 0) {
        return { status: 'partial', account, items, message: messages.join(' ') };
      }
      return items.length > 0
        ? { status: 'ready', account, items }
        : { status: 'empty', account };
    },
    subscribeToChanges(listener) {
      listeners.add(listener);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') listener();
      });
      return () => {
        listeners.delete(listener);
        subscription.remove();
      };
    },
    refresh() {
      listeners.forEach((listener) => listener());
    },
  };
  return provider;
}

function createSepoliaTransactionReader(): UserOperationTransactionReader {
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('EXPO_PUBLIC_SEPOLIA_RPC_URL is required for transaction details');
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

/**
 * Native ETH transfers emit no events, so MultiBaas only sees the user operation. Read the calls
 * of every operation from its bundle transaction: a batched operation can move USDC and send ETH
 * at once, such as a swap followed by a send, and the calls also identify Pay with operations.
 * A failed lookup leaves the operation's ETH sends out, and the row still shows its USDC
 * transfers or a plain account operation.
 */
export async function readOperationCalls({
  account,
  reader,
  operationRows,
}: {
  account: Address;
  reader: UserOperationTransactionReader;
  operationRows: readonly EventRow[];
}) {
  const result = new Map<string, UserOperationCall[]>();
  await Promise.all(
    operationRows.map(async (row) => {
      const transactionHash = parseHash(row.txHash);
      const userOperationHash = parseBytes32(row.userOpHash);
      const nonce = parseUint(row.nonce);
      if (!transactionHash || !userOperationHash || nonce === null) return;
      try {
        const calls = await readUserOperationCalls(reader, {
          transactionHash,
          sender: account,
          nonce,
        });
        if (calls && calls.length > 0) result.set(userOperationHash.toLowerCase(), calls);
      } catch {
        // The operation row still shows success, sponsorship, and gas.
      }
    }),
  );
  return result;
}

type RowBase = { transactionHash: Hash; blockNumber: number; timestamp: string };

export function normalizeMultiBaasActivity({
  account,
  usdcSent,
  usdcReceived,
  operations,
  ethTransfers = new Map(),
}: {
  account: Address;
  usdcSent: readonly EventRow[];
  usdcReceived: readonly EventRow[];
  operations: readonly EventRow[];
  ethTransfers?: ReadonlyMap<string, readonly UserOperationEthTransfer[]>;
}) {
  const normalizedAccount = account.toLowerCase();
  const transfers: TransactionActivityTransfer[] = [];
  const operationItems: TransactionActivityOperation[] = [];
  let skippedCount = 0;

  for (const [direction, rows] of [
    ['sent', usdcSent],
    ['received', usdcReceived],
  ] as const) {
    for (const row of rows) {
      const base = parseRowBase(row);
      const from = parseAddress(row.from);
      const to = parseAddress(row.to);
      const value = parseUint(row.value);
      if (!base || !from || !to || value === null) {
        skippedCount += 1;
        continue;
      }
      if (value === 0n || from.toLowerCase() === to.toLowerCase()) continue;
      const accountSide = direction === 'sent' ? from : to;
      if (accountSide.toLowerCase() !== normalizedAccount) {
        skippedCount += 1;
        continue;
      }
      transfers.push({
        kind: 'transfer',
        id: `erc20:${base.transactionHash}:${direction}:${from}:${to}:${value}`,
        transactionHash: base.transactionHash,
        direction,
        asset: 'USDC',
        amount: formatUnits(value, USDC_DECIMALS),
        counterparty: direction === 'sent' ? to : from,
        timestamp: base.timestamp,
        blockNumber: base.blockNumber,
        operation: null,
      });
    }
  }

  for (const row of operations) {
    const base = parseRowBase(row);
    const userOperationHash = parseBytes32(row.userOpHash);
    const paymaster = parseAddress(row.paymaster);
    const success = parseBoolean(row.success);
    const actualGasCost = parseUint(row.actualGasCost);
    const actualGasUsed = parseUint(row.actualGasUsed);
    if (
      !base ||
      !userOperationHash ||
      !paymaster ||
      success === null ||
      actualGasCost === null ||
      actualGasUsed === null
    ) {
      skippedCount += 1;
      continue;
    }
    operationItems.push({
      kind: 'operation',
      id: `userop:${userOperationHash}`,
      transactionHash: base.transactionHash,
      userOperationHash,
      success,
      sponsored: paymaster !== zeroAddress,
      actualGasCostWei: actualGasCost.toString(),
      timestamp: base.timestamp,
      blockNumber: base.blockNumber,
    });
  }

  const items: TransactionActivityItem[] = [...transfers];
  for (const operation of operationItems) {
    const summary = {
      userOperationHash: operation.userOperationHash,
      success: operation.success,
      sponsored: operation.sponsored,
      actualGasCostWei: operation.actualGasCostWei,
    };
    const matchingTransfers = transfers.filter(
      (transfer) =>
        transfer.operation === null &&
        transfer.transactionHash?.toLowerCase() === operation.transactionHash.toLowerCase(),
    );
    matchingTransfers.forEach((transfer) => {
      transfer.operation = summary;
    });
    const sends = ethTransfers.get(operation.userOperationHash.toLowerCase());
    if (sends && sends.length > 0) {
      sends.forEach((send, index) => {
        items.push({
          kind: 'transfer',
          id: `eth:${operation.userOperationHash}:${index}`,
          transactionHash: operation.transactionHash,
          direction: 'sent',
          asset: 'ETH',
          amount: formatEther(BigInt(send.valueWei)),
          counterparty: getAddress(send.to),
          timestamp: operation.timestamp,
          blockNumber: operation.blockNumber,
          operation: summary,
        });
      });
    }
    // An operation that moved nothing the feed can show still appears on its own.
    if (matchingTransfers.length === 0 && !(sends && sends.length > 0)) items.push(operation);
  }

  return { items: sortActivity(items), skippedCount };
}

type TokenAmounts = { usdc: bigint; weth: bigint };

/**
 * Earn rows from Aqua's events. A deposit's amounts come from the `ship` call of the account's
 * operation in the same transaction. A withdrawal closes with the deposit plus every trade since:
 * Pushed adds to the position, Pulled takes from it. An amount that cannot be derived is null.
 */
export function normalizeAquaActivity({
  shipped,
  docked,
  pulled,
  pushed,
  operations,
  operationCalls = new Map(),
  flowsComplete = true,
}: {
  shipped: readonly EventRow[];
  docked: readonly EventRow[];
  pulled: readonly EventRow[];
  pushed: readonly EventRow[];
  operations: readonly EventRow[];
  operationCalls?: ReadonlyMap<string, readonly UserOperationCall[]>;
  flowsComplete?: boolean;
}) {
  let skippedCount = 0;
  const operationByTransaction = new Map<string, Hash>();
  for (const row of operations) {
    const transactionHash = parseHash(row.txHash);
    const userOperationHash = parseBytes32(row.userOpHash);
    if (transactionHash && userOperationHash) {
      operationByTransaction.set(transactionHash.toLowerCase(), userOperationHash);
    }
  }

  const items: TransactionActivityEarn[] = [];
  const deposits = new Map<string, TokenAmounts | null>();
  for (const row of shipped) {
    const base = parseRowBase(row);
    const strategyHash = parseBytes32(row.strategyHash);
    if (!base || !strategyHash) {
      skippedCount += 1;
      continue;
    }
    const userOperationHash = operationByTransaction.get(base.transactionHash.toLowerCase());
    const calls = userOperationHash ? operationCalls.get(userOperationHash.toLowerCase()) : undefined;
    const amounts = calls ? shippedAmounts(calls, strategyHash) : null;
    deposits.set(strategyHash.toLowerCase(), amounts);
    items.push(earnItem('deposit', base, strategyHash, amounts));
  }

  const flows = new Map<string, TokenAmounts>();
  for (const [sign, rows] of [
    [1n, pushed],
    [-1n, pulled],
  ] as const) {
    for (const row of rows) {
      const base = parseRowBase(row);
      const strategyHash = parseBytes32(row.strategyHash);
      const token = parseAddress(row.token);
      const amount = parseUint(row.amount);
      if (!base || !strategyHash || !token || amount === null) {
        skippedCount += 1;
        continue;
      }
      const key = strategyHash.toLowerCase();
      const net = flows.get(key) ?? { usdc: 0n, weth: 0n };
      if (token === getAddress(SEPOLIA_USDC_ADDRESS)) net.usdc += sign * amount;
      else if (token === getAddress(SEPOLIA_WETH_ADDRESS)) net.weth += sign * amount;
      flows.set(key, net);
    }
  }

  for (const row of docked) {
    const base = parseRowBase(row);
    const strategyHash = parseBytes32(row.strategyHash);
    if (!base || !strategyHash) {
      skippedCount += 1;
      continue;
    }
    const key = strategyHash.toLowerCase();
    const deposit = deposits.get(key) ?? null;
    const net = flows.get(key) ?? { usdc: 0n, weth: 0n };
    const closing =
      flowsComplete && deposit ? { usdc: deposit.usdc + net.usdc, weth: deposit.weth + net.weth } : null;
    items.push(earnItem('withdraw', base, strategyHash, closing && closing.usdc >= 0n && closing.weth >= 0n ? closing : null));
  }

  return { items, skippedCount };
}

/** The USDC and WETH a batch's `Aqua.ship` gave the strategy with this hash. */
function shippedAmounts(calls: readonly UserOperationCall[], strategyHash: Hash): TokenAmounts | null {
  for (const call of calls) {
    if (call.to.toLowerCase() !== MULTIBAAS_CONTRACTS.aqua.address.toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: aquaAbi, data: call.data });
    } catch {
      continue;
    }
    if (decoded.functionName !== 'ship') continue;
    const [, strategy, tokens, amounts] = decoded.args;
    if (keccak256(strategy).toLowerCase() !== strategyHash.toLowerCase()) continue;
    const amountOf = (token: string) => {
      const index = tokens.findIndex((candidate) => candidate.toLowerCase() === token.toLowerCase());
      return index === -1 ? null : amounts[index];
    };
    const usdc = amountOf(SEPOLIA_USDC_ADDRESS);
    const weth = amountOf(SEPOLIA_WETH_ADDRESS);
    return usdc === null || weth === null ? null : { usdc, weth };
  }
  return null;
}

function earnItem(
  direction: TransactionActivityEarn['direction'],
  base: RowBase,
  strategyHash: Hash,
  amounts: TokenAmounts | null,
): TransactionActivityEarn {
  return {
    kind: 'earn',
    id: `earn:${direction}:${strategyHash}:${base.transactionHash}`,
    transactionHash: base.transactionHash,
    direction,
    asset: 'USDC',
    amount: amounts ? formatUnits(amounts.usdc, USDC_DECIMALS) : null,
    pairedAsset: 'WETH',
    pairedAmount: amounts ? formatEther(amounts.weth) : null,
    strategyHash,
    timestamp: base.timestamp,
    blockNumber: base.blockNumber,
    operation: null,
  };
}

/**
 * An Earn deposit or withdrawal is one row. The account operation that carried it, and any transfer
 * from the same transaction (such as wrapping ETH into WETH, or the ETH an unwrap returns), fold into
 * it the way a USDC send folds in its operation.
 */
export function mergeEarnActivity(
  items: readonly TransactionActivityItem[],
  earnItems: readonly TransactionActivityEarn[],
): TransactionActivityItem[] {
  if (earnItems.length === 0) return [...items];
  const byTransaction = new Map(earnItems.map((item) => [item.transactionHash.toLowerCase(), { ...item }]));
  const kept: TransactionActivityItem[] = [];
  for (const item of items) {
    const earn = item.transactionHash ? byTransaction.get(item.transactionHash.toLowerCase()) : undefined;
    if (!earn || item.kind === 'earn') {
      kept.push(item);
      continue;
    }
    earn.operation ??= item.kind === 'operation' ? operationSummary(item) : item.operation;
  }
  return [...kept, ...byTransaction.values()];
}

function operationSummary(operation: TransactionActivityOperation): TransactionActivityOperationSummary {
  return {
    userOperationHash: operation.userOperationHash,
    success: operation.success,
    sponsored: operation.sponsored,
    actualGasCostWei: operation.actualGasCostWei,
  };
}

export function sortActivity(items: TransactionActivityItem[]) {
  return items.sort(
    (left, right) =>
      Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
      right.blockNumber - left.blockNumber ||
      right.id.localeCompare(left.id),
  );
}

function parseRowBase(row: EventRow): RowBase | null {
  const transactionHash = parseHash(row.txHash);
  const blockNumber = parseBlockNumber(row.blockNumber);
  const timestamp = parseTimestamp(row.timestamp);
  if (!transactionHash || blockNumber === null || !timestamp) return null;
  return { transactionHash, blockNumber, timestamp };
}

function parseHash(value: unknown): Hash | null {
  return typeof value === 'string' && isHash(value) ? value : null;
}

/**
 * MultiBaas returns `bytes32` event inputs as a JSON byte array string such as
 * `[138, 228, ...]` rather than hex. Accept either form.
 */
export function parseBytes32(value: unknown): Hash | null {
  const hex = parseHash(value);
  if (hex) return hex;
  if (typeof value !== 'string' || !value.startsWith('[')) return null;
  let bytes: unknown;
  try {
    bytes = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 32 ||
    !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return null;
  }
  return `0x${bytes.map((byte: number) => byte.toString(16).padStart(2, '0')).join('')}` as Hash;
}

function parseAddress(value: unknown): Address | null {
  return typeof value === 'string' && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

function parseBlockNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * MultiBaas returns Postgres-style timestamps such as `2026-09-26 05:45:12+00`. Hermes only
 * guarantees ISO-8601 parsing, so rewrite them to `2026-09-26T05:45:12+00:00` first.
 */
export function parseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, date, time, zone = 'Z'] = match;
  const offset = zone === 'Z' ? 'Z' : zone.length === 3 ? `${zone}:00` : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = Date.parse(`${date}T${time}${offset}`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseUint(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export const multiBaasTransactionActivityProvider = createMultiBaasTransactionActivityProvider();
