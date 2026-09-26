# Pay with any token plan

**Status:** Planned, not implemented. Scope for v1 is ETH ⇄ USDC on Ethereum Sepolia.

## Goal

Let a wallet user pay a recipient an **exact amount** of one asset while spending another, in one passkey confirmation. For example, the payee receives exactly 10 USDC and the user pays in ETH. Uniswap routing finds the best path. The feature lives **inside Send** as a "Pay with" selector:

- **Same asset** (the default): Send works as it does today, a plain transfer with no routing.
- **Other asset:** the app gets a routed Uniswap quote and batches the swap with the transfer to the payee in one Kernel UserOperation.

v1 supports only ETH and USDC, the assets the wallet already handles. A curated token list can follow once the pipeline is proven. Arbitrary token discovery stays deferred, per `docs/hackathon-decisions.md`.

## Why the Trading API now

Swap (see [the swap plan](uniswap-swaps.md)) swaps against one pinned v4 pool with calldata the app encodes itself. "Pay with" needs routing across pools and protocols, and the only practical router is the Uniswap Trading API:

- **No other router fits.** `@uniswap/smart-order-router` is Node-only (see [issue #876](https://github.com/Uniswap/smart-order-router/issues/876) on React Native). The v4 SDK encodes routes but does not find them.
- **The API covers Sepolia.** Ethereum Sepolia (`11155111`) is on the Trading API's [supported chains](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains) list, along with Unichain and Base Sepolia. The API is free, and each key is rate-limited to 6 requests per second by default ([FAQ](https://developers.uniswap.org/docs/trading/swapping-api/faqs)).
- **Exact output.** `/quote` with `type: EXACT_OUTPUT` routes across `V2`, `V3` and `V4` and returns `input.maximumAmount`, `routeString`, `priceImpact` and the gas estimate ([OpenAPI spec](https://trade-api.gateway.uniswap.org/v1/api.json)).
- **Smart accounts can avoid off-chain permit signatures** in three ways:
  - `/swap_5792` returns a batch of calls for EIP-5792 ([reference](https://developers.uniswap.org/docs/api-reference/create_swap_5792_transaction)). Whether approvals are included is not documented; the spike checks this.
  - `generatePermitAsTransaction` returns the Permit2 approval as calldata.
  - The `x-permit2-disabled` proxy flow ([no-Permit2 workflow](https://developers.uniswap.org/docs/trading/swapping-api/concepts/no-permit2-workflow)) uses proxy `0x0000000085E102724e78eCd2F45DC9cA239Affad`, which is supported on Sepolia.

  This corrects the earlier assumption in the swap plan and in `FEEDBACK.md` that the API only fits wallets that sign a single transaction.
- **The key must stay server-side.** Uniswap's [integration guide](https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide) says: "Store your Uniswap API key server-side … Do not ship it in front-end code; proxy calls through your own backend so the key is never exposed to users."

## Architecture

```
App ──(existing app token)──▶ agent/ backend  POST /pay/quote
                                  │  x-api-key: UNISWAP_API_KEY (Railway env var, never EXPO_PUBLIC)
                                  ▼
                   Uniswap Trading API  https://trade-api.gateway.uniswap.org/v1
                     /quote (EXACT_OUTPUT) → /swap_5792 (or /check_approval + /swap, per the spike)
                                  │
App ◀── normalized quote + calls ─┘   (the key and raw API response never leave the backend)
App: guard + decode calls → append transfer to payee → asset-change simulation → Kernel prepare → passkey → bundler/paymaster
```

- **Backend:** `agent/` is the project's only backend, a Hono service on Railway with bearer app-token auth, zod validation, rate limiting (`agent/src/rate-limit.ts`) and server-side secrets. The app already reaches it through `EXPO_PUBLIC_AGENT_BASE_URL` and `EXPO_PUBLIC_AGENT_APP_TOKEN`. The Uniswap key becomes one more server-side secret.
- **Router:** the Universal Router is Uniswap's on-chain contract. The Trading API returns calldata for the Sepolia Universal Router **2.1.2** at `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`. That is a different deployment from the router 2.0 at `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`, which Swap uses with its own `V4Planner` calldata. The two have separate Permit2 allowances.
- **SDK role:** `@uniswap/v4-sdk`, already a dependency, is used only to **decode and verify** the API's `V4_SWAP` calldata (`V4BaseActionsParser`). It does not build it.
- **Unchanged:** execution, gas sponsorship and simulation stay on the existing path: `createKernelPasskeyExecutionClient().prepare(calls)` batches any number of calls, then the ZeroDev bundler and paymaster, then our Sepolia RPC.
- **Payee handling:** the payee is **never sent to Uniswap**. The swap output goes to the Kernel, and the app appends its own transfer to the payee. The reason is refunds. In exact-output trades the Universal Router SDK sends the leftover-ETH `SWEEP` to the same recipient as the output ([`universal-router-sdk` source](https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/entities/actions/uniswap.ts)). Setting `recipient` to the payee would hand them the refund.

## Commits

All work lands on one branch, `feat/pay-with-any-token`, as separate commits, with backend and frontend changes kept in separate commits. Commits follow `{type}: {description}` (or `{type}: {PRA-###}: {description}` once a Linear ticket exists), with no co-author trailer. The order below is also the order of implementation. The spike is backend-side so the API key only ever lives in `agent/.env`.

1. **Backend: feasibility spike (the go/no-go gate).**
    - Files: `agent/scripts/verify-pay-with-route.ts`, a `verify:pay-with` script in `agent/package.json`, and `docs/research/…-trading-api-pay-with.md`.
    - The script calls the API directly with `UNISWAP_API_KEY` from the git-ignored `agent/.env`, the same place the key will live in production. `swapper` is set to a Kernel address, and `x-universal-router-version: 2.1.2` is pinned.
    - Two cases: EXACT_OUTPUT **10 USDC paid with ETH**, and **0.001 ETH paid with USDC**.
    - Compare three ways of getting calls:
        1. `/swap_5792`
        2. `/check_approval` + `generatePermitAsTransaction` + `/swap`
        3. The `x-permit2-disabled` proxy
    - For each, append our transfer to the payee, then simulate the whole batch as the Kernel with viem's `simulateCalls({ traceAssetChanges: true })` and balance state overrides. Assert:
        - the payee receives exactly the amount;
        - the Kernel spends no more than `input.maximumAmount`;
        - any ETH refund returns to the Kernel.
    - Also confirm that `V4BaseActionsParser` decodes the API's router 2.1.2 calldata.
    - Record in the research doc: the chosen option and why, the call shapes and targets, approval amounts (`permitAmount` FULL vs EXACT), latency, and route quality on Sepolia's thin, mispriced liquidity.
    - Acceptance: both directions pass the asset-change assertions, or the doc records a no-go and why.
2. **Backend: quote endpoint.**
    - Files: `agent/src/uniswap-trading.ts` (API client), `agent/src/pay-quote.ts` and its schema, the route in `agent/src/app.ts`, dependencies in `agent/src/server.ts`, `UNISWAP_API_KEY` in `agent/.env.example`, `agent/README.md`, and vitest tests with a faked `fetch`.
    - `POST /pay/quote`, authenticated with the existing app token.
    - Request: `{ account, payAsset: 'ETH' | 'USDC', receiveAsset, amountOut }`, where `amountOut` is a base-unit string. Zod rejects matching assets, zero or oversized amounts, and unknown assets.
    - Fixed server-side:
        - chain `11155111` and token addresses;
        - `type: EXACT_OUTPUT` and `protocols: [V2, V3, V4]`;
        - `slippageTolerance: 0.5` and router version 2.1.2;
        - the call option chosen in the spike;
        - the router's own deadline, which `/swap_5792` sets 30 minutes after quoting and ignores a requested one; the backend decodes it from the calldata and reports it;
        - **no `recipient`**.
    - Normalized response: `{ quoteId, requestId, quotedAt, deadline, routerVersion, payAsset, receiveAsset, amountIn, maxAmountIn, amountOut, route, priceImpactPercent, swap: { to, value, data } }`. `swap` is the only call the backend passes on, and it must be the Universal Router's `execute`. The spike showed that `/swap_5792` returns unlimited approvals, so the app builds bounded ones itself. The key, upstream headers and raw body never appear in responses or logs. Logs mask the account and keep the Uniswap `requestId`.
    - Operations:
        - 8 s upstream timeout;
        - per-account and per-IP limits, plus a global limit of 3 quotes a second, because each quote makes two Uniswap requests against the key's 6 per second;
        - errors: `NoRouteFound` maps to 422 `no_route`, upstream 429 to 503 `busy` with `retry-after`, a timeout to 504, and anything else to 502.
    - Acceptance: vitest covers auth, validation, rate limits, error mapping, and that the key never appears in responses. A smoke test passes on Railway with the env var set.
3. **Frontend: call guard and quote client.**
    - Files: `app/src/wallet/pay-with-swap.ts` (with real captured quotes in `pay-with-swap-fixtures.ts`), `payQuote` in the agent client (zod-parsed response, 20 s timeout, `PayQuoteError` with `no_route`, `busy`, `timeout`, `unreachable` or `error`), and the Trading Universal Router and WETH addresses in `app/src/wallet/sepolia.ts`.
    - The only call taken from the API is the router call, and it is untrusted. `verifyPayWithSwap` checks:
        - the quote matches the request (assets and exact amount), and `amountIn ≤ maxAmountIn`;
        - the target is the Trading Universal Router, and the call is `execute(bytes,bytes[],uint256)`;
        - the deadline equals the quote's, is in the future and is at most about 30 minutes out;
        - the ETH value is at most `maxAmountIn`, or 0 when paying with USDC;
        - every command, with the allow-revert flag rejected: `V4_SWAP`, `V3_SWAP_EXACT_OUT`, `V2_SWAP_EXACT_OUT`, `WRAP_ETH` (only when paying with ETH, into the router), `UNWRAP_WETH` and `SWEEP` (only to the account). Any other command is rejected.
        - `V4_SWAP` is decoded with `@uniswap/v4-sdk`'s `V4BaseActionsParser` using `URVersion.V2_1_2` (the 2.0 layout misreads the amounts). Only exact-output swaps from the pay currency to the receive currency, `SETTLE`/`SETTLE_ALL` in the pay currency, and `TAKE` to the account or `TAKE_ALL` of the receive currency are allowed.
        - v2 and v3 paths must run between the pay and receive tokens (WETH for ETH), with recipients limited to the account or the router.
        - the exact outputs add up to the requested amount, and the maximum inputs to at most `maxAmountIn`.
    - `buildPayWithCalls` returns `[USDC.approve(Permit2, maxAmountIn), Permit2.approve(USDC, router, maxAmountIn, deadline), swap, transfer]` when paying with USDC, and `[swap, transfer]` when paying with ETH. The approvals reuse `buildUsdcPermit2Approvals` from `uniswap-swap-calls.ts`, and the transfer is the wallet's own, of exactly `amountOut` to the payee.
    - Acceptance: the four captured quotes pass, and each tampered case is rejected before any passkey prompt: another amount or direction, a foreign target, a wrong selector, excess ETH value, a mismatched or expired deadline, a lower maximum, a take, sweep, swap or unwrap to someone else, an allow-revert or unknown command, and a wrap when paying with USDC. `pnpm verify:uniswap` still matches the golden Swap calldata.
4. **Frontend: Send UI.**
    - Files: `app/src/components/send-screen.tsx`, `app/src/wallet/send-transfer.ts` (`parseSendAmount`, split from the balance check), `app/src/wallet/pay-with-simulation.ts` and `app/src/wallet/prepared-calls.ts`.
    - A "Pay with" selector on the amount step, shown only when the agent is configured. When it matches the asset being sent, the existing path runs unchanged and nothing calls `/pay/quote`.
    - The one-call echo check became `assertPreparedCallsMatch(review, calls)` for any number of calls, used by both paths.
    - Before `prepare` (which spends sponsorship), the wallet checks the quote:
        - price impact above 10% is blocked;
        - a pay balance below `maxAmountIn` is blocked;
        - paying yourself is blocked (that is a swap).
    - It then runs `buildPayWithCalls` and simulates the batch from the account on live Sepolia state with `eth_simulateV1` transfer tracing. Every call must succeed, the payee must receive exactly the amount, the account must not spend its own receive asset, and it may spend at most `maxAmountIn`. The simulated spend is shown as the estimate.
    - The review shows:
        - "Recipient gets exactly X"
        - "You pay Z (at most Y)"
        - the route (for example "Uniswap v4 · 2 hops"; the full route string is under More details)
        - price impact, marked high above 2%
        - the USDC approval and its expiry, when paying with USDC
        - the sponsored network fee
        - a note that Sepolia pools are not market prices
        - every call under More details
    - Uses the Platinum Fluid tokens from `app/src/constants/theme.ts`; status notices keep Send's existing placement.
    - Freshness: the review expires 30 s after preparing, including when checked at Confirm after the app slept. It returns to the amount step with "Get a new quote", as Swap does, so nothing is signed on a stale quote.
    - Errors (no route, busy, timeout, a rejected guard or simulation) offer "Pay with <same asset> instead".
    - Acceptance:
        - Jest covers the pay-with flow, expiry, no-route fallback and simulation rejection.
        - A live check (fresh agent quotes, then the guard, `buildPayWithCalls` and the simulation against Sepolia from the deployed Kernel) passes in both directions.
        - Device payments passed in both directions: [`0x0b06…70bb`](https://sepolia.etherscan.io/tx/0x0b06e8e799f05f54235a1ac4d0430b9cf919a84ffbe7faa7b5abe14240b670bb) (10 USDC paid with ETH) and [`0x2c27…1875`](https://sepolia.etherscan.io/tx/0x2c27b215ab7004a9ef6c52b8c04835b8f6f8ec92970e0a96ad1759786a991875) (0.002 ETH paid with USDC). The activity grouping recognises both from their on-chain calls.
5. **Frontend: activity grouping.**
    - Files: `app/src/wallet/pay-with-activity.ts`, `transaction-activity.ts` (a `payment` item kind), `transaction-activity-multibaas.ts`, `user-operation-calls.ts` (every Kernel call, with its data), `pending-sends.ts` and `app/src/components/transactions-screen.tsx`.
    - Without grouping, a payment shows up as several rows: the ETH sent to the router, its refund, the pool leg, and the transfer to the payee.
    - An operation is a payment when its last two calls are the Trading Universal Router and a transfer to the payee, which is how Send builds it. Its rows in that transaction become one row, "Paid X <asset>" to the payee, with "Swapped from Y <asset>".
    - What was paid is the net outflow of the pay asset in the transaction. When paying with ETH, the refund comes from Blockscout's internal transactions; if Blockscout fails, the row shows "up to" the ETH sent to the router. A failed payment keeps one row, marked failed, with no paid amount.
    - Pending sends store `payAsset` and `maxPayAmount`, so a payment not yet indexed shows "Swapped from up to Y". It is deduplicated against the indexed payment row.
6. **Docs.**
    - `docs/plans/uniswap-swaps.md`: correct "Why not the Uniswap API or SDKs" (`/swap_5792` and permit-as-transaction exist).
    - `FEEDBACK.md`: rewrite item 4 with the spike's findings.
    - `README.md`: Swap uses the pinned v4 pool and router 2.0; "Pay with" uses the Trading API through the backend and router 2.1.2.

## Risks

- **`/swap_5792` approvals are undocumented.** The spike decides between the three options. Uniswap's own interface converts `/swap_5792` `calls` straight into a wallet batch, which suggests approvals are included.
- **Refund recipient.** Never pass `recipient`. The guard and the asset-change simulation catch any take or sweep to a foreign address.
- **Two routers.** They have separate Permit2 allowances, and mixing router versions breaks calldata, so the version header stays pinned.
- **Sepolia liquidity.** Pools are thin and mispriced (about 11.8× the Chainlink ETH/USD price at the time of writing). `NoRouteFound` and high price impact are expected at times, and the UI must surface them.
- **Quote freshness.** Classic quotes have no expiry. The 30 s TTL, the router's 30 min deadline (with the Permit2 approval expiring at it) and the slippage bound together limit stale execution.
- **Shared quota.** All users share the key's 6 req/s default limit, so the backend's global limiter and 429 mapping protect it.
- **Bundler simulation.** It only proves the batch doesn't revert. The asset-change simulation is the check on amounts.
- **App token scope.** The app token already deters only casual abuse, and it now also gates a quote proxy. The proxy never signs anything, and every call is re-verified on the device.

## Open items

- Whether to keep the hackathon's no-unit-test rule for this work. The plan assumes the repo's normal patterns: vitest in `agent/`, and Jest for the pure call guard.
- A Linear ticket for the epic, so branches and commits can carry a `PRA-###` number.
- Whether Swap should later move to the Trading API too, for real routing, or keep the pinned pool.

## Verification gate

Before "Pay with" is considered done:

1. `pnpm verify:pay-with` (from `agent/`) passes the asset-change assertions in both directions.
2. `agent/` tests and type checks pass, and `app/` type checks and lint pass.
3. On the deployed backend:
    - `/pay/quote` without a token returns 401;
    - a malformed body returns 400;
    - bursts return 429;
    - a valid request returns normalized calls, with no key anywhere.
4. On a device on Sepolia:
    - the same-asset send is unchanged and makes no `/pay/quote` request;
    - 10 USDC paid with ETH and 0.001 ETH paid with USDC both succeed.

   Etherscan must show that the payee received exactly the amount and that any refund returned to the Kernel. Activity shows one grouped row.
5. A tampered backend response (for example, a foreign call target) is refused before the passkey prompt.
