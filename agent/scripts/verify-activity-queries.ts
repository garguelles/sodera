// Live check of the MultiBaas query shapes `summarize_activity` relies on. Run: pnpm verify:activity
// Needs MULTIBAAS_BASE_URL, MULTIBAAS_API_KEY, and VERIFY_ACCOUNT (an account with USDC transfers).
import assert from 'node:assert/strict';

import { getAddress, type Address } from 'viem';

import { MULTIBAAS_CONTRACTS, createMultiBaasClient, lowercaseAddress, type EventQuery } from '../src/multibaas.ts';
import { summarizeActivity } from '../src/tools.ts';

const baseUrl = process.env.MULTIBAAS_BASE_URL;
const apiKey = process.env.MULTIBAAS_API_KEY;
const rawAccount = process.env.VERIFY_ACCOUNT;
if (!baseUrl || !apiKey) throw new Error('MULTIBAAS_BASE_URL and MULTIBAAS_API_KEY are required in agent/.env');
if (!rawAccount) throw new Error('VERIFY_ACCOUNT is required: an account with USDC transfers');

const account = getAddress(rawAccount) as Address;
const multibaas = createMultiBaasClient({ baseUrl, apiKey });
const lower = lowercaseAddress(account);
const usdc = { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.usdc.address };
const sentBy = { fieldType: 'input', inputIndex: 0, operator: 'equal', value: lower };
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

// 1. `triggered_at` filters take UTC dates as YYYY-MM-DD; timestamps with a time are rejected.
const rawRows = await multibaas.executeEventQuery({
  events: [
    {
      eventName: 'Transfer',
      select: [
        { type: 'triggered_at', alias: 'timestamp' },
        { type: 'input', inputIndex: 1, alias: 'counterparty' },
        { type: 'input', inputIndex: 2, alias: 'value' },
      ],
      filter: { rule: 'and', children: [usdc, sentBy] },
    },
  ],
  orderBy: 'timestamp',
  order: 'DESC',
});
assert.ok(rawRows.length > 0, 'VERIFY_ACCOUNT has no USDC transfers out');
const newest = String(rawRows[0]!.timestamp).slice(0, 10);
const onNewestDay = (operator: string, value: string): EventQuery => ({
  events: [
    {
      eventName: 'Transfer',
      select: [{ type: 'input', inputIndex: 2, alias: 'value' }],
      filter: { rule: 'and', children: [usdc, sentBy, { fieldType: 'triggered_at', operator, value }] },
    },
  ],
});
const nextDay = new Date(Date.parse(`${newest}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
assert.ok((await multibaas.executeEventQuery(onNewestDay('greaterthanorequal', newest))).length > 0, 'date filter matched nothing');
assert.equal((await multibaas.executeEventQuery(onNewestDay('greaterthanorequal', nextDay))).length, 0, 'date filter did not exclude');
await assert.rejects(
  multibaas.executeEventQuery(onNewestDay('greaterthanorequal', `${newest}T00:00:00Z`)),
  'a timestamp with a time is now accepted; summarize_activity could use finer ranges',
);
console.log(`date filters: ok (newest transfer out on ${newest})`);

// 2. Grouped `add` totals equal the ungrouped sum over the same rows.
const grouped = await multibaas.executeEventQuery({
  events: [
    {
      eventName: 'Transfer',
      select: [
        { type: 'input', inputIndex: 1, alias: 'counterparty' },
        { type: 'input', inputIndex: 2, alias: 'total', aggregator: 'add' },
      ],
      filter: { rule: 'and', children: [usdc, sentBy] },
    },
  ],
  groupBy: 'counterparty',
});
if (rawRows.length < 50) {
  const expected = new Map<string, bigint>();
  for (const row of rawRows) {
    const key = String(row.counterparty);
    expected.set(key, (expected.get(key) ?? 0n) + BigInt(String(row.value)));
  }
  assert.deepEqual(
    new Map(grouped.map((row) => [String(row.counterparty), BigInt(String(row.total))])),
    expected,
    'grouped totals differ from the row sum',
  );
  console.log(`grouped totals: ok (${grouped.length} counterparties)`);
} else {
  console.log('grouped totals: skipped the row comparison, the account has 50 or more transfers out');
}

// 3. UserOperationEvent input 2 is the paymaster address and input 5 is actualGasCost in wei.
const operations = await multibaas.executeEventQuery({
  events: [
    {
      eventName: 'UserOperationEvent',
      select: [
        { type: 'input', inputIndex: 2, alias: 'paymaster' },
        { type: 'input', inputIndex: 5, alias: 'gas' },
      ],
      filter: {
        rule: 'and',
        children: [
          { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.entryPoint.address },
          { fieldType: 'input', inputIndex: 1, operator: 'equal', value: lower },
        ],
      },
    },
  ],
});
assert.ok(operations.length > 0, 'VERIFY_ACCOUNT has no user operations');
for (const row of operations) {
  assert.match(String(row.paymaster), /^0x[0-9a-f]{40}$/, 'paymaster is not a lowercase address');
  assert.match(String(row.gas), /^[1-9]\d*$/, 'actualGasCost is not a positive integer string');
}
console.log(`user operation inputs: ok (${operations.length} operations)`);

// 4. The tool end to end over the last 366 days.
const summary = await summarizeActivity(
  {
    account,
    context: {
      chainId: 11155111,
      now: new Date().toISOString(),
      balances: { eth: '0', usdc: '0' },
      prices: { ethUsd: null },
      vaultPosition: null,
      sponsorship: null,
      addressBook: [],
      capabilities: { send_eth: false, send_usdc: false, swap: false, vault_deposit: false, vault_withdraw: false },
    },
    multibaas,
    resolveEns: async () => null,
    quoteSwap: async () => {
      throw new Error('unused');
    },
    now: Date.now,
    resolvedNames: new Map(),
    calls: [],
    toolResults: [],
    ranges: [],
  },
  { from: day(-365), to: day(1) },
);
assert.ok(!('error' in summary), JSON.stringify(summary));
console.log(JSON.stringify(summary, null, 2));
