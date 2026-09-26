# Uniswap SDK adoption plan

**Branch:** `refactor/PRA-174-uniswap-sdk`, created from `feat/PRA-174-uniswap-swaps` (PR #25). This is a test branch, and no pull request is planned yet.

## Goal

The working ETH ⇄ USDC swap currently encodes its Uniswap calls by hand with `viem` (see [the swap plan](uniswap-swaps.md)). This plan uses the Uniswap SDK wherever it fits, to make the code easier to read. It also adds a value the SDK provides for free: price impact.

Swap behaviour must not change, apart from the new price-impact display. The proven swap calldata must stay byte-for-byte identical.

## What the SDK covers

These facts were checked against the [`Uniswap/sdks`](https://github.com/Uniswap/sdks) source on 2026-09-26.

- **`@uniswap/sdk-core` 7.19.4:**
    - defines `ChainId.SEPOLIA = 11155111`;
    - maps Sepolia's `WETH9` to `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`;
    - provides `Ether`, `Token`, `CurrencyAmount`, `Percent` and `Price`.
- **`@uniswap/v4-sdk` 2.4.1** provides three pieces we can use:
    - **Pool identity:** `Pool.getPoolKey` and `Pool.getPoolId` sort the currencies and derive the pinned pool's key and ID.
    - **Trade model:** `Pool` and `Route` feed `Trade.createUncheckedTrade`, which is meant for amounts simulated elsewhere without tick data, as ours come from the Quoter. The trade gives the minimum received (`minimumAmountOut`), the rate (`executionPrice`) and price impact (`priceImpact`).
    - **Encoding:** `V4Planner` encodes the swap actions. Its default Universal Router v2.0 structs match the calldata already proven on Sepolia.
- **Not covered by any SDK:**
    - v4 quoting, so the V4 Quoter call stays on `viem`;
    - the on-chain Permit2 and USDC approvals;
    - Kernel batching;
    - RPC reads.
- **Cost:** the SDK brings in `ethers` v5, `jsbi`, `big.js` and `decimal.js-light`. None has been tried in this Expo/Hermes app yet.

## Conventions

- Make one commit per step: `{type}: PRA-174: {description}`, with no co-author trailer. Pause for review after each step.
- Pin new dependencies to exact versions. Install with pnpm 10 so the lockfile stays at `lockfileVersion: '9.0'`, and check that its diff only adds entries.
- For every commit, run `npx tsc --noEmit`, `npx expo lint` and `pnpm verify:uniswap` from `app/`. Add no new unit tests.

## Steps

1. **`chore: PRA-174: pin golden swap calldata`**
    - Before any refactor, extend `app/scripts/verify-uniswap-route.mjs` to build calls with the current `buildSwapCalls` for fixed inputs in both directions.
    - Record the resulting `to`, `value` and `data` as golden constants, and assert them on every run.
    - These constants are the byte-identical gate for step 3.
2. **`chore: PRA-174: add uniswap sdk currencies and pool key`**
    - Add `@uniswap/sdk-core@7.19.4` and `@uniswap/v4-sdk@2.4.1`.
    - Create `app/src/wallet/uniswap-sdk.ts`. It defines `SWAP_ETH` (`Ether.onChain(ChainId.SEPOLIA)`) and `SWAP_USDC` (a `Token` for the pinned USDC). It derives `SWAP_POOL_KEY` and `SWAP_POOL_ID` with `Pool.getPoolKey` and `Pool.getPoolId`.
    - Remove the hand-written key and ID from `app/src/wallet/sepolia.ts`.
    - Update the verify script. It keeps an expected pool-ID literal and its own `viem` derivation, so the SDK's result is checked independently.
    - **This step is the spike gate:**
        - Metro must bundle.
        - Sodera must run on a device with the swap screen quoting.
        - `verify:uniswap` must pass.
    - If bundling fails, stop and report, and drop the branch.
3. **`refactor: PRA-174: encode swaps with v4 planner`**
    - In `app/src/wallet/uniswap-swap-calls.ts`, replace the hand-written ABI tuples and the `0x060c0f` action bytes with `V4Planner`:
        1. `addAction(SWAP_EXACT_IN_SINGLE, ...)`
        2. `addAction(SETTLE_ALL, ...)`
        3. `addAction(TAKE_ALL, ...)`
        4. `finalize()`
    - Do not use `addTrade`. It emits the multi-hop `SWAP_EXACT_IN` action, which is different calldata.
    - Move the Universal Router, Permit2 and Quoter ABIs to `viem` `parseAbi` human-readable strings.
    - Keep the range guards, the `value === amountIn` rule, the approvals and the deadline.
    - **Gate:** the golden calldata matches, and both simulations pass.
4. **`refactor: PRA-174: model quotes as uniswap trades`**
    - In `app/src/wallet/uniswap-quote.ts`, `quoteSwap` keeps the V4 Quoter call and adds a StateView read of the pool's price and liquidity.
    - From these it builds a `Pool`, a `Route` and an unchecked exact-input `Trade`.
    - The minimum received comes from `trade.minimumAmountOut(new Percent(50, 10_000))`, which gives the same value as today's integer math.
    - The rate comes from `trade.executionPrice`, still shown as "1 ETH ≈ X USDC".
    - Price impact comes from `trade.priceImpact`.
    - Amount and rate formatting move to `CurrencyAmount` and `Price` with the current precision and round-down behaviour.
    - `parseSwapAmount` is unchanged, because the SDK has no input parser.
    - The verify script prints the minimum received and price impact, and checks that the minimum equals `amountOut × 9950 / 10000`.
5. **`feat: PRA-174: show swap price impact`**
    - In `app/src/components/swap-screen.tsx`, show a "Price impact" row on the entry details and the review, with a caution style above 1%.
    - Show the raw value in the review's technical details.
6. **`docs: PRA-174: document uniswap sdk usage`**
    - Update the README's Uniswap section to list the SDK pieces in use.
    - Add the latest verification output to the route research.
    - Revise `FEEDBACK.md` with the actual SDK experience in Expo.
    - Point the swap plan's "Why not the Uniswap API or SDKs" section to this plan.

## Verification gate

Before this branch is considered for review:

1. Every commit passes `tsc`, lint and `pnpm verify:uniswap`. From step 3 on, the golden calldata matches.
2. The app bundles and runs on a physical Android device.
3. One live swap in each direction succeeds from the device, and its review shows price impact.
4. The existing Jest failures (the `SoderaLauncher` native module and the launcher plugin test) are unchanged.
