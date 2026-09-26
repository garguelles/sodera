import assert from 'node:assert/strict';

import { getAddress, isAddress, isHash } from 'viem';

// Keep these in sync with src/wallet/multibaas.ts and src/wallet/sepolia.ts.
const API_PREFIX = '/api/v0';
const SEPOLIA_CHAIN_ID = 11155111n;
const PINNED = {
  usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  entrypoint_v07: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  eth_usd_feed: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
};

if (!process.env.MULTIBAAS_BASE_URL || !process.env.MULTIBAAS_API_KEY) {
  throw new Error('MULTIBAAS_BASE_URL and MULTIBAAS_API_KEY are required');
}

const apiUrl = `${process.env.MULTIBAAS_BASE_URL.replace(/\/+$/, '')}${API_PREFIX}`;
const verifyAccount = getAddress(process.env.VERIFY_ACCOUNT ?? PINNED.usdc);

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

async function callMethod(alias, label, method, args) {
  const result = await request(
    `/chains/ethereum/addresses/${alias}/contracts/${label}/methods/${method}`,
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

function findAddressField(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  return Object.values(value).flatMap((entry) =>
    typeof entry === 'string' && isAddress(entry) ? [entry] : findAddressField(entry, depth + 1),
  );
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
            { fieldType: 'contract_address_alias', operator: 'equal', value: 'usdc' },
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

// 2. Aliases resolve to the pinned addresses.
for (const [alias, pinned] of Object.entries(PINNED)) {
  const result = await request(`/chains/ethereum/addresses/${alias}?include=contractLookup`);
  const addresses = findAddressField(result).map((address) => address.toLowerCase());
  assert.ok(
    addresses.includes(pinned.toLowerCase()),
    `alias ${alias} did not resolve to ${pinned}: ${JSON.stringify(result)}`,
  );
  console.log(`[2] alias ${alias} resolves to ${pinned}`);
}

// 3. USDC decimals through the method-call API.
const decimals = await callMethod('usdc', 'usdc', 'decimals', []);
assert.equal(String(decimals), '6');
console.log('[3] usdc.decimals() = 6');

// 4. Chainlink latestRoundData shape.
const roundData = await callMethod('eth_usd_feed', 'eth_usd_feed', 'latestRoundData', []);
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

// 6. Transfer event query. Step 10 relies on this request being sent without an Origin header.
const transfers = await query(transferQuery(), 5);
assert.ok(transfers.length > 0, 'USDC Transfer query returned no rows; is event sync enabled?');
transfers.forEach(assertTransferRow);
printFinding(6, 'first USDC Transfer row', transfers[0]);

// 7. Address case sensitivity in input filters.
const recipient = getAddress(transfers[0].to);
const caseFindings = {};
for (const [form, value] of [
  ['lowercase', recipient.toLowerCase()],
  ['checksummed', recipient],
]) {
  const rows = await query(
    transferQuery([{ fieldType: 'input', inputIndex: 1, operator: 'equal', value }]),
    5,
  );
  caseFindings[form] = rows.length;
}
printFinding(7, `input filter rows for ${recipient}`, caseFindings);
assert.ok(
  caseFindings.lowercase > 0 || caseFindings.checksummed > 0,
  'neither lowercase nor checksummed address matched an input filter',
);

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
            { fieldType: 'contract_address_alias', operator: 'equal', value: 'entrypoint_v07' },
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

// 9. triggered_at filter value format.
const since = new Date(Date.now() - 60 * 60 * 1000);
const timeFindings = {};
for (const [form, value] of [
  ['iso8601', since.toISOString()],
  ['unixSeconds', String(Math.floor(since.getTime() / 1000))],
]) {
  try {
    const rows = await query(
      transferQuery([{ fieldType: 'triggered_at', operator: 'greaterthanorequal', value }]),
      20,
    );
    const older = rows.filter((row) => Date.parse(row.timestamp) < since.getTime());
    timeFindings[form] = { rows: rows.length, olderThanCutoff: older.length };
  } catch (error) {
    timeFindings[form] = { error: error.message };
  }
}
printFinding(9, `triggered_at >= ${since.toISOString()}`, timeFindings);
assert.ok(
  Object.values(timeFindings).some((finding) => finding.rows > 0 && finding.olderThanCutoff === 0),
  'no triggered_at value format returned rows bounded by the cutoff',
);

// 10. CORS proof.
console.log('\n[10] Event queries from Node with no Origin header succeeded.');
console.log('\nMultiBaas verification passed.');
