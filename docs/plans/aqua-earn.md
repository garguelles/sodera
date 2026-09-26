# Earn with 1inch Aqua and SwapVM

## Goal

Replace the Earn placeholder (`app/src/app/earn.tsx`, which renders `PlatinumFeaturePreview`) with a working liquidity position on Ethereum Sepolia.

- From Earn, the Kernel account opens a USDC/WETH SwapVM AMM position through 1inch Aqua, with one passkey confirmation.
- The position earns swap fees when traders use it.
- The user closes it with a second confirmation.

The user's USDC and WETH never leave the wallet. Aqua only records virtual balances for the strategy, and tokens move only when a trader swaps.

Aqua replaces the Morpho vault for Earn (see [hackathon decisions](../hackathon-decisions.md#morpho-and-portfolio-data)). It targets the ETHGlobal Tokyo 1inch track, "Build an Aqua App". That track requires:

- official Aqua and SwapVM contracts;
- on-chain token transfers, shown through a UI or scripts;
- real git history.

Projects that use SwapVM score higher.

## Pinned contracts

Both contracts are 1inch's own Sepolia deployments. The evidence is in [the research note](../research/aqua-swapvm-sepolia.md).

| Item | Value |
| --- | --- |
| Aqua | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` |
| AquaSwapVMRouter | `0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE` ("1inch SwapVM v1.0") |
| Tokens | Circle USDC (`SEPOLIA_USDC_ADDRESS`), WETH (`SEPOLIA_WETH_ADDRESS`) |
| Price | Chainlink ETH/USD through `readEthUsdPrice` |

## Design

1. **Strategy.** A full-range constant-product (XYC) USDC/WETH pool with a 0.30% fee on the input amount:
   - program: `AquaXYCAmmStrategy.new().withFeeTokenIn(30).withSalt(salt).build()`;
   - order: `Order.new({ maker, program, traits: MakerTraits.default() })`.

   The salt is the open time, so each position has its own strategy hash. There is one open position per wallet.
2. **Aqua mode, no signatures.** `MakerTraits.default()` authorises the order through `Aqua.ship` from the Kernel account, so no ERC-1271 passkey signing is needed.
3. **Price from Chainlink.** The pool price is the ratio of the deposited balances. The user enters a USDC amount, and the app sizes the WETH side at the Chainlink price. The pool therefore opens at the price Sodera displays, and USD values are meaningful. This differs from the Uniswap pool, where they are not.
4. **Open batch.** One UserOperation:
   1. `WETH.deposit{value}`, only for the WETH the wallet lacks;
   2. `USDC.approve(Aqua, max)`;
   3. `WETH.approve(Aqua, max)`;
   4. `Aqua.ship(router, order, [USDC, WETH], [usdcAmount, wethAmount])`.
5. **Why the approvals are unlimited.** Aqua pulls from the wallet on every trade, so an exact approval would run out after enough trading and later trades would revert. Aqua can only pull within the virtual balances the maker shipped, and closing sets both approvals back to 0.
6. **Close batch.** One UserOperation:
   1. `Aqua.dock(router, strategyHash, [USDC, WETH])` (it must list every token);
   2. `USDC.approve(Aqua, 0)`;
   3. `WETH.approve(Aqua, 0)`.
7. **Reading positions.**
   - `Aqua.rawBalances(maker, router, strategyHash, token)` gives the current virtual balance of each token. A `tokensCount` of 255 (`0xff`) means the position is docked; 0 means it was never shipped.
   - *Earned vs holding* is the value of the current virtual balances minus the value of the opening amounts, both at the current Chainlink price. That is fees minus impermanent loss; round-trip trading makes it positive.
8. **Persistence.** One `expo-sqlite/kv-store` record holds the open position: order bytes, strategy hash, opening amounts, and open time. This follows `app/src/wallet/pending-sends.ts`. On-chain balances stay the source of truth.
9. **Home.** The position appears as a `WalletHomePosition` (protocol "1inch Aqua"). USDC and WETH balances show *available* amounts, meaning the wallet balance minus what the position has committed. That way the portfolio total counts each token once.
10. **SDK.** The app uses `@1inch/swap-vm-sdk` only to build the order. `ship`, `dock` and `rawBalances` are encoded with viem.
    - `@1inch/sdk-core` imports Node's `assert`, so the app adds the `assert` package for Metro.
    - If the SDK does not bundle, hand-encode the one fixed program and its traits, and check them against SDK-built golden vectors in the verify script.
11. **Reuse.** Follow the `swap-screen.tsx` patterns:
    - `createKernelPasskeyExecutionClient` and `KernelExecutionCall`;
    - `prepare()` only on Review, because it consumes sponsorship;
    - `reviewMatchesCalls`, the review TTL, the `executionInFlight` guard, and the AppState reset;
    - `markPersistedWalletIdentityDeployed`, the `walletHomeLiveProvider` and activity refreshes, and `sepoliaTransactionUrl`.

## Commits

All work lands on `feat/aqua-earn` as separate commits, in this order. There are no new unit tests. After each commit, run `npx tsc --noEmit`, `pnpm lint` and `pnpm test` from `app/`, plus `pnpm verify:aqua` once it exists.

1. **`docs: aqua earn plan and decisions`**: this plan, the research note, and the Morpho → Aqua decision in the hackathon decisions and ADR-0009.
2. **`feat: pin aqua swapvm sepolia route`**:
   - the Aqua and router addresses;
   - the `@1inch/swap-vm-sdk` and `assert` dependencies;
   - `app/src/wallet/aqua-strategy.ts` (`buildAquaOrder`);
   - `app/scripts/verify-aqua-earn.mjs` (`pnpm verify:aqua`), which checks contract code, `router.hash(order) == keccak256(order)`, and the fee encoding.
3. **`feat: aqua open and close calls`**:
   - `app/src/wallet/aqua-calls.ts`;
   - the verify script simulates open, then a trade from a second account, then close, and asserts that balances move and approvals end at 0.
4. **`feat: aqua position reads and home portfolio`**: `app/src/wallet/aqua-position.ts` (record, `rawBalances`, value, earned vs holding), wired into `wallet-home-live.ts`.
5. **`feat: earn screen`**: `app/src/components/earn-screen.tsx`, covering the open form, review, passkey confirmation, success, the open-position view, and close.
6. **`feat: aqua demo trader script`**: `app/scripts/aqua-demo-trade.mjs` (`pnpm demo:aqua-trade`). It finds the maker's latest `Shipped` order and swaps against it in both directions. It uses `AQUA_DEMO_TRADER_KEY`.
7. **`feat: committed funds guard`**: Send and Swap warn before spending USDC or WETH that the open position has committed.
8. *(Optional, cut first.)* **`feat: assistant earn actions`**: replace `vault_deposit` and `vault_withdraw` with `earn_open` and `earn_close` in both schemas, the policy, the plan encoder, and the prompt.

## Verification

1. `pnpm verify:aqua` passes against Sepolia.
2. On a device with a funded wallet:
   1. Open a 20 USDC position. The review shows the wrap, both approvals and `ship`.
   2. Etherscan shows `Shipped`, and the tokens are still in the wallet.
   3. Run `pnpm demo:aqua-trade -- --maker <account> --rounds 3`. Aqua emits `Pulled` and `Pushed`.
   4. Earn shows changed balances and a positive earned-vs-holding.
   5. Home shows the position and available balances.
   6. Close. Aqua emits `Docked`, and both approvals are 0.
3. Submission evidence: a README section, a demo video, and transaction links.
