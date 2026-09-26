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

## Pull requests

Create each branch from a fast-forwarded `main`. Commits follow `{type}: {PRA-###}: {description}` (or `{type}: {description}` for untracked work), with no co-author trailer.

1. **Feasibility spike (the go/no-go gate).**
    - Files: `app/scripts/verify-pay-with-route.mjs`, a `verify:pay-with` script in `app/package.json`, and `docs/research/…-trading-api-pay-with.md`.
    - The script calls the API directly with a local `UNISWAP_API_KEY` read from `.env.local`. The file is git-ignored; this is the only place the app side ever holds a key. `swapper` is set to a Kernel address, and `x-universal-router-version: 2.1.2` is pinned.
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
2. **Backend quote endpoint.**
    - Files: `agent/src/uniswap-trading.ts` (API client), `agent/src/pay-quote.ts` and its schema, the route in `agent/src/app.ts`, dependencies in `agent/src/server.ts`, `UNISWAP_API_KEY` in `agent/.env.example`, `agent/README.md`, and vitest tests with a faked `fetch`.
    - `POST /pay/quote`, authenticated with the existing app token.
    - Request: `{ account, payAsset: 'ETH' | 'USDC', receiveAsset, amountOut }`, where `amountOut` is a base-unit string. Zod rejects matching assets, zero or oversized amounts, and unknown assets.
    - Fixed server-side:
        - chain `11155111` and token addresses;
        - `type: EXACT_OUTPUT` and `protocols: [V2, V3, V4]`;
        - `slippageTolerance: 0.5` and router version 2.1.2;
        - the call option chosen in the spike;
        - `deadline` = now + 10 min;
        - **no `recipient`**.
    - Normalized response: `{ quoteId, requestId, quotedAt, deadline, amountIn, maxAmountIn, amountOut, route, priceImpact, calls: [{ to, value, data }], approvals: [{ token, spender, amount }] }`. The key, upstream headers and raw body never appear in responses or logs. Logs mask the account and keep the Uniswap `requestId`.
    - Operations:
        - 8 s upstream timeout;
        - per-account and per-IP limits, plus a global limit of 5 req/s or less to stay under the key's quota;
        - errors: `NoRouteFound` maps to 422 `no_route`, upstream 429 to 503 `busy` with `retry-after`, a timeout to 504, and anything else to 502.
    - Acceptance: vitest covers auth, validation, rate limits, error mapping, and that the key never appears in responses. A smoke test passes on Railway with the env var set.
3. **App call guard.**
    - Files: `app/src/wallet/pay-with-swap.ts`, `payQuote` in the agent client (zod-parsed response with a timeout), and the Trading Universal Router (and proxy, if chosen) addresses in `app/src/wallet/sepolia.ts`.
    - Treat every call from the API as untrusted:
        - Targets must be on an allowlist: USDC, Permit2 or the proxy, and the Trading Universal Router.
        - USDC calls may only `approve` Permit2 or the proxy, for no more than `maxAmountIn`.
        - Permit2 approvals must be for the router, at most `maxAmountIn`, and expire within 1 hour.
        - The router call must use the `execute(bytes,bytes[],uint256)` selector, with a deadline in the future and no more than 10 minutes out.
        - Total ETH value may not exceed `maxAmountIn`, and must be 0 when paying with USDC.
    - Decode the `V4_SWAP` input with `@uniswap/v4-sdk`'s `V4BaseActionsParser`. Verify the swap actions, the exact output amount and the maximum input, and that nothing is taken or swept to anyone but the Kernel. Commands the parser can't decode (v2/v3 legs) fall back to the target, selector and value checks plus the asset-change simulation.
    - `buildPayWithCalls(quote, transfer)` returns `[...guardedCalls, transfer.call]`, reusing `parseSendTransfer` from `app/src/wallet/send-transfer.ts`. This is the same batching pattern as `app/src/agent/plan-encoder.ts`.
    - Acceptance: each tampered case is rejected before any passkey prompt: a foreign target, an oversized approval, excess ETH value, a stale deadline, a wrong selector, or a foreign take or sweep.
4. **Send UI.**
    - Files: `app/src/components/send-screen.tsx` and `app/src/wallet/send-transfer.ts`.
    - Add a "Pay with" selector on the amount step. When it matches the asset being sent, the existing path runs unchanged and nothing calls `/pay/quote`.
    - Generalize the one-call echo check (`send-screen.tsx:158`) into `assertPreparedCallsMatch(expected, prepared)` for any number of calls.
    - After `prepare`, run an asset-change simulation. It must show the payee receiving exactly the amount and the Kernel spending no more than `maxAmountIn`; otherwise the payment is blocked.
    - The review shows:
        - "Recipient gets exactly X"
        - "You pay at most Y (est. Z)"
        - the route
        - price impact, with a warning above 2% and a block above 10%
        - approvals being granted
        - the sponsored network fee
        - a note that testnet pricing differs from the market
    - Use the Platinum Fluid tokens from `app/src/constants/theme.ts`, and place status notices above the primary button, as on the swap screen.
    - Freshness:
        - A quote is refetched if it is older than 30 s when entering review.
        - The review expires 30 s after its quote; Confirm then re-quotes and prepares again.
    - Errors (`no_route`, `busy`, timeout) offer "Pay with <same asset> instead".
    - Acceptance: live device payments in both directions, and the same-asset path is unchanged.
5. **Activity grouping.**
    - Files: `app/src/wallet/transaction-activity*.ts`, `user-operation-calls.ts` and `pending-sends.ts`.
    - Today a pay-with transaction would show up as several rows (swap legs through the router and pool, plus the transfer). Group rows by UserOperation hash when the operation calls the Trading Universal Router, and show one row: "Paid X to <payee> (swapped from Y)".
    - Pending sends store `payAsset` and `maxAmountIn` so the pending row renders the same way.
6. **Docs.**
    - `docs/plans/uniswap-swaps.md`: correct "Why not the Uniswap API or SDKs" (`/swap_5792` and permit-as-transaction exist).
    - `FEEDBACK.md`: rewrite item 4 with the spike's findings.
    - `README.md`: Swap uses the pinned v4 pool and router 2.0; "Pay with" uses the Trading API through the backend and router 2.1.2.

## Risks

- **`/swap_5792` approvals are undocumented.** The spike decides between the three options. Uniswap's own interface converts `/swap_5792` `calls` straight into a wallet batch, which suggests approvals are included.
- **Refund recipient.** Never pass `recipient`. The guard and the asset-change simulation catch any take or sweep to a foreign address.
- **Two routers.** They have separate Permit2 allowances, and mixing router versions breaks calldata, so the version header stays pinned.
- **Sepolia liquidity.** Pools are thin and mispriced (about 11.8× the Chainlink ETH/USD price at the time of writing). `NoRouteFound` and high price impact are expected at times, and the UI must surface them.
- **Quote freshness.** Classic quotes have no expiry. The 30 s TTL, the 10 min deadline and the slippage bound together limit stale execution.
- **Shared quota.** All users share the key's 6 req/s default limit, so the backend's global limiter and 429 mapping protect it.
- **Bundler simulation.** It only proves the batch doesn't revert. The asset-change simulation is the check on amounts.
- **App token scope.** The app token already deters only casual abuse, and it now also gates a quote proxy. The proxy never signs anything, and every call is re-verified on the device.

## Open items

- Whether to keep the hackathon's no-unit-test rule for this work. The plan assumes the repo's normal patterns: vitest in `agent/`, and Jest for the pure call guard.
- A Linear ticket for the epic, so branches and commits can carry a `PRA-###` number.
- Whether Swap should later move to the Trading API too, for real routing, or keep the pinned pool.

## Verification gate

Before "Pay with" is considered done:

1. `pnpm verify:pay-with` passes the asset-change assertions in both directions.
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
