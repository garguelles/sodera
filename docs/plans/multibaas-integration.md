# MultiBaas and wallet agent plan

Status: approved scope, not yet implemented. Branch: `feat/curvegrid`. No Linear ticket; commits use `{type}: {description}`.

This document is one large ticket split into sub-tickets numbered 1 to 7. Section 2, an asset flows card, was removed; the other numbers are unchanged. Sections 1, 3, and 4 integrate MultiBaas. Sections 5 to 7 add the wallet agent. Each section is written so that a fresh model can implement it without the conversation that produced this plan. Read "Shared context" and "Prerequisites" before any MultiBaas section, and additionally "Wallet agent" before sections 5 to 7. Sections 3 and 4 depend on the client module and verification script delivered by section 1 and are otherwise independent of each other. Section 6 depends on section 5. Section 7 depends on section 5 and reuses section 6's intent flow; it is dropped, because the Transactions screen already shows what changed. Section 8 lets the agent answer questions about activity and depends on sections 1, 5, and 6.

Priority: sections 1 and 3 are the MultiBaas deliverable and are frontend-only. Sections 5, 6, and 7 are the agent deliverable; section 5 adds the project's only backend, the `agent/` service. Section 4 is low priority. It is retained so the design is not lost, would add its endpoints to the `agent/` service, and is not scheduled.

## Scope decisions

- MultiBaas replaces Blockscout as the activity source for USDC and account operations. Blockscout remains only for ETH received from other wallets (`app/src/wallet/received-eth-blockscout.ts`), because a native transfer into an account emits no event on a contract MultiBaas watches. Kernel v3.3 does emit `Received(sender, amount)`, but indexing it needs every wallet address linked in MultiBaas.
- MultiBaas becomes the source for USDC balance and the Chainlink ETH/USD price. The ETH native balance moves to MultiBaas only if the address endpoint proves to return it; otherwise it stays on the public RPC.
- The Graph is no longer the planned portfolio and activity source. `docs/hackathon-decisions.md` still says otherwise; editing that document is out of scope for this plan and will be handled separately.
- Morpho vault data is out of scope.
- The wallet agent is in scope as sections 5 to 7. Sections 1 to 4 must not depend on it.
- One backend only. Section 5 creates `agent/`; section 4, if built, adds its webhook and device endpoints to that same service rather than a separate app.
- Cloud Wallets, Transaction Manager, Safe Accounts, signer selector, and the Hardhat and Foundry plugins are not used. They assume EOAs or Safe multisigs. The passkey must remain Kernel's direct authority (ADR-0010).
- Market Watch is unchanged. MultiBaas has no price data.
- Outbound ETH sends get their amount and recipient from the chain: the app fetches the bundle transaction named by the `UserOperationEvent` and decodes the Kernel calls. Nothing about activity is stored on the phone. Inbound ETH from other wallets comes from Blockscout's incoming transactions and internal transactions; if Blockscout fails, the feed shows MultiBaas rows with a partial-result notice.

## Shared context

### Repository facts

- `app/` is the Expo SDK 57 app. `landing/` is the static site behind Caddy on Railway. There is no backend today. Sections 1 to 3 need none. Section 5 adds the first one as a third top-level directory, `agent/`, and section 4 (low priority) adds endpoints to it.
- Package manager is pnpm 12.3.4 (pinned via `packageManager`). Node 22 is required. Run commands from inside `app/`, `landing/`, or `agent/`; there is no root workspace.
- Tests use `jest-expo` with `@testing-library/react-native`. Run `pnpm test --runInBand` and `pnpm lint` from `app/`. Every provider in the codebase is a factory that takes injectable `storage`, `fetcher`, or `client` parameters so tests never hit the network. Tests mock native storage modules with `jest.mock('./wallet-identity-native-storage', ...)`.
- Environment: `app/.env.example` is copied to the gitignored `app/.env.local`. Node verification scripts read plain names (`SEPOLIA_RPC_URL`). The app reads only `EXPO_PUBLIC_*` names, which are embedded in the binary and must be treated as public. Follow this split for every new variable.
- Verification scripts live in `app/scripts/*.mjs`, are registered in `app/package.json` under `verify:*`, and run with `node --env-file-if-exists=.env.local`. They use `node:assert/strict` and fail loudly. Follow `verify-kernel-live.mjs` for structure.
- The persisted wallet identity is read with `readPersistedWalletIdentity(storage)` from `app/src/wallet/wallet-identity.ts`. It returns `{ credential, account, deployed }`, where `account` is the checksummed Kernel smart account address. Every provider gets the account this way.
- Native key-value storage is not generic. `modules/sodera-passkey` exposes fixed methods (`readWalletIdentityAsync`, `writeOnboardingProfileAsync`, and so on) backed by Kotlin. Adding a native method requires a rebuild with `pnpm android`.
- Screens receive providers as props and are wired in `app/src/app/*.tsx` route files. Example: `app/src/app/transactions.tsx` passes `multiBaasTransactionActivityProvider` into `TransactionsScreen`.
- The send flow (`app/src/components/send-screen.tsx`) calls `client.prepare(calls)` to get a `KernelOperationReview`, then `client.execute(review.userOperationHash)` after the passkey ceremony, and receives `KernelOperationEvidence` with `userOperationHash`, `transactionHash`, `account`, and `receipt.actualGasCostWei`. On success it calls `walletHomeLiveProvider.refresh()`.

### Pinned on-chain facts (Ethereum Sepolia, chain id 11155111)

| Item | Value | Source in repo |
| --- | --- | --- |
| USDC (Circle testnet, 6 decimals, FiatTokenProxy) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `app/src/wallet/sepolia.ts`, `docs/research/sepolia-usdc-wbtc-assets.md` |
| Chainlink ETH/USD aggregator (8 decimals) | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | `app/src/wallet/sepolia.ts`, `docs/research/PRA-221-sepolia-eth-usd-price.md` |
| ERC-4337 EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | `app/src/wallet/kernel-webauthn.ts` |
| Public execution RPC | `https://ethereum-sepolia-rpc.publicnode.com` | `app/.env.example`, `docs/research/PRA-187-sepolia-rpc-provider.md` |

EntryPoint v0.7 emits `UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)`. Input indexes are therefore: 0 `userOpHash`, 1 `sender`, 2 `paymaster`, 3 `nonce`, 4 `success`, 5 `actualGasCost`, 6 `actualGasUsed`. A sponsored operation has a non-zero `paymaster`.

ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)` has input indexes 0 `from`, 1 `to`, 2 `value`.

### MultiBaas facts (verified against docs.curvegrid.com and the TypeScript SDK on 2026-09-26)

- A deployment is bound to one network at creation and cannot be changed. It has its own domain, for example `https://abc123.multibaas.com`. REST calls go to `{domain}/api/v0/...`. Confirm the `/api/v0` prefix in the prerequisites spike; the operation pages are published under that path.
- Authentication is a bearer token: `Authorization: Bearer <api key>`. Keys are not visible after creation. A "DApp User" key is the kind designed to be embedded in client code and is limited to reads, unsigned transaction composition, and event data.
- CORS origin registration exists for browser clients. A native app sends no `Origin` header, so CORS should not apply. The prerequisites spike proves this with a non-browser request.
- Contracts deployed elsewhere are added with "Contract from Address" (ABI discovered via Blockscout, Etherscan, or Sourcify, with proxy detection) or by linking an address to an ABI already in the library. Each linked contract has a contract label and an address alias. API paths use both: `/chains/ethereum/addresses/{address-or-alias}/contracts/{label}/methods/{method}`.
- Event syncing is enabled per linked address with a starting block. Syncing starts from that block; it does not backfill earlier history. Free tier: event indexing is capped at 2 events per second and starts at most 100 blocks behind the chain head. This is a real risk for Sepolia USDC, which is a high-volume test token. See prerequisites.
- Event queries (`POST /queries?offset=&limit=`) take this body. Default `limit` is 10; pass an explicit limit.

```json
{
  "events": [
    {
      "eventName": "Transfer",
      "select": [
        { "type": "tx_hash", "alias": "txHash" },
        { "type": "block_number", "alias": "blockNumber" },
        { "type": "triggered_at", "alias": "timestamp" },
        { "type": "input", "inputIndex": 0, "alias": "from" },
        { "type": "input", "inputIndex": 1, "alias": "to" },
        { "type": "input", "inputIndex": 2, "alias": "value" }
      ],
      "filter": {
        "rule": "and",
        "children": [
          { "fieldType": "contract_address", "operator": "equal", "value": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
          { "fieldType": "input", "inputIndex": 1, "operator": "equal", "value": "0x<lowercase address>" }
        ]
      }
    }
  ],
  "orderBy": "timestamp",
  "order": "DESC"
}
```

  Enumerations from the SDK: `type` and `fieldType` accept `input`, `contract_label`, `contract_name`, `contract_address`, `contract_address_alias`, `block_number`, `triggered_at`, `event_signature`, `block_hash`, `tx_hash`, `tx_from`. `operator` accepts `equal`, `notequal`, `lessthan`, `greaterthan`, `lessthanorequal`, `greaterthanorequal`. `rule` accepts `and`, `or`. `aggregator` on a select field accepts `add`, `subtract`, `last`, `first`, `min`, `max`; when any aggregator is used, `groupBy` must name a non-aggregated alias. The response is `{ status, message, result: { rows: Record<string, unknown>[] } }`. Row values for `uint256` inputs are strings.

  Confirmed against the deployment on 2026-09-26:
  - `limit` above 50 returns HTTP 400 `invalid request`.
  - `input` filters match addresses only in lowercase; a checksummed value returns no rows. `contract_address` filters accept either case.
  - Address values come back lowercase. `block_number` comes back as a string. `bool` inputs come back as the strings `"true"` and `"false"`.
  - `triggered_at` comes back Postgres-style, `2026-09-26 06:26:00+00`, not ISO-8601.
  - `bytes32` inputs such as `userOpHash` come back as a JSON byte array string, `[138, 228, ...]`, not hex.
- Contract reads: `POST /chains/ethereum/addresses/{address}/contracts/{label}/methods/{method}` with body `{ "args": [...], "formatInts": "as_strings" }`. The response is `{ status, message, result: { kind: "MethodCallResponse", output } }`. `formatInts: "as_strings"` prevents precision loss; parse with `BigInt`. `latestRoundData` returns `output` as an array of five strings. The address lookup returns the wei balance in a `balance` string field.
- Address lookup: `GET /chains/ethereum/addresses/{address}?include=balance` (also `code`, `nonce`, `contractLookup`). The response schema is not published in the reference pages; the prerequisites spike records the actual field that holds the wei balance.
- Chain status: `GET /chains/ethereum/status`. The spike records the actual field that holds the chain id.
- Webhooks are configured in the UI with a label, URL, and one event type: `event.emitted` (any synced contract event) or `transaction.included` (Cloud Wallet transactions only, unused here). Each request carries `X-MultiBaas-Signature` and `X-MultiBaas-Timestamp`. The signature is hex `HMAC-SHA256(secret, rawBody || timestampDecimalString)`. The payload is a JSON array of `{ id, event: "event.emitted", data }` where `data` matches the list-events API shape (event name, signature, inputs, transaction and contract fields). Retry behaviour is undocumented; treat delivery as at-least-once and make the receiver idempotent on `id`. How the secret is obtained is undocumented; the prerequisites step records where the UI shows it.
- The reference implementation is Curvegrid's Matsuri sample app: a frontend-only React app that calls MultiBaas with a DApp User key, computes balances from Transfer events with event queries, and reads contract state with the method-call endpoint. Sodera follows the same shape but uses `fetch` rather than the axios-based SDK, to match the existing Blockscout and CoinGecko providers and to keep the fetcher injectable in tests.

## Prerequisites (human setup, then the spike)

These steps need the Curvegrid console and cannot be automated from the repo.

1. Create a MultiBaas deployment on Ethereum Sepolia. Record its domain.
2. Add USDC by address (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`). It is a `FiatTokenProxy`; confirm the discovered ABI is the implementation ABI containing `Transfer`, `balanceOf`, and `decimals`. Contract label `usdc`. Enable sync events. Starting block: the most recent block the free tier allows (100 back from head). Record the block number.
3. Add EntryPoint v0.7 by address (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`). Confirm the ABI contains `UserOperationEvent`. Enable sync events from the same starting block. The deployment's label for it is `usdc2`.
4. Add the Chainlink aggregator by address (`0x694AA1769357215DE4FAC081bf1f309aDC325306`). If ABI discovery fails on the proxy, link it to a hand-entered ABI containing only `decimals()` and `latestRoundData()`. The deployment's label for it is `ethprice`. Do not enable event sync.
5. Create a DApp User API key. Copy it immediately.
6. Watch the event indexing status for USDC for at least ten minutes. If the indexer falls behind the chain head because of the 2 events per second cap, stop and raise it: ask Curvegrid for the hackathon plan or a raised limit. Do not proceed to section 1 with a lagging indexer; the activity feed would silently miss transfers.
Aliases are not used anywhere: the console cannot rename them after linking, so the app addresses contracts by their fixed address and uses the label only for method calls. The labels live in `MULTIBAAS_CONTRACTS` in `app/src/wallet/multibaas.ts`.
7. Populate `app/.env.local` with the four variables listed below, and run `pnpm verify:multibaas` from `app/` once section 1 step 1.1 has landed. The verification script is the acceptance gate for this setup.

Variables added to `app/.env.example` by section 1 (values empty in the example, real values only in `.env.local`):

```
# Node verification settings.
MULTIBAAS_BASE_URL=
MULTIBAAS_API_KEY=

# Mobile settings are embedded in the app and must be treated as public.
EXPO_PUBLIC_MULTIBAAS_BASE_URL=
EXPO_PUBLIC_MULTIBAAS_API_KEY=
```

`MULTIBAAS_BASE_URL` is the deployment domain without a trailing slash and without `/api/v0`. The client module appends the prefix.

## Section 1: Activity feed from event queries

### Goal

Replace the Blockscout activity provider with a MultiBaas provider built on three event queries, extend the activity item model so smart-account operations appear, and decode ETH sends from their transactions so they show amount and recipient.

### Outcome

The Transactions screen lists, newest first: USDC transfers in and out, and every user operation the account executed with success flag, sponsorship, and gas cost. USDC sends merge with their operation into one row. ETH sends show amount and recipient decoded from the chain. ETH received from other wallets comes from Blockscout; nothing else does.

### Files

Create:
- `app/src/wallet/multibaas.ts` — client module: config, request helper, event-query and method-call helpers, contract address and label constants.
- `app/src/wallet/multibaas.test.ts`
- `app/src/wallet/transaction-activity-multibaas.ts` — the provider.
- `app/src/wallet/transaction-activity-multibaas.test.ts`
- `app/src/wallet/user-operation-calls.ts` — decodes ETH sends from a bundle transaction.
- `app/src/wallet/user-operation-calls.test.ts` and `user-operation-calls-fixtures.ts`
- `app/scripts/verify-multibaas.mjs` — verification script.
- `app/src/wallet/received-eth-blockscout.ts` and its test — ETH received from other wallets.

Modify:
- `app/src/wallet/transaction-activity.ts` — item model and `source` union.
- `app/src/components/transactions-screen.tsx` and its test — render operation rows, update copy.
- `app/src/app/transactions.tsx` — wire the new provider.
- `app/package.json` — add `verify:multibaas`.
- `app/.env.example`, `app/README.md` — new variables and the verification command.

Delete:
- `app/src/wallet/transaction-activity-blockscout.ts`
- `app/src/wallet/transaction-activity-blockscout.test.ts`

### Steps

**1.1 Client module and verification script.**

`app/src/wallet/multibaas.ts` exports:

```ts
export const MULTIBAAS_API_PREFIX = '/api/v0';
export const MULTIBAAS_CONTRACTS = Object.freeze({ // { address, label } per contract; replaces aliases
  usdc: 'usdc',
  entryPoint: 'entrypoint_v07',
  ethUsdFeed: 'eth_usd_feed',
});
export type MultiBaasConfig = { baseUrl: string; apiKey: string };
export function readMultiBaasConfigFromEnv(): MultiBaasConfig; // throws a clear error naming the missing EXPO_PUBLIC_ variable
export type MultiBaasClient = {
  executeEventQuery(query: EventQuery, options?: { offset?: number; limit?: number }): Promise<Record<string, unknown>[]>;
  callMethod(addressOrAlias: string, label: string, method: string, args: readonly unknown[]): Promise<unknown>;
  getAddress(address: Address, include: readonly ('balance' | 'nonce' | 'code')[]): Promise<Record<string, unknown>>;
  getChainStatus(): Promise<Record<string, unknown>>;
};
export function createMultiBaasClient({ config, fetcher = fetch }: { config: MultiBaasConfig; fetcher?: typeof fetch }): MultiBaasClient;
```

Also export the `EventQuery`, `EventQueryEvent`, `EventQueryField`, and `EventQueryFilter` types, written by hand from the enumerations in Shared context. Do not add the `@curvegrid/multibaas-sdk` package.

Request rules: send `Authorization: Bearer`, `accept: application/json`, and `content-type: application/json` on POSTs. Treat a thrown fetch as "MultiBaas could not be reached", a non-2xx as `MultiBaas returned HTTP {status}`, and a body without the expected `result` shape as "MultiBaas returned invalid data". These message conventions match the Blockscout provider being removed, and the screens display them verbatim.

`callMethod` always sends `formatInts: 'as_strings'` and returns `result.output`. It throws if `result.kind` is present and is not `MethodCallResponse`.

`app/scripts/verify-multibaas.mjs` reads `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY`, then asserts in order:
1. `GET /chains/ethereum/status` succeeds and reports chain id 11155111. Print the whole `result` once so the field name is recorded.
2. Each pinned contract is linked under its label in `MULTIBAAS_CONTRACTS`.
3. `callMethod('usdc', 'usdc', 'decimals', [])` returns `"6"`.
4. `callMethod('eth_usd_feed', 'eth_usd_feed', 'latestRoundData', [])` returns five values; print them so the tuple shape is recorded.
5. `GET /chains/ethereum/addresses/{account}?include=balance` for an account passed as `VERIFY_ACCOUNT` (default: the pinned USDC address, which holds ETH on Sepolia). Print `result` so the balance field name is recorded, and assert the value parses as a `BigInt`.
6. An event query over `Transfer` filtered by the USDC `contract_address` with `limit=5` returns at least one row with `txHash`, `blockNumber`, `timestamp`, `from`, `to`, `value` aliases populated.
7. The same query with an added `input` filter on a mixed-case sender address returns rows in lowercase form. Only lowercase matches, so the provider sends lowercase.
8. An event query over `UserOperationEvent` filtered by the EntryPoint `contract_address` with `limit=5` returns rows with input aliases 0 through 6 populated.
9. The request in step 6 sent from Node with no `Origin` header succeeds, which is the CORS proof.

Register it as `"verify:multibaas": "node --env-file-if-exists=.env.local ./scripts/verify-multibaas.mjs"`. Apply the findings from steps 1, 4, 5, 7, and 9 to the constants in `multibaas.ts`, with a short comment beside each, if any assumed field name was wrong.

**1.2 Activity item model.**

In `app/src/wallet/transaction-activity.ts`, replace the flat `TransactionActivityItem` with a discriminated union and change `source`:

```ts
export type TransactionActivityTransfer = {
  kind: 'transfer';
  id: string;
  transactionHash: Hash;
  direction: 'sent' | 'received';
  asset: 'ETH' | 'USDC';
  amount: string;            // decimal string, no unit
  counterparty: Address;
  timestamp: string;         // ISO-8601
  blockNumber: number;
  operation: { userOperationHash: Hash; success: boolean; sponsored: boolean; actualGasCostWei: string } | null;
};
export type TransactionActivityOperation = {
  kind: 'operation';
  id: string;
  transactionHash: Hash;
  userOperationHash: Hash;
  success: boolean;
  sponsored: boolean;
  actualGasCostWei: string;
  timestamp: string;
  blockNumber: number;
};
export type TransactionActivityItem = TransactionActivityTransfer | TransactionActivityOperation;
export type TransactionActivityProvider = {
  source: 'multibaas' | 'fixture';
  load(): Promise<TransactionActivityResult>;
  subscribeToChanges(listener: () => void): () => void;
};
```

`TransactionActivityResult` keeps its three statuses. `partial` is used when rows were skipped as malformed, with the same message wording as today.

**1.3 ETH sends from the chain.**

Native ETH transfers emit no events, so MultiBaas sees only the `UserOperationEvent`. The operation query also selects `nonce` (input 3). For each operation whose transaction has no USDC transfer row, the provider fetches the transaction over the public Sepolia RPC and decodes it in `app/src/wallet/user-operation-calls.ts`: decode `handleOps` with the EntryPoint v0.7 ABI, find the operation with the account as sender and the event's nonce, decode Kernel `execute(bytes32 mode, bytes executionCalldata)`, and read the target and value of each call. Call type `0x00` is packed `target(20) ++ value(32) ++ data`; `0x01` is an ABI-encoded `(address,uint256,bytes)[]`. Calls with a non-zero value become ETH sends. A failed lookup or undecodable transaction leaves the row as a plain operation. Nothing is persisted on the phone. Fixtures use ZeroDev's own `encodeCallDataEpV07` so tests prove the decoder reads what the wallet writes.

**1.4 Provider.**

`createMultiBaasTransactionActivityProvider({ storage = walletIdentityNativeStorage, client = createMultiBaasClient({ config: readMultiBaasConfigFromEnv() }) lazily, transactionReader = public Sepolia client lazily, limit = 50 })` in `app/src/wallet/transaction-activity-multibaas.ts`. `source: 'multibaas'`. Same `subscribeToChanges` (AppState active) and `refresh()` as the current providers.

`load()`:
1. Read the account.
2. Run three requests with `Promise.all`:
   - USDC sent: `Transfer`, filter `and(contract_address == USDC, input[0] == lowercase account)`, select txHash, blockNumber, timestamp, from, to, value; `orderBy: 'timestamp', order: 'DESC'`, `limit`.
   - USDC received: same with `input[1] == account`.
   - Operations: `UserOperationEvent`, filter `and(contract_address == EntryPoint, input[1] == lowercase account)`, select txHash, blockNumber, timestamp, userOpHash (0), paymaster (2), success (4), actualGasCost (5), actualGasUsed (6); same ordering and limit.
3. Decode ETH sends for operations that no USDC transfer explains (see 1.3).
4. Normalise with an exported pure function `normalizeMultiBaasActivity({ account, usdcSent, usdcReceived, operations, ethTransfers })` returning `{ items, skippedCount }`, so tests cover it without the client:
   - Validate every row: `txHash` is a hash, `blockNumber` is a safe non-negative integer (rows may deliver it as a string; accept both), `timestamp` parses, addresses pass `isAddress`, `value` and gas fields parse as `BigInt`, `success` is boolean or the strings `"true"`/`"false"`. Malformed rows increment `skippedCount` and are dropped.
   - USDC rows become `transfer` items with `asset: 'USDC'`, `amount: formatUnits(value, 6)`, `counterparty` checksummed, `id: erc20:{txHash}:{direction}:{from}:{to}:{value}` (there is no log index in the query output; include enough fields to be unique), `operation: null` for now. Drop zero-value rows and rows where from equals to.
   - Operation rows become `operation` items: `sponsored = paymaster !== zeroAddress`, `id: userop:{userOpHash}`.
   - Merge: for each operation item, if a USDC transfer item shares its `transactionHash`, set that transfer's `operation` field and drop the standalone operation item. If instead decoded ETH sends exist for its `userOperationHash`, replace the operation item with one `transfer` item per send `{ asset: 'ETH', direction: 'sent', amount: formatEther(valueWei), counterparty: to, operation: {...}, id: eth:{userOpHash}:{index} }` using the row's timestamp and block. Otherwise keep the operation item.
   - Sort newest first by timestamp, then blockNumber, then id, matching the current comparator.
5. Return `ready`, `partial`, or `empty` exactly as the Blockscout provider does.

Export `multiBaasTransactionActivityProvider = createMultiBaasTransactionActivityProvider()` and wire it in `app/src/app/transactions.tsx`.

**1.5 Transactions screen.**

- Subtitle copy: "Latest USDC transfers and smart account operations indexed by MultiBaas." Empty-state copy: "Transfers and operations will appear here once MultiBaas indexes them."
- `TransactionRow` handles both kinds. Transfer rows render as today, plus a small secondary line when `operation` is set: "Sponsored · gas 0.000012 ETH" or "Self-funded · gas ..." and "Failed" in the warning colour when `success` is false. Operation rows render title "Account operation", the secondary line above, a neutral icon, and no amount column. Accessibility labels must describe the row fully, since tests select by label.
- Keep `testID="transactions-list"` and the horizontal padding assertions intact.

**1.6 Cleanup.**

Delete the Blockscout provider and test. The only Blockscout use left under `app/src` is the received ETH reader. Update `app/README.md` with the new environment variables and `pnpm verify:multibaas`. Do not touch the `docs/hackathon-decisions.md` Graph statements.

### Tests

- `multibaas.test.ts`: request headers and URL composition for each helper; error mapping for thrown fetch, non-2xx, and invalid body; `formatInts` always sent; `readMultiBaasConfigFromEnv` names the missing variable.
- `transaction-activity-multibaas.test.ts`: `normalizeMultiBaasActivity` covers USDC in and out, a USDC send merged with its operation, an ETH send decoded from its transaction, a standalone failed self-funded operation, malformed rows counted as skipped, zero-value and self-transfer rows dropped, and ordering. A provider-level test with a fake client asserts the three query bodies (contract addresses, filter shape, input indexes, ordering, limit) and the `empty` result.
- `user-operation-calls.test.ts`: single call, batch with mixed calls, matching sender and nonce in a shared bundle, no-ETH operation, undecodable input.
- `transactions-screen.test.tsx`: update fixtures to the new item shapes; add a test for an operation row and a failed row.

### Acceptance criteria

- `pnpm verify:multibaas` passes against the real deployment and its findings are applied in `multibaas.ts`.
- `pnpm lint` and `pnpm test --runInBand` pass.
- On a device with a deployed account: a USDC send made in the app appears as one row with the sponsored badge; the same operation is not duplicated; an ETH send appears with amount and recipient; a USDC transfer sent to the account from an external wallet appears as received.
- Blockscout is used under `app/src` only for received ETH.

## Section 3: Token and price reads through the contract-call API

### Goal

Move the USDC balance and the Chainlink ETH/USD read from the public RPC to MultiBaas, so the app depends on one keyed service for token and activity data. The ETH native balance moves too: the address endpoint returns it for any address, matching the RPC to the wei.

### Dependencies

Section 1 step 1.1 and the recorded answers to verification steps 1, 4, and 5.

### Files

Create:
- `app/src/wallet/multibaas-balance-client.ts` — an implementation of the existing `SepoliaBalanceClient` interface.
- `app/src/wallet/multibaas-balance-client.test.ts`

Modify:
- `app/src/wallet/wallet-home-live.ts` — export the `SepoliaBalanceClient` type, and make the default client the MultiBaas one.
- `app/src/wallet/wallet-home-live.test.ts` — unchanged expectations, since the client is injected; add one test that the default path constructs the MultiBaas client.

### Design

`wallet-home-live.ts` already isolates chain access behind `SepoliaBalanceClient` with `getChainId`, `getBalance`, and `readContract`. Keep that interface and the provider logic untouched, including the Chainlink staleness rules (`ETH_USD_MAX_AGE_SECONDS`, future tolerance, zero fallback). Only the default client changes.

`createMultiBaasBalanceClient({ client })` returns a `SepoliaBalanceClient`:
- `getChainId()`: `client.getChainStatus()` and read its `chainID` field, confirmed against the deployment. Return it as a number.
- `getBalance({ address })`: call `client.getAddress(address, ['balance'])` and `BigInt` its `balance` string.
- `readContract({ address, functionName, args })`: map the pinned address to its label from `MULTIBAAS_CONTRACTS` (`SEPOLIA_USDC_ADDRESS` to `usdc`, `SEPOLIA_ETH_USD_FEED_ADDRESS` to `ethprice`); throw for any other address. `balanceOf` returns `BigInt(output)`. `decimals` returns `Number(output)`. `latestRoundData` returns the five-element tuple of `BigInt`s in the order `roundId, answer, startedAt, updatedAt, answeredInRound`, converting from the confirmed array of five strings. The provider's `isChainlinkRoundData` guard requires exactly that tuple.

Keep the `abi` parameter in the interface for compatibility; the MultiBaas client ignores it.

The existing `provider.load()` check that the chain id equals Sepolia stays and now guards against pointing the app at a MultiBaas deployment on the wrong network.

Do not change the kernel execution client. It keeps using the RPC and bundler URLs from `PRA-187`.

### Tests

- `multibaas-balance-client.test.ts`: URL and body for each call, `BigInt` conversion, tuple ordering for `latestRoundData` in both recorded shapes, rejection of unknown addresses, and the ETH balance path that was chosen.
- Existing `wallet-home-live.test.ts` keeps passing with its injected mock client.

### Acceptance criteria

- Wallet home shows the same USDC balance and USD total as before the change on the same account.
- With the MultiBaas variables removed from `.env.local`, wallet home shows a visible error naming the missing variable instead of silently using the RPC.
- `pnpm lint` and `pnpm test --runInBand` pass.

## Section 4: Received-payment notifications (low priority)

Not scheduled. It requires a backend because MultiBaas webhooks need an always-reachable URL and the HMAC secret cannot be embedded in the app. That backend is the `agent/` service from section 5; this section adds endpoints to it. Keep it out of estimates until sections 1 to 3 and 5 are done and accepted.

### Goal

Notify the phone when USDC arrives at the account. MultiBaas delivers an `event.emitted` webhook for every synced USDC `Transfer`; a small service on Railway verifies the signature, matches the recipient against registered devices, and sends a push through Expo's push service. Tapping the notification opens the Transactions screen.

### Dependencies

Section 5 deployed. Section 1 for the activity feed the notification links to.

### Constraints

- ADR-0007 says the core wallet must not require Google services. Expo push on Android rides on Firebase Cloud Messaging. Notifications are therefore optional: the app must work fully when permission is denied, when the token cannot be obtained, or when the service is unreachable. Nothing in the wallet, signing, or onboarding path may depend on this section.
- The service holds no keys that can move assets. It holds the webhook secret and, optionally, a MultiBaas key. It never sees a passkey or a user operation.

### Files

Add to the `agent/` service from section 5:
- `agent/package.json` — add the `expo-server-sdk` dependency.
- `agent/src/server.ts` — register `POST /devices` and `POST /webhooks/multibaas` beside the agent routes.
- `agent/src/notify/webhook.ts` — signature verification and event filtering (pure functions).
- `agent/src/notify/devices.ts` — device registry.
- `agent/src/notify/push.ts` — Expo push sending.
- `agent/src/notify/*.test.ts`
- `agent/README.md` — add the notification environment, the MultiBaas webhook setup steps, and the manual smoke test.

Modify in `app/`:
- `app/app.json` — add the `expo-notifications` plugin with `defaultChannel: "payments"` and the app icon colour.
- `app/package.json` — `expo-notifications` via `pnpm exec expo install expo-notifications`.
- `app/.env.example` — no new variable; the app reuses `EXPO_PUBLIC_AGENT_BASE_URL` from section 6.
- New `app/src/notifications/push-registration.ts` and test — permission, channel, token, registration call.
- `app/src/components/wallet-home.tsx` or the wallet route — trigger registration once after the identity is ready.
- `app/src/app/_layout.tsx` — notification response listener that routes to `/transactions`.
- Root `README.md` — no change; section 5 already lists `agent/`.

### Service design

Environment (added to `agent/.env.example`; `PORT` already exists there):

```
MULTIBAAS_WEBHOOK_SECRET=
USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
DEVICE_STORE_PATH=/data/devices.json
WEBHOOK_MAX_SKEW_SECONDS=300
```

Endpoints:
- `GET /healthz` returns `{ ok: true }`.
- `POST /devices` body `{ account, expoPushToken }`. Validate `account` with a strict address regex and checksum it; validate the token with `Expo.isExpoPushToken`. Upsert into the registry keyed by token, so one account can have several devices and a reinstall replaces its old token. Returns 204. No authentication for the hackathon; the only effect of abuse is unwanted notifications to a token the caller already owns. Rate limit by IP to 10 per minute in memory.
- `POST /webhooks/multibaas`. Read the raw body bytes before parsing. Verify `X-MultiBaas-Signature` equals hex `HMAC-SHA256(secret, rawBody + X-MultiBaas-Timestamp)` using `crypto.timingSafeEqual`, and that the timestamp is within `WEBHOOK_MAX_SKEW_SECONDS` of now. Respond 401 on failure. On success respond 200 immediately and process asynchronously, so slow pushes never cause MultiBaas to consider the delivery failed.

Processing (`notify/webhook.ts`, pure): for each element of the payload array with `event === 'event.emitted'`, keep it when the event name is `Transfer`, the contract address equals `USDC_ADDRESS` case-insensitively, and the `to` input matches a registered account. Dedupe on the element `id` with an in-memory set of the last 1,000 ids, because retry behaviour is undocumented. Produce `{ account, from, valueMicro, transactionHash }`. The exact location of the event name, inputs, contract address, and transaction hash inside `data` follows the list-events API shape; the implementer must capture one real payload during setup (step 4 of the setup list below) and pin the parsing to it with a test fixture.

Push (`notify/push.ts`): title "USDC received", body `+{formatUnits(valueMicro, 6)} USDC from {shortened from}`, `channelId: 'payments'`, `data: { transactionHash, route: '/transactions' }`. Use `expo-server-sdk` chunking. Fetch receipts after 15 minutes and drop tokens whose receipt reports `DeviceNotRegistered`.

Registry (`notify/devices.ts`): in-memory `Map` loaded from and written to `DEVICE_STORE_PATH` as JSON. On Railway, mount a volume at `/data`. If the file is unwritable, log once and continue in memory; the hackathon accepts loss on restart.

### App design

`push-registration.ts` exports `registerForPaymentNotifications({ account, baseUrl, notifications = Notifications, fetcher = fetch })`:
1. On Android, create channel `payments` with `AndroidImportance.HIGH`.
2. `getPermissionsAsync`; if not granted, `requestPermissionsAsync`. If still not granted, return `{ status: 'denied' }` and do nothing else.
3. `getExpoPushTokenAsync({ projectId })` with the EAS project id from `Constants.expoConfig.extra.eas.projectId` (it is `528384a6-a965-47e1-baaf-c1ef3fdc1ccc` in `app.json`). Any throw returns `{ status: 'unavailable', message }`.
4. `POST {baseUrl}/devices`. Any failure returns `{ status: 'unavailable', message }`.
5. Return `{ status: 'registered' }`.

Trigger it once per app process from the wallet route after the identity is ready, never from onboarding, and never block rendering on it. If `EXPO_PUBLIC_AGENT_BASE_URL` is unset, skip silently; this keeps the app buildable without the service.

In `_layout.tsx`, add `Notifications.addNotificationResponseReceivedListener` and, when `response.notification.request.content.data.route` is `/transactions`, `router.push('/transactions')`. Also handle the cold-start case with `getLastNotificationResponseAsync`.

### Setup steps (human)

1. On the section 5 Railway service, mount a volume at `/data` and add the environment variables above. The public domain already exists.
2. Android push credentials: Expo's push service requires FCM V1 credentials for Android. Create a Firebase project for `xyz.sodera.app`, download `google-services.json` into `app/`, reference it as `android.googleServicesFile` in `app.json`, and upload the FCM V1 service account key with `eas credentials`.
3. In MultiBaas, create a webhook: label `sodera-notify`, URL `https://<service domain>/webhooks/multibaas`, event type `event.emitted`. Record where the UI presents the HMAC secret and set it as `MULTIBAAS_WEBHOOK_SECRET`.
4. Send a small USDC transfer to a test account and capture the exact webhook payload from the service logs. Commit it, with addresses redacted to test values, as `agent/src/notify/__fixtures__/event-emitted.json`.

### Tests

- `notify/webhook.test.ts`: signature accept and reject, timestamp skew reject, filtering by event name, contract, and recipient against the fixture, dedupe on id.
- `notify/devices.test.ts`: upsert by token, multiple devices per account, persistence round trip, unwritable path tolerated.
- `notify/push.test.ts`: message shape and chunking with a mocked Expo client; token pruning on `DeviceNotRegistered`.
- `push-registration.test.ts` in the app: denied permission short-circuits, token failure returns unavailable, success posts the right body, unset base URL skips.
- A manual end-to-end check is recorded in `agent/README.md`: `curl` the webhook with a signed fixture and observe the push arrive.

### Acceptance criteria

- With the service deployed and a device registered, a USDC transfer to the account produces a notification within one minute of block inclusion. Tapping it opens the Transactions screen with the transfer listed.
- Denying notification permission leaves every wallet flow working.
- A webhook request with a wrong signature is rejected with 401 and nothing is sent.
- `pnpm test` passes in `agent/`; `pnpm lint` and `pnpm test --runInBand` pass in `app/`.

## Wallet agent (sections 5 to 7)

The agent is designed against the finished hackathon app as defined by the specs in `docs/hackathon-specs.md`, not against the current tree. Other people are building the features it relies on. The "Seams" subsection names each interface the agent expects and how to stub it until the real one lands.

### What the agent is

The user types a sentence on the assistant page, opened from the launcher header, for example "send 5 usdc to alice and put the rest in the vault". A backend service asks Claude to turn that sentence into a structured plan of catalogued actions, using read-only tools for balances, activity, name resolution, and quotes. The app validates the plan against a deterministic policy, encodes each action into Kernel calls, and hands them to the existing review screen and passkey ceremony as one batched operation. The model never signs, never produces calldata, and never chooses a contract address.

This is Curvegrid's "separate intent from authority" pattern: intent (sentence) to agent (proposal) to policy (deterministic checks) to human approval (review screen) to secure signer (passkey and Kernel) to Ethereum. The app already implements the last three stages for manual sends; the agent adds the first two in front of them.

The digest card is the reverse direction: the wallet writes two sentences about what changed and suggests one action, which enters the same flow pre-filled.

### Agent shared context

#### Agent repository facts

Everything in the MultiBaas "Shared context" above applies. In addition:

- The service lives in `agent/`, a third isolated top-level app deployed on Railway. Section 4, if built, adds its webhook and device endpoints to this service.
- Execution path in the app: `createExecutionClient` returns a `KernelPasskeyExecutionClient` with `prepare(calls)` returning a `KernelOperationReview` pinned to a user operation hash, and `execute(confirmedHash)` that refuses if anything drifted. `KernelExecutionCall` is `{ to: Address; value: bigint; data: Hex }`. Kernel batches multiple calls into one operation, so one passkey ceremony covers a whole plan. See `app/src/wallet/kernel-passkey-execution.ts` and the flow in `app/src/components/send-screen.tsx`.
- The review contract in `docs/sodera.md` sections 16 and 17: a human-readable summary before signing, simulation before signing, failed simulation blocks the path, and the passkey prompt appears only after explicit confirmation. The agent must not weaken any of these.
- Sponsorship policy in `docs/hackathon-decisions.md`: a shared allowance of 10 sponsored operations per wallet per day, reset 00:00 UTC, enforced by the sponsorship service, with remaining-allowance UI required to use authoritative service data. The agent reads this figure; it does not compute it.
- Section 45 of `docs/sodera.md` describes a future session-key model and states session keys are not part of the MVP. The agent therefore never holds delegated authority. Every plan is passkey-approved.

#### Claude API facts (from the `claude-api` skill reference, TypeScript SDK)

- Package `@anthropic-ai/sdk`; client `new Anthropic()` reads `ANTHROPIC_API_KEY` from the environment.
- Model `claude-sonnet-5` ($2 / $10 per million input / output tokens), set through `AGENT_MODEL`. Chosen over `claude-opus-5` ($5 / $25) for cost: a plan is a short structured-output task, and Sonnet 5 supports adaptive thinking, `output_config.effort` (`low` to `max`), structured outputs, and the tool runner. `claude-haiku-4-5` is cheaper but has no effort control. Thinking runs adaptively when the `thinking` parameter is omitted.
- Tool runner: `betaZodTool({ name, description, inputSchema, run })` from `@anthropic-ai/sdk/helpers/beta/zod`, passed to `client.beta.messages.toolRunner({ model, max_tokens, tools, messages, ... })`. The runner executes tools and loops until the model stops calling them. Cap with `max_iterations`.
- Structured outputs: `toolRunner` accepts `output_config.format` and returns a plain `BetaMessage`, so the service parses the final text block with `AgentOutputSchema` itself (confirmed live on 2026-09-26). Do not use `betaZodOutputFormat` for `AgentOutputSchema`: its converter reuses sub-schemas through `$defs`, which the API rejects inside `anyOf` (`output_config.format.schema: For 'anyOf', '$defs' is not supported`), and it demotes `const` and `enum` to descriptions. The service sends the hand-written schema in `agent/src/output-format.ts` instead; a test keeps it in agreement with the shared vectors.
- Refusals: a response can return `stop_reason: "refusal"` with HTTP 200. Always check `stop_reason` before reading content. Server-side fallbacks (`server-side-fallback-2026-07-01`) apply to the Opus 5 and Fable models; add them only if `AGENT_MODEL` is switched to one of those.
- Errors are typed: `Anthropic.RateLimitError`, `Anthropic.AuthenticationError`, `Anthropic.BadRequestError`, `Anthropic.APIError`. Catch most specific first.
- Prompt caching is prefix-based over `tools` then `system` then `messages`. Keep the tool list and system prompt byte-stable and put `cache_control: { type: "ephemeral" }` on the system block. Volatile data (the account snapshot) goes in the user message.
- Prefill of assistant messages is not supported on this model family. Use the structured output format, not prefill, to force JSON.
- Parse tool inputs with `JSON.parse` semantics only, never string matching.

### Design decisions

1. **The model chooses actions and parameters, never calldata.** The action catalog is fixed. The app encodes each action deterministically. A model output that is not a catalogued action fails schema validation before any code looks at it.
2. **Policy is deterministic and duplicated.** The service checks the plan before returning it; the app re-checks on receipt with identical code and shared test vectors. A compromised service cannot widen what the app will encode.
3. **Amounts are human decimal strings.** The model writes `"5"` or `"0.01"`, with the asset implied by the action. Policy converts with `parseUnits` and rejects more decimals than the asset has. Base-unit integers are error-prone for a language model.
4. **Follow-ups are supported.** The service keeps the last five exchanges per account in memory, dropped on restart, so "make it 10 instead" works. Tool calls and results are not kept in the transcript, only the user sentences and the final plan JSON.
5. **Authority-changing operations are excluded.** Recovery enrolment, primary passkey replacement, and username registration are never catalogued. They change who controls the wallet, not what it holds, and keep their own screens and review.
6. **Every plan is passkey-approved.** No session keys, no delegated signer, no auto-execution. This follows the signing decisions and section 45 of the spec.
7. **The app is the authority on its own state.** The app sends a context snapshot (balances, USD values, vault position, sponsorship allowance, address book) with every request. The service's tools cover only what the app cannot cheaply provide: activity history, name resolution, swap quotes, and price.
8. **Clarification beats guessing.** When the sentence is ambiguous (no amount, unknown recipient, unknown asset), the model returns a clarification question instead of a plan. The plan card shows the question and keeps the sentence in the field.
9. **Failure falls back to manual.** Any error in the agent path shows a short message and a button to the relevant manual screen. The agent never becomes a dependency for sending money.

### Seams (interfaces expected from other tickets)

Each seam is a TypeScript module path and signature the agent code imports. If the real module does not exist when a section starts, create the module at that path exporting the signature with a stub that throws `new Error('Not implemented: <ticket>')`, and gate the corresponding catalogue action off in policy (`actionEnabled`) until the real implementation lands. Never fake a success.

| Seam | Path and signature | Owning ticket | Stub behaviour |
| --- | --- | --- | --- |
| USDC transfer encoder | `app/src/wallet/usdc-transfer.ts`: `encodeUsdcTransfer({ to: Address; amountMicro: bigint }): KernelExecutionCall` | PRA-198, PRA-196 | Implementable now: `viem.encodeFunctionData` for ERC-20 `transfer(address,uint256)` against the pinned USDC address. Build it if absent. |
| ENS resolution | `app/src/identity/resolve-recipient.ts`: `resolveRecipient(input: string): Promise<{ address: Address; name: string \| null }>` | PRA-200, PRA-209 | Accept checksummed or lowercase addresses; throw for names. Names then come only from the address book. Superseded by section 9: Dera resolves names with `resolveSepoliaRecipient` in `app/src/wallet/send-transfer.ts`. |
| Swap quote and encoder (landed as `app/src/wallet/uniswap-quote.ts` `quoteSwap` and `uniswap-swap-calls.ts` `buildSwapCalls`) | `app/src/swap/uniswap.ts`: `quoteSwap({ direction: 'eth_to_usdc' \| 'usdc_to_eth'; amountIn: bigint }): Promise<SwapQuote>` and `encodeSwap(quote: SwapQuote, { recipient: Address }): KernelExecutionCall[]` where `SwapQuote = { direction; amountIn: bigint; amountOut: bigint; minimumAmountOut: bigint; slippageBps: number; expiresAt: string; route: unknown }` | PRA-212, PRA-213 | Throw. `swap` action disabled. |
| Vault encoders and position | `app/src/earn/morpho-vault.ts`: `encodeVaultDeposit({ amountMicro: bigint; owner: Address }): KernelExecutionCall[]`, `encodeVaultWithdraw({ amountMicro: bigint \| 'all'; owner: Address }): KernelExecutionCall[]`, `readVaultPosition(account: Address): Promise<{ assetsMicro: bigint; sharesRaw: bigint }>` | PRA-216, PRA-217, PRA-218, PRA-222 | Throw. Vault actions disabled. Position reads return `null` in the context snapshot. |
| Sponsorship allowance | `app/src/wallet/sponsorship.ts`: `readSponsorshipAllowance(account: Address): Promise<{ remaining: number; limit: number; resetsAt: string } \| null>` | PRA-195, PRA-199 | Return `null`. The plan card omits the allowance line and the policy skips the allowance check. |
| Shared operation review | `app/src/components/operation-review.tsx`: a screen or component that takes `calls: KernelExecutionCall[]`, `lines: ReviewLine[]`, and callbacks, runs `prepare`, shows the review, runs `execute` after confirmation | PRA-198 | Section 6 builds `PlanReviewScreen` by extracting the review and execute steps from `send-screen.tsx`. If PRA-198 lands a shared component first, use it and delete the extraction. |
| Live activity | `app/src/wallet/transaction-activity-multibaas.ts` and the service-side event queries | Section 1 | The service's `get_activity` tool queries MultiBaas directly with the same query shapes. No app dependency. |

The service does not import app code. The seam table tells the service author which MultiBaas queries and RPC reads to reuse, and tells the app author what to encode.

### Action catalogue and proposal schema

The schema is the contract between service and app. Define it once in each app as Zod (`agent/src/schema.ts` and `app/src/agent/schema.ts`) and keep them byte-identical; a test in each app loads `docs/plans/agent-schema-vectors.json` (created by section 5) and asserts that every vector parses or fails as recorded.

```ts
import { z } from 'zod';

const decimalAmount = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/);
const recipient = z.object({
  kind: z.enum(['address', 'name']),
  value: z.string().min(1).max(255),
});

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_eth'), recipient, amount: decimalAmount }),
  z.object({ type: z.literal('send_usdc'), recipient, amount: decimalAmount }),
  z.object({
    type: z.literal('swap'),
    direction: z.enum(['eth_to_usdc', 'usdc_to_eth']),
    amountIn: decimalAmount,
  }),
  z.object({ type: z.literal('vault_deposit'), amount: decimalAmount }),
  z.object({ type: z.literal('vault_withdraw'), amount: z.union([decimalAmount, z.literal('all')]) }),
]);

export const ProposalSchema = z.object({
  kind: z.literal('plan'),
  summary: z.string().min(1).max(280),
  actions: z.array(ActionSchema).min(1).max(4),
  assumptions: z.array(z.string().max(160)).max(5),
});

export const ClarificationSchema = z.object({
  kind: z.literal('clarification'),
  question: z.string().min(1).max(200),
});

export const AgentOutputSchema = z.discriminatedUnion('kind', [ProposalSchema, ClarificationSchema]);
```

`vault_withdraw` with `'all'` exists because share-to-asset rounding makes "withdraw everything" impossible to express as a decimal amount reliably.

### Policy rules

Implemented identically in `agent/src/policy.ts` and `app/src/agent/policy.ts` as `evaluatePolicy(output, context): PolicyResult` where `PolicyResult` is `{ ok: true; plan: EnrichedPlan } | { ok: false; violations: Violation[] }` and `Violation = { code; actionIndex: number | null; message }`. Shared vectors live in `docs/plans/agent-policy-vectors.json` (created by section 5) and both test suites assert them.

| Code | Check | Reads | Message shown to user |
| --- | --- | --- | --- |
| `schema` | Output parses with `AgentOutputSchema` | output | "The assistant returned something the wallet cannot read." |
| `action_disabled` | `actionEnabled[type]` is true (seams that are stubbed set it false) | app capability flags | "Swaps are not available yet." (per action) |
| `too_many_actions` | `actions.length <= 4` (schema) and at most one `swap` per plan | output | "Plans are limited to four steps and one swap." |
| `recipient_unresolved` | `kind: 'address'` passes `isAddress`; `kind: 'name'` resolves through ENS, with a bare label read as `<label>.sodera.eth` (section 9). The service uses the names `resolve_name` resolved; the phone resolves them again itself | resolver | "I don't know who {name} is." |
| `recipient_self` | Resolved recipient is not the account | context.account | "That would send to yourself." |
| `amount_precision` | Decimals do not exceed 18 for ETH or 6 for USDC | output | "USDC amounts can have at most 6 decimals." |
| `amount_zero` | Amount parses to a positive integer in base units | output | "Amounts must be greater than zero." |
| `insufficient_eth` | Sum of ETH sends plus ETH swap inputs plus a reserve of 0.0005 ETH is at most the ETH balance | context.balances | "Not enough ETH. You have {balance}." |
| `insufficient_usdc` | Sum of USDC sends, USDC swap inputs, and vault deposits, evaluated in plan order with swap outputs not counted as available, is at most the USDC balance | context.balances | "Not enough USDC. You have {balance}." |
| `vault_insufficient` | Withdraw amount is at most the vault position's assets | context.vaultPosition | "The vault holds only {assets} USDC." |
| `value_cap` | Total USD value of outgoing assets is at most `PLAN_VALUE_CAP_USD` (default 250) | context.prices | "Plans above $250 need the manual screens." |
| `sponsorship` | If `context.sponsorship` is present, `remaining >= 1` | context.sponsorship | "No sponsored operations left today. Resets at {time}." |
| `no_authority_ops` | Defensive: reject any action type outside the catalogue even if a future schema adds one | output | Same as `schema` |

`EnrichedPlan` carries each action with resolved recipient address and name, base-unit amounts as `bigint`, USD estimate, and for swaps a placeholder the encoder fills after quoting. The plan card renders from `EnrichedPlan`, never from the raw model output.

## Section 5: Agent service and proposal endpoint

### Goal

A Node service that turns a sentence plus a context snapshot into a validated proposal or a clarification, keeps a short per-account transcript, and exposes a health endpoint. Deployed on Railway.

### Outcome

`POST /agent/propose` returns a policy-checked plan for "send 0.01 eth to alice" against a context whose address book contains alice, returns a clarification for "send some eth", and returns a clarification that names the balance for an amount above it. The model sees the balances and asks for a smaller amount instead of proposing a plan the policy would reject; the policy still rejects any over-balance plan that reaches it. The endpoint refuses requests without the app token and rate-limits per account.

### Files

Create the `agent/` app:
- `agent/package.json` — `@sodera/agent`, `packageManager: pnpm@12.3.4`, `engines.node >= 22.12.0`, `type: module`. Dependencies: `hono`, `@hono/node-server`, `@hono/zod-validator`, `@anthropic-ai/sdk`, `zod`, `viem`. Dev: `typescript ~6.0.3`, `@types/node`, `vitest`, `tsx`.
- `agent/pnpm-lock.yaml`, `agent/tsconfig.json`, `agent/.env.example`, `agent/.gitignore`, `agent/.dockerignore`
- `agent/Dockerfile` — `node:22-alpine`, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`, `CMD ["node", "dist/server.js"]`. Mirror `landing/Dockerfile`.
- `agent/src/server.ts` — Hono app served with `@hono/node-server`: routing, bearer auth (`hono/bearer-auth`), body limit (`hono/body-limit`), request validation (`@hono/zod-validator`), rate limit, JSON errors.
- `agent/src/schema.ts` — Zod schemas above plus `ContextSchema` and request/response schemas.
- `agent/src/policy.ts` — policy rules above.
- `agent/src/tools.ts` — `betaZodTool` definitions.
- `agent/src/propose.ts` — the Claude call.
- `agent/src/transcript.ts` — per-account memory.
- `agent/src/multibaas.ts` — minimal client mirroring `app/src/wallet/multibaas.ts` (event query and method call helpers). Copy the shapes; do not import across apps.
- `agent/src/prompts/system.md` — the system prompt, loaded at startup and cached.
- `agent/src/*.test.ts`
- `agent/README.md` — local run, environment, Railway deployment, the manual smoke test.
- `docs/plans/agent-schema-vectors.json` and `docs/plans/agent-policy-vectors.json` — shared vectors.

Modify:
- Root `README.md` — add `agent/` to the applications table.

### Environment (`agent/.env.example`)

```
PORT=8080
ANTHROPIC_API_KEY=
AGENT_APP_TOKEN=
MULTIBAAS_BASE_URL=
MULTIBAAS_API_KEY=
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PLAN_VALUE_CAP_USD=250
AGENT_MODEL=claude-sonnet-5
AGENT_EFFORT=high
```

`AGENT_APP_TOKEN` is a random string the app sends as `Authorization: Bearer`. It is embedded in the app and therefore public; it deters casual abuse only. The real cost control is the per-account rate limit and the value cap.

### Request and response

`POST /agent/propose`

```ts
type ProposeRequest = {
  account: Address;
  intent: string;               // 1..500 chars
  context: AgentContext;
  reset?: boolean;              // drop the transcript first
};

type AgentContext = {
  chainId: 11155111;
  now: string;                                          // ISO-8601 from the phone
  balances: { eth: string; usdc: string };              // decimal strings
  prices: { ethUsd: string | null };                     // decimal string
  vaultPosition: { assetsUsdc: string } | null;
  sponsorship: { remaining: number; limit: number; resetsAt: string } | null;
  addressBook: { name: string; address: Address }[];    // max 50
  capabilities: { send_eth: boolean; send_usdc: boolean; swap: boolean; vault_deposit: boolean; vault_withdraw: boolean };
};

type ProposeResponse =
  | { kind: 'plan'; summary: string; actions: Action[]; assumptions: string[]; enriched: EnrichedPlanJson }
  | { kind: 'clarification'; question: string }
  | { kind: 'rejected'; violations: Violation[]; summary: string | null }
  | { kind: 'declined'; message: string };              // model refusal
```

`enriched` is the service's `EnrichedPlan` with bigints as strings. The app re-runs policy anyway; `enriched` is a convenience for rendering and a cross-check.

### Tools (`agent/src/tools.ts`)

All read-only. Each returns a compact JSON string. Each catches its own errors and returns `{ error: string }` so the model can adapt rather than the run failing.

| Tool | Input | Backing call | Notes |
| --- | --- | --- | --- |
| `get_activity` | `{ account, limit? }` | Two MultiBaas event queries: USDC Transfer with `input[0]` or `input[1]` equal to account, and `UserOperationEvent` with `input[1]` equal to account, ordered by `triggered_at` desc, limit 20 | Same query shapes as section 1. Return rows with direction, asset, amount, counterparty, timestamp, success. |
| `resolve_name` | `{ name }` | ENS on Sepolia via viem `getEnsAddress` with `normalize` from `viem/ens`; a name without a dot is read as `<name>.sodera.eth` (section 9) | Return `{ address, name }` with the full ENS name, or `{ error: 'unknown' }`. |
| `quote_swap` | `{ direction, amountIn }` | `quoteExactInputSingle` on the Uniswap v4 Quoter for the pool pinned by PRA-212 (`agent/src/uniswap.ts`, mirroring the app's `uniswap-sdk.ts`) | Returns `{ amountIn, expectedOut, minimumOut, slippage, venue }`; the minimum uses the app's 0.5% slippage as `amountOut / 1.005`. Returns `{ error: 'swaps unavailable' }` when the request's capabilities disable swaps. The phone quotes again at review. |
| `get_eth_price` | `{}` | MultiBaas method call `eth_usd_feed.latestRoundData` with the same staleness rules as `wallet-home-live.ts` (max age 7200 seconds) | Return `{ usd, updatedAt }` or `{ error }`. |

Balances, vault position, and sponsorship come from the context snapshot in the user message. Do not add tools for them.

### The Claude call (`agent/src/propose.ts`)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { AGENT_OUTPUT_FORMAT } from './output-format.ts';

const client = new Anthropic({ timeout: 60_000, maxRetries: 2 });

export async function propose({ account, intent, context, transcript }): Promise<AgentOutput | { refused: true }> {
  const runner = client.beta.messages.toolRunner({
    model: process.env.AGENT_MODEL ?? 'claude-sonnet-5',
    max_tokens: 16000,
    max_iterations: 8,
    output_config: { effort: process.env.AGENT_EFFORT ?? 'high', format: AGENT_OUTPUT_FORMAT }, // agent/src/output-format.ts
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages: [...transcript, { role: 'user', content: renderUserMessage(intent, context) }],
  });
  const message = await runner;
  if (message.stop_reason === 'refusal') return { refused: true };
  if (message.stop_reason === 'max_tokens') throw new Error('Agent output was cut off');
  const text = message.content.find((block) => block.type === 'text');
  if (!text) throw new Error('Agent returned no text');
  return AgentOutputSchema.parse(JSON.parse(text.text));
}
```

The runner's types accept `output_config`; confirm on the first live request that the final message is schema-valid JSON. If it is not, use the fallback: declare an additional strict tool `submit_output` whose `inputSchema` is `AgentOutputSchema`, instruct the model in the system prompt to call it exactly once as its final step, capture its input in `run`, and stop the runner. Do not use `tool_choice` forcing; it is not supported on every current model and the instruction plus `strict: true` is sufficient.

Error handling in `server.ts`: `Anthropic.RateLimitError` returns 503 with a retry hint; `Anthropic.AuthenticationError` returns 500 and logs loudly; other `Anthropic.APIError` returns 502; a Zod parse failure of the model output returns `{ kind: 'rejected', violations: [{ code: 'schema', ... }] }`.

`renderUserMessage` produces a short, deterministic block: the sentence, then the context as labelled lines (balances, prices, vault, sponsorship, address book names only, capabilities). Never include the full address book addresses in the prompt; the model refers to names and the service resolves them.

### System prompt (`agent/src/prompts/system.md`)

Write it as plain instructions, roughly 40 lines, covering:
- Role: you prepare a plan for a testnet wallet; you never execute anything; a human reviews and signs.
- The catalogue with a one-line meaning for each action and the exact JSON output contract, including that amounts are decimal strings and the asset is implied by the action.
- When to return a clarification: missing amount, unknown recipient after `resolve_name` fails, unclear asset, or an intent outside the catalogue (say so plainly).
- Rules the policy will enforce, stated so the model avoids them: four actions maximum, one swap, keep a small ETH reserve, never exceed balances, respect the sponsored operation count.
- Use `resolve_name` for any recipient that is not a hex address. Use `quote_swap` before proposing a swap so the summary can state the expected output. Use `get_activity` only when the sentence refers to history ("the person I paid yesterday").
- Tone for `summary`: one or two sentences, plain, states the concrete amounts and recipients, mentions the sponsored-operation cost when known.
- Follow-up turns: the previous plan is in the transcript; apply the user's change to it rather than starting over.
- Refuse, via clarification, anything that asks for recovery, passkeys, usernames, or arbitrary contract calls.

Keep the prompt byte-stable across requests so the cache hits. Do not interpolate dates or account data into it.

### Transcript (`agent/src/transcript.ts`)

`Map<Address, MessageParam[]>` with at most five user/assistant pairs. Store the user text and the assistant's final JSON text only. Expire an account's transcript after 30 minutes of inactivity. `reset: true` clears before use. The service is single-instance for the hackathon; document that a second replica breaks follow-ups.

### Server (`agent/src/server.ts`)

- `GET /healthz` returns `{ ok: true }`.
- `POST /agent/propose` requires `Authorization: Bearer ${AGENT_APP_TOKEN}`, body at most 32 KB, JSON validated by `ProposeRequestSchema`. Rate limit 10 requests per account per minute and 60 per IP per minute in memory. On success: run `propose`, then `evaluatePolicy`, then respond with `plan`, `clarification`, `rejected`, or `declined`.
- Log one structured line per request: account (shortened), intent length, tool calls made, outcome kind, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, latency. Never log the sentence or the address book.
- Response header `x-agent-model` with `message.model` so the app can show which model served the plan.

### Tests

- `schema.test.ts`: every vector in `agent-schema-vectors.json`, plus decimal regex edge cases.
- `policy.test.ts`: every vector in `agent-policy-vectors.json`. Write the vectors to cover each rule at least once in both passing and failing form, including plan-order USDC accounting (send then deposit the remainder) and the ETH reserve.
- `propose.test.ts`: with the Anthropic client replaced by a fake that returns a canned final message, assert the message construction (system block cached, tools stable, context rendering, transcript included), refusal mapping, max_tokens mapping, and the schema-failure path. One test uses a fake that emits a `get_activity` tool call and asserts the tool result shape.
- `server.test.ts`: auth, body limits, rate limits, and the four response kinds.
- `tools.test.ts`: `resolve_name` prefers the address book, falls back to ENS, returns `unknown`; `get_eth_price` applies staleness; `quote_swap` returns unavailable without a route file.

### Deployment (human)

1. Railway service in a `sodera` project from this repository, root directory `/agent`, Dockerfile builder. Set the environment variables. Generate a public domain.
2. Create an Anthropic API key with a monthly spend limit for the hackathon and record it only in Railway.
3. Record the service domain and the app token in `app/.env.local` as `EXPO_PUBLIC_AGENT_BASE_URL` and `EXPO_PUBLIC_AGENT_APP_TOKEN`.
4. Smoke test from `agent/README.md`: `curl` the propose endpoint with a fixture context and confirm a plan, a clarification, and a rejection.

### Acceptance criteria

- The three smoke tests return the expected kinds against the deployed service.
- Repeated identical requests show non-zero `cache_read_input_tokens` in the logs from the second request on.
- A request whose intent mentions passkeys or recovery returns a clarification, never a plan.
- `pnpm test` passes in `agent/`.

## Section 6: Dera assistant page, plan card, and plan review

Status: implemented on 2026-09-26. Supersedes the earlier home-widget design (Claude Design mocks 3a, 5a to 5f), whose card states carried over.

### Goal

A sparkle button on the launcher header opens the assistant page. The assistant is called Dera, from So**dera**. The user chats with the planner: each sentence becomes a plan card, a question, or a notice. A plan is re-checked and encoded on the phone, and the review-then-passkey path executes it as one operation. A placeholder address book supplied names until section 9 replaced it with ENS resolution.

### Dependencies

Section 5 deployed. Seams from the table above, stubbed where absent.

### Files

Create:
- `app/src/agent/schema.ts`, `app/src/agent/policy.ts` — copies of `agent/src/schema.ts` and `agent/src/policy.ts`, identical apart from comments and import paths. `policy.test.ts` asserts the shared vectors and fails if either copy drifts.
- `app/src/agent/violation-copy.ts` — a short title per violation code for the blocked card.
- `app/src/agent/agent-client.ts` — `readAgentConfigFromEnv()` and `createAgentClient({ config, fetcher, timeoutMs })` with `propose(request)`. Failures throw `AgentUnavailableError` with `reason` `timeout`, `unreachable`, or `error`.
- `app/src/agent/agent-context.ts` — `loadAgentContext({ account, balanceClient, addressBook, now })` reads balances and the ETH price through the MultiBaas balance client; `AGENT_CAPABILITIES` lists the encodable actions: sends and swaps, with the vault off until PRA-216.
- `app/src/agent/plan-encoder.ts` — `encodePlan(plan, { quoteSwap, now })` returns `{ calls, lines, expiresAt }` for sends and swaps and throws `Not implemented` for the vault.
- `app/src/agent/address-book.ts` — placeholder: a fixed list parsed from `EXPO_PUBLIC_AGENT_CONTACTS` (`alice=0x…,bob=0x…`). Nothing is stored on the phone and there is no screen. Names are lowercase, unique, 1 to 32 characters; malformed pairs are skipped. Removed in section 9.
- `app/src/agent/use-agent-planner.ts` — the conversation: a list of turns (sentence plus answer), `submit`, `reset`, and `markSigned`.
- `app/src/agent/pending-plan.ts` — hands the plan and its turn id to the review route, because the plan carries bigints, and reports which turn was signed.
- `app/src/wallet/usdc-transfer.ts` — the USDC transfer seam (built).
- `app/src/identity/resolve-recipient.ts` — the ENS seam, stubbed: addresses only.
- `app/src/components/assistant-screen.tsx` and `app/src/app/assistant.tsx` — the assistant page.
- `app/src/components/intent-bar.tsx` — the composer at the bottom of the page.
- `app/src/components/plan-card.tsx` — the answer card in each state.
- `app/src/components/plan-review-screen.tsx` and `app/src/app/plan.tsx` — review and execute for a batched plan.
- Tests for each module and component.

Modify:
- `app/src/components/launcher-screen.tsx` — `onOpenAssistant` shows a sparkle button to the left of settings.
- `app/src/app/index.tsx` — passes `onOpenAssistant` when the agent is configured and the wallet account is known.
- `app/src/app/_layout.tsx` — registers `assistant` and `plan` inside the protected group.
- `app/src/wallet/wallet-home-live.ts` — exports `readEthUsdPrice` (the Chainlink staleness rules) and `createDefaultBalanceClient` for the agent context.
- `agent/src/policy.ts` — balance messages in the blocked card's detail form (see Design).
- `app/.env.example`, `app/README.md` — `EXPO_PUBLIC_AGENT_BASE_URL`, `EXPO_PUBLIC_AGENT_APP_TOKEN`, `EXPO_PUBLIC_AGENT_CONTACTS`.

### Design

Platinum Fluid tokens from `app/src/constants/theme.ts`. The assistant accent (sparkle icon, highlighted border, question card) is indigo: `colors.ethereum` (`#8b9eff`), the closest existing token.

**Entry point.** A 38 px round sparkle button in the launcher header, to the left of the settings button, accessibility label "Open Dera". It shows only when both `EXPO_PUBLIC_AGENT_BASE_URL` and `EXPO_PUBLIC_AGENT_APP_TOKEN` are set and the wallet account is known; otherwise the launcher is unchanged. The home screen has no intent field.

**Page layout.** A header with a round Back button, the sparkle and "DERA" in the middle, and on the right a "New chat" button that appears once there is a conversation. Below it, the scrolling conversation, and pinned to the bottom the composer (the intent bar), which rises with the keyboard. The conversation scrolls to the newest turn.

**Empty state.** Centred: a sparkle in an indigo circle, "Ask Dera", the line "Dera turns what you say into a plan. You review and sign every step with your passkey.", then "TRY SAYING" and outlined chips. Tapping a chip fills the composer and focuses it; it does not send. Chips appear only for available actions: "send 0.01 eth to {name}", "send 2 usdc to {name}", and "swap 50 usdc to eth" today, with "deposit 100 usdc" once the vault lands. `{name}` is the first contact, or "alice".

**Conversation.** Each turn is the user's sentence as a right-aligned bubble followed by the answer card. There is no Edit: the user replies in the composer, and the server's transcript makes that a follow-up. Only the newest answer is actionable. Earlier cards stay readable but lose their buttons, so an outdated plan cannot be signed. "New chat" clears the turns and the next request is sent with `reset: true`. After a plan is signed and the user returns, that plan's card shows "Signed and confirmed" in place of its button.

**Composer.** A rounded field with a sparkle, a single-line `TextInput` (max 500 characters, accessibility label "Wallet intent"), and a "Plan" button that turns platinum once there is text. Empty submits do nothing. The field clears when a sentence is sent.

| State | Placeholder | Border | Button |
| --- | --- | --- | --- |
| Empty conversation | "Ask Dera" | Default | "Plan" |
| Planning | — (read-only) | Default | "…", disabled |
| After a plan, block, or notice | "Follow up, e.g. \"make it 0.02 instead\"" | Default | "Plan" |
| After a question | "Reply here" | Indigo highlight | "Plan" |

**Request.** On send: `loadAgentContext` (ETH and USDC balances and the Chainlink price through MultiBaas, contacts from the placeholder, vault and sponsorship `null` until their seams land, capabilities from `AGENT_CAPABILITIES`), then `agentClient.propose`. `reset` is true for the first request of a conversation and after any failure. The client waits up to 45 seconds; normal plans take 3 to 8 seconds, and broad requests with several tool calls have taken over 20.

**Answer card states.** All share one container: `colors.surface`, `radius.xl`, 1 px border.

- **Planning.** Eyebrow "PLANNING…" in indigo and, on the right, a muted caption that cycles every 1.5 seconds through "checking balances", "resolving names", "building plan". The caption is decoration; the server does not stream. Below it, three skeleton bars and a skeleton button.
- **Plan.** Header "PLAN · N ACTION" (plural "ACTIONS") and an emerald "checked on device" pill with a shield icon, shown because the phone's own `evaluatePolicy` passed. Each action is a numbered row: a platinum circle with the number, a title ("Send 0.01 ETH to alice"), and a muted line ("address book · 0x1234…abcd" for a contact, the short address alone for a typed one). A divider, then "ASSUMPTIONS" with a bullet each, only when there are any. A "gas" row with an emerald "SPONSORED" pill when the sponsorship seam reports an operation left, otherwise a muted "shown at review". One full-width button, "Review & sign".
- **Question.** Indigo-tinted card: eyebrow "NEEDS ONE DETAIL" with a question-mark icon, the question as a heading, and the indigo caption "reply below". The sentence is not repeated; it is the bubble above.
- **Blocked.** Eyebrow "BLOCKED · SAFETY CHECK" in `colors.negative` with a prohibition icon, the first violation's title as the heading ("You don't have enough ETH."), its message as the body ("You have 1.24 ETH. This plan needs 100 ETH."), a faint "checked by the planner and again on this phone", and "Open Swap" when swaps are unavailable, otherwise "Open Send". It appears when the phone's check or the service's check fails. Requests the model can see are over a balance or the $250 cap usually get a question instead.
- **Planner offline.** Eyebrow "PLANNER OFFLINE" with a cloud-off icon, "Can't reach the planner right now.", "Your wallet works as usual.", and "Open Send". Used for network failures, HTTP errors, and invalid responses.
- **Planner took too long.** Eyebrow "PLANNER TOOK TOO LONG" with an hourglass, "The planner took too long to answer.", "Try a shorter request. Your wallet works as usual.", and "Open Send". Used only for the client timeout, so a slow planner is not reported as offline.
- **Declined.** The offline layout with the eyebrow "CAN'T HELP WITH THAT" and the service's message as the heading.
- If the phone's `evaluatePolicy` rejects a plan the service accepted, the card shows the blocked state with the phone's violation and logs a warning; the phone's result wins.

**Policy messages.** Titles live in `violation-copy.ts`. The balance messages in both policies are the detail line: `insufficient_eth` is "You have {balance} ETH. This plan needs {needed} ETH.", with " and keeps 0.0005 ETH for fees" when only the reserve is short; `insufficient_usdc` is "You have {balance} USDC. This plan needs {needed} USDC."

**Encoder (`plan-encoder.ts`).** For each action in order, using the recipient the policy resolved and pinned:
- `send_eth`: `{ to, value: amountBase, data: '0x' }`; line "Send {amount} ETH to {name or short address}".
- `send_usdc`: `encodeUsdcTransfer({ to, amountMicro })`; line "Send {amount} USDC to …".
- `swap`: `quoteSwap` from `app/src/wallet/uniswap-quote.ts` at review time, then `buildSwapCalls` from `uniswap-swap-calls.ts` with a 10-minute `swapDeadline`. ETH to USDC is one Universal Router call carrying the ETH; USDC to ETH is a USDC approval to Permit2, a Permit2 approval to the router, and the router call. Line: "Swap {amountIn} {input} for ~{expected} {output}" with "at least {minimum} {output} · Uniswap v4 · 0.5% max slippage". `expiresAt` is the earliest swap deadline.
- `vault_deposit`, `vault_withdraw`: throw `Not implemented` until PRA-216 provides encoders; `AGENT_CAPABILITIES` keeps them disabled, so the policy blocks them first.

**Plan review screen.** A separate screen modelled on the send screen's review, confirm, and success steps; the send screen is unchanged.
1. Encode the pending plan, read the wallet identity, `createExecutionClient`, and assert the account matches.
2. `client.prepare(calls)`; `assertCallsMatch` requires `review.calls` to equal the encoded calls one-for-one (to, value, data), in order.
3. Show the numbered lines, From, Network, the network fee ("Sponsored" from `review.sponsored`, otherwise the maximum fee), and wallet setup when the first operation deploys the account.
4. "Confirm with passkey" first checks the swap deadline: within 30 seconds of `expiresAt`, it quotes and prepares again and shows "The swap quote expired, so it was refreshed. Check the amounts again." instead of signing. Otherwise it runs `execute(review.userOperationHash)`, marks the identity deployed, refreshes the wallet home, and marks the plan complete. ETH sends then appear in the activity feed with their amounts because section 1 decodes them from the chain.
5. Success shows the transaction hash with Copy and "View on explorer"; "Done" returns to the assistant, where the plan shows as signed. Any failure shows the error and "Back to plan".

**Address book (placeholder, removed in section 9).** No screen and no storage for the hackathon: contacts come from `EXPO_PUBLIC_AGENT_CONTACTS`. ENS is not implemented in the app (the `resolveRecipient` seam accepts addresses only), so the phone's check blocks a plan addressed to an ENS name even though the service can resolve it. Names go to the model; addresses stay on the phone until the plan is encoded. A real address book or ENS replaces the module without changing its `list()` signature.

### Tests

- `policy.test.ts`: the shared schema and policy vectors, and that `app/src/agent/schema.ts` and `policy.ts` match `agent/src/` apart from comments and import paths.
- `agent-client.test.ts`: headers, error reasons (unreachable, HTTP, invalid data, timeout), and optional settings.
- `agent-context.test.ts`: the snapshot from a fake balance client; `null` price when the feed is stale; capabilities.
- `plan-encoder.test.ts`: ETH and USDC calls and lines in plan order; unimplemented actions throw.
- `address-book.test.ts`: parsing, lowercasing, deduplication, malformed pairs, unset setting.
- `violation-copy.test.ts`: every violation code has a short title.
- `intent-bar.test.tsx`: empty submits do nothing; read-only and busy while planning; placeholders.
- `plan-card.test.tsx`: each state's eyebrow, heading, and buttons; SPONSORED versus "shown at review"; Open Swap versus Open Send; offline versus took too long.
- `assistant-screen.test.tsx`: empty state and chips; the conversation keeps turns and only the newest plan offers "Review & sign"; follow-ups send `reset: false`; a question switches the composer to "Reply here" without repeating the sentence; New chat clears and resets; a signed plan shows "Signed"; the timeout card appears in the conversation.
- `plan-review-screen.test.tsx`: prepare, the call-equality guard, confirm with passkey, completion; a mismatched operation and a missing plan both stop before the passkey.
- `launcher-screen.test.tsx`: the assistant button shows only with `onOpenAssistant`.

### Acceptance criteria

- On a device with a funded account and alice in `EXPO_PUBLIC_AGENT_CONTACTS`, the sparkle button opens the assistant, and "send 0.01 eth to alice" produces a plan, review, one passkey ceremony, a successful operation visible in the activity feed with amount and recipient, and the plan marked signed in the conversation.
- "send some eth to alice" produces a question and no review; replying with an amount produces a plan.
- "send 100 eth to alice" produces a question that names the balance and asks for a smaller amount.
- "make it 0.02 instead" after a plan produces a new plan, and only the new one can be signed.
- Requests the model can see are over the $250 cap produce a question offering a smaller amount. The blocked card appears only when a proposed plan fails the phone's check; `assistant-screen.test.tsx` and `plan-card.test.tsx` cover it.
- With the agent service stopped, a request shows the planner offline card; a request slower than 45 seconds shows the took-too-long card; the rest of the app keeps working.
- With the agent variables unset, the sparkle button is hidden and the launcher is unchanged.
- `pnpm lint` and `pnpm test --runInBand` pass.

## Section 7: Digest card

### Goal

A card that states what changed since the user last opened it and suggests one action, written by the same service. Where it appears is open (see Files). Tapping the suggestion opens the assistant with the sentence in the composer and runs the section 6 flow.

### Dependencies

Section 5 for the service. Section 6 for the assistant page and plan flow. Section 1 for activity data.

### Files

Create:
- `agent/src/digest.ts` — the Claude call.
- `agent/src/digest.test.ts`
- `app/src/agent/digest-client.ts` and test — `fetchDigest`.
- `app/src/components/digest-card.tsx` and test.

Modify:
- `agent/src/server.ts` — `POST /agent/digest`.
- `agent/src/schema.ts` and `app/src/agent/schema.ts` — `DigestSchema`.
- The screen that hosts `DigestCard`. Placement is open: it was designed to sit under the home intent bar, which section 6 replaced with the assistant page.
- `app/src/launcher/*` — persist `lastDigestAt` with the launcher preferences (extend the schema version of `launcher-preferences.ts` to 2 with a nullable `lastDigestAt`, keeping version 1 parsing).

### Design

Request: `{ account, context: AgentContext, since: string | null }`. The service runs `get_activity` itself (no tool loop needed; call the MultiBaas queries directly, filtered to rows after `since`) and asks the model for:

```ts
export const DigestSchema = z.object({
  headline: z.string().min(1).max(120),
  detail: z.string().min(1).max(240),
  suggestedIntent: z.string().min(1).max(200).nullable(),
});
```

Use `client.messages.parse` with `output_config.format = zodOutputFormat(DigestSchema)` and `effort: 'low'`, no tools, a separate cached system prompt (`agent/src/prompts/digest.md`). The suggested intent must be a sentence the section 6 flow can plan, in the catalogue, and only when it makes sense: idle USDC above 10 with the vault available suggests a deposit; nothing suggests nothing. The model may return `null`.

Card: eyebrow "YOUR WALLET · SODERA", headline, detail, and a button with the suggestion text when present. Refresh at most once per 30 minutes and on the first open of the day; store `lastDigestAt`. Loading and error states mirror the plan card's planning and planner offline states. If the agent variables are unset, the card is hidden.

### Tests

- `digest.test.ts`: message construction, schema parse, `null` suggestion path, refusal mapping.
- `digest-card.test.tsx`: renders headline and detail, tapping the suggestion opens the assistant with the sentence (assert through the `onSuggest` callback), 30-minute throttle honoured.
- `launcher-preferences.test.ts`: version 2 schema with `lastDigestAt`, and version 1 data still parses.

### Acceptance criteria

- After receiving USDC on a device, reopening the launcher shows a headline mentioning the receipt within the throttle window.
- Tapping a suggestion runs the intent flow to a plan card without retyping.
- `pnpm test` passes in `agent/`; `pnpm lint` and `pnpm test --runInBand` pass in `app/`.

## Section 8: Dera answers questions about activity

### Goal

Let Dera answer questions about the wallet's history, such as "how much have I sent alice this month?", "who do I pay most?", "what did I spend on gas this week?", and "how much came in versus went out?". Today Dera can only return a plan or a clarification, and its one history tool returns the last 20 rows with no date or counterparty filter and no totals. This section adds a third output kind, `answer`, and a tool that computes totals with MultiBaas aggregation queries so the model reports numbers instead of adding them up.

### Dependencies

Sections 1, 5, and 6 (all shipped). No new MultiBaas contracts: it queries the USDC `Transfer` and EntryPoint `UserOperationEvent` events already synced.

### Outcome

On the Dera page, "how much USDC did I send this month?" returns an answer card with the total and a breakdown by recipient, with no review or signing step. Follow-ups such as "and last month?" work through the existing transcript. Requests to act still return plans exactly as before.

### Files

Modify in `agent/`:
- `agent/src/schema.ts` — add `AnswerSchema` to the shared block and to `AgentOutputSchema`.
- `agent/src/output-format.ts` — add the `answer` branch to the hand-written JSON schema.
- `agent/src/multibaas.ts` — allow `aggregator` on select fields and `groupBy` on `EventQuery`.
- `agent/src/tools.ts` — add the `summarize_activity` tool.
- `agent/src/app.ts` — return `answer` outputs directly and skip `evaluatePolicy` for them; run the grounding check.
- `agent/src/grounding.ts` — the grounding check.
- `agent/src/prompts/system.md` — describe when to answer, when to plan, and that every number must come from a tool result or the snapshot.
- `agent/package.json` and new `agent/scripts/verify-activity-queries.ts` — `pnpm verify:activity`, a live check of the query shapes below.
- Tests: `schema.test.ts`, `output-format.test.ts`, `tools.test.ts`, `app.test.ts`.
- `agent/README.md` — add the answer response kind and a smoke test question.

Modify in `app/`:
- `app/src/agent/schema.ts` — same shared block as the service.
- `app/src/agent/agent-client.ts` — add `answer` to `ProposeResponseSchema`.
- `app/src/agent/use-agent-planner.ts` — add `{ phase: 'answer'; intent; answer: Answer }`.
- `app/src/components/plan-card.tsx` — render the `answer` phase.
- `app/src/components/assistant-screen.tsx` — treat an answer turn like a plan turn for the composer (follow-up mode).
- Tests for each of the above.

Modify in `docs/plans/`:
- `agent-schema-vectors.json` — answer vectors that parse and fail.

### Output schema

Add inside the shared schema markers in both `schema.ts` files:

```ts
export const AnswerSchema = z.object({
  kind: z.literal('answer'),
  text: z.string().min(1).max(400),
  facts: z
    .array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(60) }))
    .max(4),
});

export const AgentOutputSchema = z.discriminatedUnion('kind', [ProposalSchema, ClarificationSchema, AnswerSchema]);
```

`text` is one to three plain sentences. `facts` are the key numbers shown large on the card, for example `{ label: "Sent to alice", value: "42.5 USDC" }`. Add the same branch to `AGENT_OUTPUT_JSON_SCHEMA` in `output-format.ts` using only the constructs listed in that file's header comment.

Response type gains `| { kind: 'answer'; text: string; facts: { label: string; value: string }[]; source: { from: string; to: string } | null }`. The service sets `source` to the range of the last `summarize_activity` call in the request, or `null` when the answer came from the snapshot.

### Tool: `summarize_activity`

Read-only, same error handling as the other tools (`runSafely`).

Input:

```ts
z.object({
  from: z.string().describe('First UTC day included, as YYYY-MM-DD.'),
  to: z.string().describe('First UTC day after the range, as YYYY-MM-DD.'),
  counterparty: z.string().min(1).max(255).optional().describe('Name or 0x address to limit transfers to.'),
})
```

Ranges are whole UTC days because the deployment's `triggered_at` filter accepts only `YYYY-MM-DD` (confirmed 2026-09-27: ISO timestamps, Postgres timestamps, and epoch strings return HTTP 400 or do not filter). Reject a malformed date, a range where `from >= to`, or one longer than 366 days with `{ error }`. Resolve `counterparty` with the existing `resolveName` logic (ENS, with a bare label read as `<label>.sodera.eth` since section 9); return `{ error: 'unknown counterparty' }` if it fails.

It runs five MultiBaas event queries in parallel, each filtered by a `triggered_at` range (`greaterthanorequal` from, `lessthan` to) in addition to the filters below:

1. **Sent USDC by recipient**: `Transfer`, `contract_address` = USDC, `input[0]` = account (lowercase). Select `input[1]` as `counterparty` and `input[2]` as `total` with `aggregator: 'add'`, `groupBy: 'counterparty'`. Add `input[1]` = counterparty when given.
2. **Received USDC by sender**: the same with `input[0]` and `input[1]` swapped.
3. **Gas by payer**: `UserOperationEvent`, `contract_address` = EntryPoint, `input[1]` = account. Select `input[2]` as `paymaster` and `input[5]` (`actualGasCost`, wei) as `gas` with `aggregator: 'add'`, `groupBy: 'paymaster'`. A zero paymaster means the account paid; any other paymaster means the operation was sponsored.
4. **Recent rows**: sent and received transfer queries with the range and counterparty filters, limit 10 each, merged newest first and cut to 10, for "when did I last…" questions.

When `counterparty` is set, the gas query is skipped and `gas` is `null`, because gas is not tied to a counterparty.

Limit each aggregated query to 50 rows (the deployment maximum); if any returns 50, set `truncated: true`. Compute totals in `bigint` from the grouped rows and format them with `formatUnits`. Map counterparty addresses to address book names where they match.

Output:

```json
{
  "range": { "firstDay": "2026-09-01", "lastDay": "2026-09-27" },
  "coverage": "USDC transfers and account operations, by UTC day. ETH transfers are not included.",
  "usdc": {
    "sent": "142.5",
    "received": "300",
    "net": "157.5",
    "byCounterparty": [
      { "address": "0x…", "name": "alice", "sent": "42.5", "received": "0" }
    ]
  },
  "gas": { "paidEth": "0.00041", "sponsoredEth": "0.0012" },
  "recent": [ { "direction": "sent", "amount": "10", "counterparty": "0x…", "name": "alice", "timestamp": "…" } ],
  "truncated": false
}
```

Sort `byCounterparty` by `sent + received` descending and keep the top 10. Keep `get_activity` unchanged.

`range` in the output is `{ firstDay, lastDay }`, both included, not the exclusive `to` the query uses; the model otherwise states the day after the range as its end. Gas figures are rounded half up to 6 decimals with `roundUnits` (exported from `propose.ts`), because 18-decimal wei values are unreadable on the card.

### Snapshot figures (`renderUserMessage`)

The grounding check rejects any figure the model computes, so the service computes the ones people ask for and puts them in the snapshot. The ETH line becomes `- ETH balance: 0.44157679561013403 (about 0.441577 ETH, about $1148.76)` and, when the ETH price is known, a `- Total value: about $1218.76 (ETH at the price below, plus USDC and the vault)` line follows the USDC balance. Dollar values use `bigint` arithmetic on the balance and the price.

### Grounding check (`app.ts`)

The model must not make up numbers. For an `answer`, collect every tool result string produced during the request plus the rendered user message. Extract each number in `facts[].value` (regex `\d+(?:\.\d+)?`) and require it to appear in that collected text. If any fact fails, respond `{ kind: 'rejected', summary: null, violations: [{ code: 'ungrounded', actionIndex: null, message: "Some figures in the answer didn't match your wallet data. Try a narrower question." }] }` and log outcome `ungrounded`. `ungrounded` is added to `ViolationCode` in both `policy.ts` files (type only; policy never emits it). The app titles it "Dera couldn't back up that answer." and shows no Open Send button, since a question has nothing to hand to a manual screen. `text` is not checked, because it may paraphrase; the facts carry the figures shown large.

Numbers are compared in canonical form (no thousands separators or trailing fractional zeros), so `42.50` matches `42.5`. To support this, `runSafely` appends each result string to a `toolResults: string[]` array passed in `ToolDependencies`, alongside the existing `calls`, and `summarize_activity` pushes its range onto `ranges`.

### System prompt changes

Replace the opening "You prepare transaction plans" framing with "You help the user understand and act on their Sodera wallet". Add:

- A third return form: `{"kind": "answer", "text": ..., "facts": [...]}` for questions about balances or history. Answers never contain actions.
- Call `summarize_activity` for any question about totals, counterparties, gas, or a period. Compute `from` and `to` as UTC days from the snapshot time: "this month" is the first of the current month to the day after today, "last week" is the seven days before today.
- Every number in an answer must come from a tool result or the snapshot. Say plainly when the data does not cover the question, such as ETH transfers, and name the coverage.
- Balance questions ("how much USDC do I have?") are answered from the snapshot without a tool.
- If a question and an action are mixed ("how much did I send alice, and send her 5 more"), return the plan and answer the question in the summary.
- Never add, subtract, multiply, or round figures; quote the snapshot's rounded ETH, dollar value, and total value instead.
- A fact's value is an amount with its unit ("42.5 USDC", "$1148.76"). Who or what it relates to goes in the label, as an address book name or a shortened address such as 0xE03A…3543, never a full address.
- State periods with the tool result's `range.firstDay` and `range.lastDay`.

Keep the prompt byte-stable.

### App design

- `use-agent-planner.ts`: `response.kind === 'answer'` sets `{ phase: 'answer', intent, answer }`. No policy call.
- `plan-card.tsx` `answer` phase: the text, then up to four facts as label and value rows, values in JetBrains Mono, and a footnote "From MultiBaas · {range}" when `source` is set. No approve or review button. Use `platinum` tokens only. Fact rows wrap: the label keeps at least 40% of the width and the value shrinks and aligns right, so a long value cannot squeeze the label.
- `plan-card.tsx` `plan` phase: show the plan's summary above the actions. Mixed requests put their answer in the summary, which the card did not show before.
- `assistant-screen.tsx`: after an answer the composer is in follow-up mode, as after a plan.
- Accessibility label: the full text followed by each fact as "label, value".

### Tests

- `schema.test.ts` (both apps): answer vectors parse; an answer with actions, more than four facts, or an empty text fails.
- `output-format.test.ts`: the answer branch agrees with the vectors.
- `tools.test.ts`: `summarize_activity` query bodies (range filter, aggregator, `groupBy`, lowercase account, counterparty filter); totals, net, and name mapping from fake grouped rows; zero versus non-zero paymaster split; `truncated` when a query returns 50 rows; invalid range and unknown counterparty errors.
- `app.test.ts`: an answer skips policy and returns `answer`; an answer whose fact is not in any tool result returns `rejected` with outcome `ungrounded`; an answer from snapshot figures passes.
- `use-agent-planner` and `plan-card.test.tsx`: answer phase renders text and facts, has no review button, and the composer enters follow-up mode.

### Verification

`pnpm verify:activity` in `agent/`, reading `MULTIBAAS_BASE_URL`, `MULTIBAAS_API_KEY`, and a `VERIFY_ACCOUNT` with past USDC activity. It asserts, and the implementation applies what it finds:

1. A `YYYY-MM-DD` `triggered_at` filter includes and excludes by day, and a timestamp with a time is still rejected (if it starts being accepted, finer ranges become possible).
2. Grouped `add` totals on the `uint256` value equal the sum of the ungrouped rows.
3. `UserOperationEvent` input 2 is a lowercase paymaster address and input 5 is a positive wei string.
4. The tool runs end to end over the last 366 days.

Passed on 2026-09-27 against the deployment with `VERIFY_ACCOUNT=0xFbf2213c7F5DE314729293fF1B541F8591637658`.

### Device testing (2026-09-27)

Run on an Android phone against the local agent and the deployment. Questions that worked first time: USDC sent this month, gas this month as a follow-up, ETH balance, ETH received (answered that ETH transfers are not covered), USDC sent to a named contact.

| Found | Cause | Fix |
| --- | --- | --- |
| "what is my eth worth in usd?" was blocked as ungrounded | The model multiplied balance by price; the product appears in no source | Snapshot carries rounded ETH, its dollar value, and total value |
| "who do I pay most?" stretched the card to twice its height | A full address was a fact value; the label column shrank to one character wide | Facts hold amounts only; fact rows wrap with a minimum label width |
| Gas shown as `0.0014565694377116 ETH` | Tool returned exact wei formatted to 18 decimals | Gas rounded to 6 decimals |
| Blocked answer said "The planner's answer couldn't be read." with Open Send | Grounding reused the `schema` code | New `ungrounded` code with its own title and no button |
| Mixed question and action showed no answer | Plan card did not render `summary` | Plan card shows the summary |
| "last week" text said Sep 19 to Sep 26, card said Sep 19 to Sep 25 | Tool returned the exclusive `to`; the model read it as the last day | Tool returns `firstDay` and `lastDay` |

All six were re-run on the device after the fixes and now match the card.

### Acceptance criteria

- `pnpm verify:activity` passes against the deployment.
- On a device with USDC history, "how much USDC did I send this month?" shows an answer card whose total matches the Transactions screen.
- "who do I pay most?" lists recipients by address book name where known.
- "what did I spend on gas this week?" separates self-paid and sponsored gas.
- "and last month?" as a follow-up answers for the previous month.
- "send 5 usdc to alice" still returns a plan and review flow unchanged.
- "what is my eth worth in usd?" answers with the snapshot's dollar value.
- "how much usdc do I have, and send 1 usdc to alice" shows the balance in the plan card's summary.
- `pnpm test`, `pnpm typecheck` pass in `agent/`; `pnpm lint` and `pnpm test --runInBand` pass in `app/`.

## Section 9: Dera resolves ENS recipients

### Goal

Now that users hold real `<label>.sodera.eth` names (see `ens-onboarding-and-renewal.md`), Dera resolves recipients through ENS instead of the placeholder address book. A user can type a bare Sodera label ("send 5 usdc to john"), a full ENS name ("john.sodera.eth", "vitalik.eth"), or a hex address. There is no address book or phonebook for now.

### What was wrong

- `resolve_name` in `agent/src/tools.ts` checked the address book and returned `unknown` for any name without a dot, so "john" never reached ENS.
- The phone's policy check in `app/src/agent/use-agent-planner.ts` resolved names from the address book only. Any plan the service resolved through ENS was blocked on the phone with "I don't know who {name} is.", so ENS recipients never worked in Dera.

### Resolution rule

The service and the phone apply the same rule to every recipient:

1. A hex address (`kind: 'address'`) is used as is after `isAddress`.
2. A name containing a dot is lowercased, passed through `normalize` from `viem/ens`, and resolved with `getEnsAddress` on Sepolia.
3. A name without a dot is treated as a Sodera label: append `.sodera.eth` (`john` → `john.sodera.eth`) and resolve it as in step 2.

A name that fails to normalize, has no address record, or cannot be read because the RPC failed is unresolved. The service returns `{ error: 'unknown' }` and the model asks who the user means. The phone blocks the plan with `recipient_unresolved`. Nobody guesses another spelling or TLD.

### Design

- **Service tool.** `resolve_name` implements the rule and returns `{ address, name }`, where `name` is the full ENS name it resolved, such as `john.sodera.eth`. It records both the typed key and the full name in `resolvedNames` for the service's policy check. `summarize_activity` resolves its `counterparty` with the same function.
- **Plan recipient.** The system prompt tells the model to put the returned full name in the plan (`{ kind: 'name', value: 'john.sodera.eth' }`) and to use it in the summary. The user then sees the exact name the money goes to, not the shorthand they typed.
- **Phone check.** Before `evaluatePolicy`, the planner hook resolves every `kind: 'name'` recipient with its own Sepolia RPC, using the same rule. It passes the results to the synchronous `resolveName` option as a map. The phone never trusts an address from the service. `EnrichedAction.recipient.name` holds the full ENS name, the action title names it, and the muted line under it reads "ENS · 0x1234…abcd" (it read "address book" before).
- **Shared helper.** The phone expands names with a helper next to `resolveSepoliaRecipient` in `app/src/wallet/send-transfer.ts` and reuses that function for the lookup. The service keeps its own copy in `agent/src/tools.ts`, because the service does not import app code.
- **Address book removed.** `app/src/agent/address-book.ts` and `EXPO_PUBLIC_AGENT_CONTACTS` are deleted. The shared context schema keeps `addressBook` for a future phonebook, the app sends `[]`, and `renderUserMessage` omits the address book line when the list is empty. Activity answers label counterparties with shortened addresses; reverse ENS lookup for those labels is out of scope.

### Files

- `agent/src/tools.ts`: the resolution rule, the `resolve_name` result and description, and the `summarize_activity` counterparty.
- `agent/src/prompts/system.md`: recipients can be a Sodera label, a full ENS name, or an address; call `resolve_name` and use the returned name.
- `agent/src/propose.ts`: omit the empty address book line.
- `agent/src/policy.ts` and `app/src/agent/policy.ts`: update the `resolveName` comment to match what each side actually does.
- `app/src/wallet/send-transfer.ts`: export the name-expansion helper.
- `app/src/agent/use-agent-planner.ts`: resolve name recipients before the phone's policy check; drop the address book.
- `app/src/agent/agent-context.ts`, `app/src/components/assistant-screen.tsx`: stop reading the address book; the chips use a fixed example name.
- Delete `app/src/agent/address-book.ts` and its test; drop `EXPO_PUBLIC_AGENT_CONTACTS` from `app/.env.example` and `app/README.md`.
- `agent/README.md`: the smoke test sends to a Sodera label with an empty address book.

### Tests

- `tools.test.ts`: a bare label resolves as `<label>.sodera.eth`; a dotted name is resolved as typed; uppercase input is lowercased; a name that fails `normalize` and an ENS miss both return `unknown`; `resolvedNames` holds the typed key and the full name; a `summarize_activity` counterparty given as a bare label.
- `app.test.ts`: a plan to a bare label passes the service's policy check with the full name.
- App planner test: a plan addressed to `john.sodera.eth` passes the phone's check after its own lookup; an ENS miss and an RPC failure block it with `recipient_unresolved`; an address from the service is ignored when the phone resolves a different one.
- `send-transfer` test: expanding a bare label, and leaving dotted names and addresses unchanged.

### Acceptance criteria

- On a device, "send 1 usdc to {label}" for a claimed Sodera name produces a plan card showing `{label}.sodera.eth` with the name's address, and the review shows the same address.
- "send 1 usdc to {label}.sodera.eth" and "send 1 usdc to 0x…" behave the same way.
- "send 1 usdc to nobodyhere" produces a question asking who the user means, with no plan.
- "how much did I send {label} this month?" answers for that name's address.
- `pnpm test`, `pnpm typecheck` pass in `agent/`; `pnpm lint` and `pnpm test --runInBand` pass in `app/`.

## Open verifications

MultiBaas rows are resolved by the section 1 script and applied in `multibaas.ts`. Agent rows are resolved where stated.

| Question | Resolved by | Consumers |
| --- | --- | --- |
| REST prefix is `/api/v0` on the deployment domain | 1.1 step 1 | all |
| Field name for chain id in chain status | 1.1 step 1 | section 3 |
| Shape of `latestRoundData` output (array or keyed object) | 1.1 step 4 | section 3 |
| Whether the address endpoint returns a wei balance, and its field name | 1.1 step 5 | section 3 |
| Address case sensitivity in `input` filters | 1.1 step 7 | sections 1, 4 |
| Non-browser requests succeed without CORS registration | 1.1 step 9 | all |
| USDC indexer keeps up under the free-tier 2 events per second cap | prerequisites step 6 | sections 1, 4 |
| `triggered_at` filter value format (`YYYY-MM-DD` only), `add` aggregation on `uint256`, `UserOperationEvent` input indexes | Confirmed 2026-09-27 by `pnpm verify:activity` | Section 8 |
| Where the webhook HMAC secret is shown | section 4 setup step 3 | section 4 (low priority) |
| Exact `event.emitted` payload layout | section 4 setup step 4 | section 4 (low priority) |
| `toolRunner` forwards `output_config.format` | Confirmed live on 2026-09-26 with the hand-written schema | Section 5 |
| Effort level that keeps proposal latency under 10 seconds with good plans | Section 5 smoke tests, sweep `medium` and `high` | Sections 5 and 6 |
| Pinned Uniswap route and quoter for `quote_swap` | PRA-212 | Section 5 tool, section 6 encoder |
| Sponsorship allowance source | PRA-195, PRA-199 | Policy `sponsorship` rule, plan card line |
| Shared review component from PRA-198 | PRA-198 | Section 6 review screen |
| Speech input library compatibility with SDK 57 | Section 6, optional | Assistant composer microphone button |

## Sources

- MultiBaas overview: https://docs.curvegrid.com/multibaas/
- Event indexing: https://docs.curvegrid.com/multibaas/event-indexing/
- Manage contracts (Contract from Address, sync events, starting block): https://docs.curvegrid.com/multibaas/manage-contracts/
- API keys (bearer header, DApp User keys): https://docs.curvegrid.com/multibaas/api-keys/
- Webhooks (headers, HMAC construction, event types): https://docs.curvegrid.com/multibaas/webhooks/
- Build a frontend (DApp User key model, CORS): https://docs.curvegrid.com/multibaas/getting-started/build-a-frontend/
- Deployment and domain: https://docs.curvegrid.com/multibaas/getting-started/account-and-deployment/
- Event queries API: https://docs.curvegrid.com/multibaas/api/event-queries
- SDK type definitions (FieldType, filter operators, aggregators, EventQuery): https://github.com/curvegrid/multibaas-sdk-typescript/blob/main/api.ts
- SDK method docs (`callContractFunction`, `getAddress` include values, `executeArbitraryEventQuery`): https://github.com/curvegrid/multibaas-sdk-typescript/tree/main/docs
- Reference app (frontend-only event-query balances): https://github.com/curvegrid/matsuri-stablecoin-sample-app
- Expo push setup and Android FCM requirement: https://docs.expo.dev/push-notifications/push-notifications-setup/
- Expo push API: https://docs.expo.dev/push-notifications/sending-notifications/
- expo-notifications config plugin: https://docs.expo.dev/versions/latest/sdk/notifications/
- Claude API TypeScript reference from the `claude-api` skill: tool runner, structured outputs, refusal fallbacks, error classes, prompt caching, effort.
- `docs/sodera.md` sections 16, 17, 21, 26, 45.
- `docs/hackathon-decisions.md` sponsorship and signing authorization rules.
- `docs/hackathon-specs.md` ticket table for seam ownership.
- Curvegrid ETHGlobal Tokyo workshop slides (screenshots supplied by the user): "Separate intent from authority" and the two prize tracks.
