# Uniswap Developer Feedback

Sodera is a seedless, passkey-controlled smart-account wallet and Android launcher. For ETHGlobal Tokyo we integrated Uniswap v4 swaps (ETH ⇄ USDC on Ethereum Sepolia). The user's ERC-4337 Kernel account calls the Universal Router directly, and one passkey confirmation executes the whole batch. This is what worked well, and what slowed us down.

## What worked well

- **Native ETH pools in v4.** Swapping against a pool whose `currency0` is native ETH removed the `WRAP_ETH` / `UNWRAP_WETH` steps entirely. ETH → USDC is a single Universal Router call sent with the input ETH.
- **Permit2 AllowanceTransfer suits smart accounts.** `Permit2.approve(token, spender, amount, expiration)` is an ordinary on-chain call. We batch it with the ERC-20 approval and the swap in one UserOperation, with no ERC-1271 typed-data signing. Using exact amounts and the swap deadline as expiry leaves no standing allowance after the swap.
- **The slippage failure is clear.** `V4TooLittleReceived(minAmountOutReceived, amountReceived)` made it easy to prove that the minimum-received guard works, and to explain failures to users.
- **The Trading API routes on Sepolia and is fast.** Exact-output quotes across v2/v3/v4 took about 0.6–1.1 s, and `/swap_5792` about 0.2–0.3 s. Routes regularly beat our pinned pool, and the v4 SDK's `V4BaseActionsParser` decoded every command we needed to verify.
- **The V4 Quoter plus `eth_simulateV1` gave us strong pre-flight checks.** We quote with `quoteExactInputSingle` and simulate the exact batch our wallet will send, including allowances returning to zero, before anyone signs.

## Friction and suggestions

1. **Testnet liquidity is hard to find, and it is mispriced.**
   - Uniswap does not seed testnet pools. The Sepolia ETH/USDC pools we found price ETH at roughly 11× the Chainlink feed. For example, about 31,800 USDC per ETH, against about 2,690.
   - Apps that value portfolios with oracles then show swaps as large gains or losses.
   - *Suggestion:* publish one maintained, reasonably priced reference pool per major pair on each supported testnet, and document it next to the deployments.
2. **v4 pools on testnets are hard to discover.**
   - GeckoTerminal does not index Uniswap v4 on Sepolia. The web app has no pool browser for testnets either, and `/positions` only shows your own positions.
   - We had to scan PoolManager `Initialize` events. That found 216 ETH/USDC pools, most of them empty, using about 140 different hook contracts. We then read liquidity through StateView to find a usable pool.
   - *Suggestion:* a testnet pool explorer, or a documented API or subgraph for v4 pools on Sepolia.
3. **The web app's testnet "market price" steers LPs to the wrong price.**
   - When we created a position at the real ETH price, the app pre-filled about 29,589 USDC per ETH. It then warned that our price was "91% less than market price", because it derives the market price from the same mispriced testnet pools.
4. **The Trading API fits smart-account wallets through `/swap_5792`, but its defaults are loose and several behaviours are undocumented.**
   - We first concluded the API did not fit an ERC-4337 wallet, because `/swap` returns one transaction and a Permit2 message to sign. That was wrong: `/swap_5792` returns EIP-5792 `calls[]` that batch straight into one UserOperation with no typed-data signing. Our "Pay with" feature uses it on Sepolia behind our backend, which keeps the key out of the app. Details: [`docs/research/trading-api-pay-with-sepolia.md`](docs/research/trading-api-pay-with-sepolia.md).
   - **The approvals are unlimited.** For USDC input the calls include `USDC.approve(Permit2, 2^256−1)` and `Permit2.approve(USDC, router, 2^160−1, +30 days)`. `permitAmount: EXACT` approves the *quoted* input rather than the slippage maximum, so any unfavourable move within slippage reverts. We keep only the router call and build approvals capped at `maxAmountIn` that expire at the deadline.
   - **The requested deadline is ignored.** The calldata always carried quote time + 30 minutes, whatever deadline we sent.
   - **Refunds go to `recipient`.** In an exact-output swap the leftover-input `SWEEP` pays the recipient, so paying a third party with `recipient` set would hand them the refund. We pass no recipient, swap into the account, and append our own transfer.
   - **Decoding needs the router version.** The calldata targets Universal Router 2.1.2 (`0x7E4f…43f3` on Sepolia), and `V4BaseActionsParser` must be told `URVersion.V2_1_2`; parsed as 2.0, the exact-output amounts come out garbled.
   - **`x-permit2-disabled` pointed at an undocumented proxy.** For USDC input it targeted `0x02E5…b2a9`, not the documented Sepolia proxy `0x0000…ffad`, again with an unlimited approval.
   - **Transient upstream timeouts return 404** (`UpstreamTimeoutError`), which looks like "no route" unless you read the error code. One retry cleared it.
   - *Suggestions:* an approval mode bounded to the maximum input and the deadline; honour the requested deadline; document the approval, refund and proxy behaviour of `/swap_5792`; return a 5xx for upstream timeouts.
5. **The SDKs read well, but they are heavy for a viem-first mobile app.**
   - We adopted `@uniswap/sdk-core` 7.19.4 and `@uniswap/v4-sdk` 2.4.1 to make the code easier to read.
   - **What worked well:**
     - `V4Planner` with `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL` and `TAKE_ALL` produced calldata byte-identical to our proven hand encoding, using the default Universal Router v2.0 structs.
     - `Trade.createUncheckedTrade` fits a flow driven by the Quoter. It gives `minimumAmountOut`, `executionPrice` and `priceImpact` without any tick data.
     - `Pool.getPoolKey` and `Pool.getPoolId` replaced our hard-coded pool ID.
   - **Install weight:** `v4-sdk` depends on `v3-sdk`, which pulls in `@uniswap/swap-router-contracts`, then `hardhat-watcher`, then `hardhat`, all as runtime dependencies. That added 173 packages and about 100 MB of native Hardhat binaries to a mobile app's install.
   - **Bundle weight:** our Android Hermes bundle grew by 1.56 MB, from 7.41 MB to 8.97 MB (+21%), from just the pieces we import.
     - Part of that is `ethers` v5's BIP-39 word lists, pulled in through `ethers/lib/utils`.
     - `ethers` also logs "Missing strong random number source" at startup in React Native.
   - **Node ESM:** the ESM builds use extensionless relative imports, and import JSON without `with { type: 'json' }`, so Node cannot load them. Our Node verification scripts load the CommonJS builds instead.
   - **Ergonomics:**
     - No SDK offers a v4 quote client.
     - `addTrade` emits the multi-hop `SWAP_EXACT_IN` action even for a single pool. We had to use `addAction(SWAP_EXACT_IN_SINGLE)` to match known-good calldata.
     - Amounts cross between `bigint` (viem) and strings or JSBI (SDK).
   - *Suggestion:* a slim v4 package without the v3 and Hardhat dependencies, with `bigint`-native types, Node-compatible ESM, and a V4 Quoter helper.
6. **Docs URLs and addresses are easy to get wrong.**
   - `docs.uniswap.org` links redirect to `developers.uniswap.org`, sometimes through a second `llms.mdx` redirect, and some older paths return 404.
   - Sepolia also has more than one Universal Router deployment. We had to verify each address against Etherscan, because search results mixed up the v3 Factory and the Universal Router.
   - *Suggestion:* stable deployment URLs, plus a machine-readable deployments JSON per chain.
7. **The V4 Quoter's typing is awkward.**
   - `quoteExactInputSingle` is `nonpayable` and must be called through `eth_call`. viem's typed `readContract` rejects it, so clients need `simulateContract`.
   - *Suggestion:* a sentence in the quoting guide saying so would save time.
