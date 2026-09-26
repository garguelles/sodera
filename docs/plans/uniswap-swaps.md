# Uniswap swaps plan

**Deadline:** Sunday, September 27, 2026 at 09:00 JST (September 27 at 00:00 UTC).

## Goal and pinned route

Replace the Swap placeholder (`app/src/app/swap.tsx`, which renders `FeaturePreview`) with a working ETH ⇄ USDC swap on Ethereum Sepolia. The Kernel smart account executes the swap through Uniswap v4 after the usual review and passkey confirmation. This covers [PRA-174](https://linear.app/pragmacollective/issue/PRA-174/spec-uniswap-swaps) and its tickets PRA-212 to PRA-215. Hooks, Uniswap SDKs, arbitrary tokens, and additional pairs are out of scope.

Use this pool and these contracts. Each value was checked with read-only calls on September 26, 2026. Recheck them before the demo because testnet liquidity can change.

| Item | Value |
| --- | --- |
| Pool | Uniswap v4, native ETH / USDC, fee `20` (0.002%), tick spacing `1`, no hook |
| `currency0` | `0x0000000000000000000000000000000000000000` (native ETH) |
| `currency1` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (Circle Sepolia USDC, `SEPOLIA_USDC_ADDRESS`) |
| `hooks` | `0x0000000000000000000000000000000000000000` |
| Pool ID | `0xc743656d27fde4e2d5895e878557aaa56dd48c8656d25e9db35ba10b1fe3d824` |
| Depth and price | About 182.7 ETH and 5.44M USDC active at the current tick; about 29,767 USDC per ETH |
| UniversalRouter | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` |
| V4Quoter | `0x61b3f2011a92d183c7dbadbda940a7555ccf9227` |
| StateView | `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Both directions are proven by simulation:

- Quotes: 0.001 ETH returns 29.766727 USDC, and 10 USDC returns 0.000335929666513180 ETH.
- ETH to USDC: one `UniversalRouter.execute` call with `value = amountIn` succeeds. A minimum output that is too high reverts with `V4TooLittleReceived(uint256,uint256)`.
- USDC to ETH: the three-call batch below succeeds under `eth_simulateV1`, and the sender receives exactly the quoted wei.

The pool prices ETH at about 11× the Chainlink price that Sodera displays. Other testers created the pool, and nobody arbitrages its price on testnet. The swap screen therefore shows token amounts and the pool rate only, never USD values.

## Approach

1. Call the Universal Router `V4_SWAP` command (`0x10`) directly, with calldata hand-encoded by `viem`. Do not add `@uniswap/*` packages. The input is `abi.encode(bytes actions, bytes[] params)` with actions `0x060c0f` (`SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL`, `TAKE_ALL`). The params are:
    1. `ExactInputSingleParams{poolKey, zeroForOne, uint128 amountIn, uint128 amountOutMinimum, hookData: 0x}`
    2. `(currencyIn, amountIn)`
    3. `(currencyOut, amountOutMinimum)`

   `TAKE_ALL` pays the caller, which is the Kernel account.
2. ETH to USDC is one call: `UniversalRouter.execute` with `zeroForOne = true` and `value` exactly equal to `amountIn`. Any excess ETH would stay in the router, where anyone could sweep it.
3. USDC to ETH is always three batched calls in one UserOperation:
    1. `USDC.approve(Permit2, amountIn)`
    2. `Permit2.approve(USDC, UniversalRouter, uint160 amountIn, uint48 deadline)`
    3. `UniversalRouter.execute(..., zeroForOne = false)`

   Both allowances are exact and return to zero after the swap. Both approvals overwrite the previous amount. Use the Permit2 allowance mode only; never Permit2 signatures.
4. Use one deadline, `now + 10 minutes`, for both the router deadline and the Permit2 expiration.
5. Fix slippage at 50 basis points. Compute `amountOutMinimum` from a fresh quote taken when the user taps Review, never from the quote shown on the entry screen.
6. Quote with `V4Quoter.quoteExactInputSingle` through `simulateContract`; the function is non-view but safe under `eth_call`.
7. Call `prepare()` only when the user taps Review, because each prepare consumes the shared sponsorship allowance. Debounced entry quotes must never prepare.
8. Parse amounts strictly before calling `parseUnits`:
    - accept at most 18 decimals for ETH and 6 for USDC;
    - reject zero, an empty string, and a bare `.`;
    - accept `,` as a decimal separator;
    - reject amounts above the balance of the input asset.

   Gas is sponsored, so a full-balance swap is allowed.
9. Keep swap activity as the existing two rows (sent and received with the same transaction hash). Do not add swap grouping. The self-funded fallback remains out of scope because send does not have one either.
10. Keep the pool in a single constant, `SWAP_POOL_KEY`, so that switching pools before the demo is a one-line change.
11. Reuse existing code rather than building a second transaction engine:
    - `createKernelPasskeyExecutionClient` and `KernelExecutionCall` from `app/src/wallet/kernel-passkey-execution.ts`;
    - the patterns in `app/src/components/send-screen.tsx`: injected dependencies, the invocation ref, the `executionInFlight` guard, the AppState reset, `describeError` redaction, `shortenHash`, and `markPersistedWalletIdentityDeployed`;
    - `sepoliaTransactionUrl`, `walletHomeLiveProvider.refresh()`, and `blockscoutTransactionActivityProvider.refresh()`.

## Why not the Uniswap API or SDKs

Direct contract calls encoded with `viem` are the smallest proven path for one pinned pool before the deadline. Integrating the Uniswap v4 contracts directly already satisfies the bounty's requirement to "integrate any part of the Uniswap stack".

The Uniswap Trading API is not used for these reasons:

- The key would be public. `EXPO_PUBLIC_*` values are embedded in the APK, so using the key safely requires a backend proxy.
- It does not fit a smart account. The `/swap` endpoint returns one transaction for a wallet that signs it directly. For token input it typically also expects a Permit2 signature. Sodera instead batches calls into one Kernel UserOperation, and Kernel passkey signing of typed data (ERC-1271) is not built.
- It chooses its own route, so it cannot guarantee the pinned pool or a team-created demo pool.
- On Sepolia it routes through the same thin, mispriced testnet pools, so it adds no liquidity.

The Uniswap SDKs (`@uniswap/sdk-core`, `@uniswap/v4-sdk`, `@uniswap/universal-router-sdk`) are not used for these reasons:

- Their value would go unused. It lies in route encoding, pool math, and multi-hop support, but this swap uses one fixed pool and one fixed action sequence. Quotes and approvals would remain direct contract calls even with the SDKs.
- They add dependencies. They pull `ethers` v5, `jsbi`, and several `@uniswap/*` packages in beside `viem`, and none of them has been tried in this Expo/React Native app, which may need polyfills or bundler changes.
- Their defaults can drift from the deployed contracts. The SDK defaults follow the latest Universal Router ABI, which must match the router deployed on Sepolia.
- The hand-encoded calldata is already proven. Both directions were simulated against the pinned pool, and `pnpm verify:uniswap` re-runs those simulations.

Revisit this when Sodera supports more tokens or mainnet. Routing is the hard part of multi-token swaps, and the core SDKs do not route. Uniswap's routing library, `smart-order-router`, targets Node servers rather than a mobile app. The likely design is:

1. The Uniswap Trading API behind a small backend proxy that holds the existing API key supplies quotes and routes.
2. Optionally, the SDKs encode the chosen route.
3. The swap screen, review, and passkey flow stay unchanged. Quoting and call building remain isolated in `uniswap-quote.ts` and `uniswap-swap-calls.ts`.

## Pull requests

Do not write unit tests for this hackathon build. Verify each PR with `npx tsc --noEmit` and `pnpm lint` from `app/`, keep the existing `pnpm test` suite passing, run `pnpm verify:uniswap` for on-chain checks, and exercise the screen on a device or emulator. Live device swaps in both directions are the acceptance evidence.

Create each branch from a fast-forwarded `main` and name it `{type}/PRA-###-short-description`. PR titles follow `[ETHGlobal Tokyo] {type}: PRA-###: description`. The critical path is PR 1, then PRs 2 and 3 in parallel, then PR 4, PR 5, and PR 6.

1. **`feat: PRA-212: pin uniswap v4 sepolia route`**, with no dependencies.
    - Files:
        - `app/src/wallet/sepolia.ts`: the UniversalRouter, V4Quoter, Permit2, PoolManager, and StateView addresses, plus `SWAP_POOL_KEY`
        - `app/scripts/verify-uniswap-route.mjs`, in the style of `app/scripts/verify-kernel-live.mjs`
        - `app/package.json`: a new `verify:uniswap` script
        - `docs/research/PRA-212-uniswap-v4-sepolia-route.md`: the evidence
    - The script checks that:
        - every contract has bytecode;
        - `keccak256(abi.encode(SWAP_POOL_KEY))` equals the pinned pool ID;
        - StateView reports liquidity above zero;
        - both directions quote;
        - an `eth_call` of ETH to USDC succeeds.
    - Acceptance: `pnpm verify:uniswap` passes against Sepolia.
2. **`feat: PRA-212: swap quotes and amount parsing`**, depending on PR 1.
    - Files: `app/src/wallet/uniswap-quote.ts`.
    - Export `parseSwapAmount(direction, text, balance)` and `quoteSwap(client, { direction, amountIn })`. The quote returns `amountOut`, `minAmountOut` (50 basis points), and `rate`.
    - The client parameter uses a narrow structural type, like `SepoliaBalanceClient` in `wallet-home-live.ts`. The default client is created lazily and checks the chain ID.
    - Check by hand on the entry screen in PR 4: decimal limits, zero and empty input, and the balance limit.
3. **`feat: PRA-213: universal router swap calls`**, depending on PR 1.
    - Files: `app/src/wallet/uniswap-swap-calls.ts`, plus the verify script.
    - Export `buildSwapCalls({ direction, amountIn, minAmountOut, deadline })`, which returns `KernelExecutionCall[]`: one call for ETH to USDC and three for USDC to ETH.
    - The builder asserts that `value === amountIn` and that the amount and deadline fit uint160 and uint48.
    - Extend `verify-uniswap-route.mjs` to simulate the USDC to ETH batch with `eth_simulateV1`, or with an anvil fork using `anvil_dealERC20`. It must confirm that both allowances end at zero.
4. **`feat: PRA-213: swap entry screen`**, depending on PR 2.
    - Files: `app/src/components/swap-screen.tsx` and `app/src/app/swap.tsx`. Keep `FeaturePreview` because Earn still uses it.
    - The screen provides:
        - an ETH/USDC direction toggle, an amount field, and the input-asset balance;
        - a 400 ms debounced quote that discards stale results;
        - the estimated and minimum received amounts and the pool rate.
    - Review stays disabled in this PR, so the merged screen is a working live-quote demo.
    - Inject `quote` and `readBalances` as props.
    - Check on a device that typing quickly never shows an older quote, and that validation messages appear.
5. **`feat: PRA-213: swap review and passkey execution`**, depending on PRs 3 and 4.
    - On Review, the screen:
        1. takes a fresh quote and builds the calls;
        2. runs `prepare()`;
        3. checks that the review echoes the exact call count, and each call's `to`, `value`, and `data`;
        4. shows the review.
    - The friendly review rows are:
        - You pay
        - You receive (estimated)
        - Minimum received
        - Slippage 0.5%
        - Approvals granted, with exact USDC amounts and expiry, for USDC to ETH only
        - Network
        - Network fee: Sponsored
        - Wallet setup, shown when `deploymentRequired` is true
    - The collapsible details list every call, the pool ID, the deadline, and the UserOperation fields.
    - Confirm with the passkey, then show the success screen with a copy action and an explorer link.
    - After success:
        - call `markPersistedWalletIdentityDeployed`;
        - refresh `walletHomeLiveProvider` and `blockscoutTransactionActivityProvider`.
    - Carry over from send:
        - the AppState review reset;
        - the double-tap guard;
        - RPC-redacting errors.
    - Acceptance: live device swaps succeed in both directions and their transaction hashes are recorded.
6. **`feat: PRA-215: uniswap feedback and submission evidence`**, depending on PR 5.
    - Add the bounty artifacts required by `docs/sodera.md` §52.3:
        - `FEEDBACK.md`
        - a Uniswap section in `README.md` pointing to the integration files and the pinned pool
        - the live transaction hashes, added to the PRA-212 research document
    - This PR must merge before the deadline.
7. **`feat: PRA-214: swap expiry and error handling`**, depending on PR 5. Cut this first if time runs short.
    - Add a 60-second review time-to-live that returns the user to entry for a fresh quote.
    - Show friendly messages for:
        - `V4TooLittleReceived` ("price moved beyond your slippage");
        - an expired deadline;
        - a sponsorship refusal.
    - Check on a device that an expired review returns to entry and that the error messages read correctly.

## Open items

- Decide before the demo whether to keep the pinned pool or create a team-owned pool priced near Chainlink. Pool creation takes a Uniswap web-app position on a non-standard fee tier with a starting price near 2,692 USDC per ETH. A team pool is cheaper than every other Sepolia pool, so routed trades or arbitrage can drain it; seed it shortly before the demo and recheck it.
- If the deadline tightens, cut PR 7 first. PRs 1 to 6 are the minimum demonstrable path.
- Record in `FEEDBACK.md` that the Uniswap web app pre-fills testnet market prices, that GeckoTerminal does not index v4 on Sepolia, and any other integration friction.

## Submission gate

Before submission:

1. From `app/`, run `pnpm verify:uniswap`, `npx tsc --noEmit`, `pnpm lint`, and the existing `pnpm test` suite.
2. Complete one live swap in each direction from a funded Kernel account on a physical device, confirmed with the passkey.
3. Confirm that the wallet balances and the activity rows update after each swap.
4. Confirm that both transaction hashes appear in the research document and `README.md`.
5. Confirm that `FEEDBACK.md` exists.

Do not describe the swap as working if either direction lacks a confirmed Sepolia transaction.
