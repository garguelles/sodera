# Uniswap Developer Feedback

Sodera is a seedless, passkey-controlled smart-account wallet and Android launcher. For ETHGlobal Tokyo we integrated Uniswap v4 swaps (ETH ⇄ USDC on Ethereum Sepolia). The user's ERC-4337 Kernel account calls the Universal Router directly, and one passkey confirmation executes the whole batch. This is what worked well, and what slowed us down.

## What worked well

- **Native ETH pools in v4.** Swapping against a pool whose `currency0` is native ETH removed the `WRAP_ETH` / `UNWRAP_WETH` steps entirely. ETH → USDC is a single Universal Router call sent with the input ETH.
- **Permit2 AllowanceTransfer suits smart accounts.** `Permit2.approve(token, spender, amount, expiration)` is an ordinary on-chain call. We batch it with the ERC-20 approval and the swap in one UserOperation, with no ERC-1271 typed-data signing. Using exact amounts and the swap deadline as expiry leaves no standing allowance after the swap.
- **The slippage failure is clear.** `V4TooLittleReceived(minAmountOutReceived, amountReceived)` made it easy to prove that the minimum-received guard works, and to explain failures to users.
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
4. **The Trading API does not fit smart-account wallets.**
   - `/swap` returns a single transaction for the swapper to send. For token input it typically returns a Permit2 message to sign.
   - An ERC-4337 wallet wants a list of calls (approvals plus swap) to batch into one UserOperation. It may not support off-chain typed-data signing at all.
   - Keeping the API key out of a mobile app bundle also requires a backend proxy.
   - *Suggestion:* a "calls" output mode (EIP-5792-style `calls[]`) that uses on-chain Permit2 approvals instead of signatures.
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
