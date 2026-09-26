import assert from 'node:assert/strict';

import { getAddress, isAddress, isHash } from 'viem';

// Keep these in sync with src/wallet/multibaas.ts and src/wallet/sepolia.ts.
const API_PREFIX = '/api/v0';
const SEPOLIA_CHAIN_ID = 11155111n;
// Keep in sync with MULTIBAAS_CONTRACTS in src/wallet/multibaas.ts.
const CONTRACTS = {
  usdc: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', label: 'usdc' },
  entryPoint: { address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032', label: 'usdc2' },
  ethUsdFeed: { address: '0x694AA1769357215DE4FAC081bf1f309aDC325306', label: 'ethprice' },
};

if (!process.env.MULTIBAAS_BASE_URL || !process.env.MULTIBAAS_API_KEY) {
  throw new Error('MULTIBAAS_BASE_URL and MULTIBAAS_API_KEY are required');
}

const apiUrl = `${process.env.MULTIBAAS_BASE_URL.replace(/\/+$/, '')}${API_PREFIX}`;
const verifyAccount = getAddress(process.env.VERIFY_ACCOUNT ?? CONTRACTS.usdc.address);

async function request(path, body) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${process.env.MULTIBAAS_API_KEY}`,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Node's fetch sends no Origin header, which is what a native app does too.
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MultiBaas ${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const payload = JSON.parse(text);
  assert.ok(payload && typeof payload === 'object' && 'result' in payload, `${path} has no result`);
  return payload.result;
}

async function query(eventQuery, limit) {
  const result = await request(`/queries?offset=0&limit=${limit}`, eventQuery);
  assert.ok(Array.isArray(result?.rows), 'event query result has no rows array');
  return result.rows;
}

async function callMethod(address, label, method, args) {
  const result = await request(
    `/chains/ethereum/addresses/${address}/contracts/${label}/methods/${method}`,
    { args, formatInts: 'as_strings' },
  );
  if ('kind' in result) assert.equal(result.kind, 'MethodCallResponse');
  return result.output;
}

function printFinding(step, label, value) {
  console.log(`\n[${step}] ${label}:\n${JSON.stringify(value, null, 2)}`);
}

function findChainId(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (/^chain_?id$/i.test(key) && entry !== null && entry !== undefined) return { key, entry };
    const nested = findChainId(entry, depth + 1);
    if (nested) return { key: `${key}.${nested.key}`, entry: nested.entry };
  }
  return undefined;
}

const transferSelect = [
  { type: 'tx_hash', alias: 'txHash' },
  { type: 'block_number', alias: 'blockNumber' },
  { type: 'triggered_at', alias: 'timestamp' },
  { type: 'input', inputIndex: 0, alias: 'from' },
  { type: 'input', inputIndex: 1, alias: 'to' },
  { type: 'input', inputIndex: 2, alias: 'value' },
];

function transferQuery(extraFilters = []) {
  return {
    events: [
      {
        eventName: 'Transfer',
        select: transferSelect,
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: CONTRACTS.usdc.address },
            ...extraFilters,
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC',
  };
}

function assertTransferRow(row) {
  assert.ok(isHash(row.txHash), `txHash is not a hash: ${row.txHash}`);
  assert.ok(Number.isSafeInteger(Number(row.blockNumber)), `blockNumber invalid: ${row.blockNumber}`);
  assert.ok(Number.isFinite(Date.parse(row.timestamp)), `timestamp invalid: ${row.timestamp}`);
  assert.ok(isAddress(row.from), `from invalid: ${row.from}`);
  assert.ok(isAddress(row.to), `to invalid: ${row.to}`);
  BigInt(row.value);
}

// 1. Chain status and REST prefix.
const status = await request('/chains/ethereum/status');
printFinding(1, 'chain status result', status);
const chainId = findChainId(status);
assert.ok(chainId, 'chain status did not include a chain id field');
assert.equal(BigInt(chainId.entry), SEPOLIA_CHAIN_ID);
console.log(`[1] chain id field: ${chainId.key}`);

// 2. Each pinned contract is linked under its label.
for (const [name, { address, label }] of Object.entries(CONTRACTS)) {
  const result = await request(`/contracts/${label}`);
  const instances = (result.instances ?? []).map((instance) => String(instance.address ?? '').toLowerCase());
  assert.ok(
    instances.includes(address.toLowerCase()),
    `${name} (${address}) is not linked under the label ${label}: ${JSON.stringify(result.instances)}`,
  );
  console.log(`[2] ${name} is linked under label ${label}`);
}

// 3. USDC decimals through the method-call API.
const decimals = await callMethod(CONTRACTS.usdc.address, CONTRACTS.usdc.label, 'decimals', []);
assert.equal(String(decimals), '6');
console.log('[3] usdc.decimals() = 6');

// 4. Chainlink latestRoundData shape.
const roundData = await callMethod(
  CONTRACTS.ethUsdFeed.address,
  CONTRACTS.ethUsdFeed.label,
  'latestRoundData',
  [],
);
printFinding(4, 'latestRoundData output', roundData);
const roundValues = Array.isArray(roundData) ? roundData : Object.values(roundData ?? {});
assert.equal(roundValues.length, 5, 'latestRoundData did not return five values');

// 5. Address balance field.
const addressResult = await request(`/chains/ethereum/addresses/${verifyAccount}?include=balance`);
printFinding(5, `address result for ${verifyAccount}`, addressResult);
const balanceKey = Object.keys(addressResult).find((key) => /balance/i.test(key));
assert.ok(balanceKey, 'address result has no balance field');
const balance = BigInt(addressResult[balanceKey]);
console.log(`[5] balance field "${balanceKey}" = ${balance} wei`);

// 6. Transfer event query. Step 9 relies on this request being sent without an Origin header.
const transfers = await query(transferQuery(), 5);
assert.ok(transfers.length > 0, 'USDC Transfer query returned no rows; is event sync enabled?');
transfers.forEach(assertTransferRow);
printFinding(6, 'first USDC Transfer row', transfers[0]);

// 7. Address case in input filters. Use a sender with letters in its address, since the zero
// address reads the same in both forms. The app sends lowercase (formatAddressFilterValue).
const sender = getAddress(transfers.find((row) => /[a-f]/i.test(row.from.slice(2)))?.from ?? transfers[0].from);
const caseFindings = {};
for (const [form, value] of [
  ['lowercase', sender.toLowerCase()],
  ['checksummed', sender],
]) {
  const rows = await query(
    transferQuery([{ fieldType: 'input', inputIndex: 0, operator: 'equal', value }]),
    5,
  );
  caseFindings[form] = rows.length;
}
printFinding(7, `input filter rows for ${sender}`, caseFindings);
assert.ok(caseFindings.lowercase > 0, 'a lowercase address did not match an input filter');

// 8. UserOperationEvent query.
const operations = await query(
  {
    events: [
      {
        eventName: 'UserOperationEvent',
        select: [
          { type: 'tx_hash', alias: 'txHash' },
          { type: 'block_number', alias: 'blockNumber' },
          { type: 'triggered_at', alias: 'timestamp' },
          { type: 'input', inputIndex: 0, alias: 'userOpHash' },
          { type: 'input', inputIndex: 1, alias: 'sender' },
          { type: 'input', inputIndex: 2, alias: 'paymaster' },
          { type: 'input', inputIndex: 3, alias: 'nonce' },
          { type: 'input', inputIndex: 4, alias: 'success' },
          { type: 'input', inputIndex: 5, alias: 'actualGasCost' },
          { type: 'input', inputIndex: 6, alias: 'actualGasUsed' },
        ],
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: CONTRACTS.entryPoint.address },
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC',
  },
  5,
);
assert.ok(operations.length > 0, 'UserOperationEvent query returned no rows; is event sync enabled?');
for (const alias of ['userOpHash', 'sender', 'paymaster', 'nonce', 'success', 'actualGasCost', 'actualGasUsed']) {
  assert.ok(
    operations[0][alias] !== undefined && operations[0][alias] !== null,
    `UserOperationEvent row is missing ${alias}`,
  );
}
printFinding(8, 'first UserOperationEvent row', operations[0]);
// bytes32 inputs arrive as a JSON byte array string; the app converts them in parseBytes32.
const userOpHash = operations[0].userOpHash;
assert.ok(
  isHash(userOpHash) || (Array.isArray(JSON.parse(userOpHash)) && JSON.parse(userOpHash).length === 32),
  `userOpHash is neither hex nor a 32-byte array: ${userOpHash}`,
);

// 9. CORS proof.
console.log('\n[9] Event queries from Node with no Origin header succeeded.');
console.log('\nMultiBaas verification passed.');
