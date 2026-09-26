# PRA-212: Uniswap v4 Sepolia swap route

Research date: 2026-09-26

## Decision

Swap ETH ⇄ USDC on Ethereum Sepolia through this existing Uniswap v4 pool:

- Network: Ethereum Sepolia, chain ID `11155111`
- Pool key:
  - `currency0`: `0x0000000000000000000000000000000000000000` (native ETH)
  - `currency1`: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (Circle Sepolia USDC, see [the asset research](sepolia-usdc-wbtc-assets.md))
  - `fee`: `20` (0.002%)
  - `tickSpacing`: `1`
  - `hooks`: `0x0000000000000000000000000000000000000000` (no hook)
- Pool ID: `0xc743656d27fde4e2d5895e878557aaa56dd48c8656d25e9db35ba10b1fe3d824`

The swap uses these Uniswap contracts. They are listed in the [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), and each was checked for runtime bytecode on Sepolia:

| Contract | Address |
| --- | --- |
| Universal Router | [`0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`](https://sepolia.etherscan.io/address/0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b) |
| V4 Quoter | [`0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227`](https://sepolia.etherscan.io/address/0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227) |
| StateView | [`0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C`](https://sepolia.etherscan.io/address/0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C) |
| PoolManager | [`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543) |
| Permit2 | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://sepolia.etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |

The contract addresses live in `app/src/wallet/sepolia.ts`. The pool key and ID are derived in `app/src/wallet/uniswap-sdk.ts` with the Uniswap SDK's `Pool.getPoolKey` and `Pool.getPoolId`.

## Why this pool

Uniswap pools are permissionless, and Uniswap Labs does not seed testnet liquidity ([Create a pool on Uniswap v4](https://developers.uniswap.org/docs/protocols/v4/guides/create-pool)). This pool was found by scanning PoolManager `Initialize` events on Sepolia for pools pairing the pinned USDC with ETH or WETH. That scan found 216 such pools, 60 of which have no hook. Most of them are empty.

This pool was chosen because:

- it is the deepest pool found, with about 182.7 ETH and 5.44M USDC active at the current tick;
- it has no hook, so swaps follow core Uniswap v4 behavior;
- it uses native ETH, so no WETH wrapping is needed.

GeckoTerminal does not index Uniswap v4 on Sepolia. Its pool listings cannot be used to judge v4 liquidity there.

## Caveats

- The pool prices ETH at about 11× the Chainlink ETH/USD feed that Sodera uses for portfolio values. Swap screens should show token amounts and the pool rate, not USD values.
- The price moves as others trade the pool. It was about 29,767 USDC per ETH on 2026-09-26 during planning, and 31,817.81 at the verification block below.
- Other developers own the liquidity and could withdraw it. Run the verification before relying on the route, especially before a demo.
- Replacing the pool with a team-owned one only changes `SWAP_POOL_KEY` and `SWAP_POOL_ID`.

## Live verification

Run from `app/`:

```sh
pnpm verify:uniswap
```

The script reads `SEPOLIA_RPC_URL` (see `app/.env.example`). It imports the app's own modules: the addresses (`sepolia.ts`), the SDK pool key and ID (`uniswap-sdk.ts`), quotes (`uniswap-quote.ts`) and the swap-call builder (`uniswap-swap-calls.ts`). That way it checks the code the app runs. It asserts the following:

1. The RPC reports chain ID `11155111`.
2. Every contract above, and USDC, has runtime bytecode.
3. The pool key's currencies are sorted. `keccak256(abi.encode(SWAP_POOL_KEY))` and the SDK's `Pool.getPoolId` both equal the pinned pool ID.
4. For fixed inputs, `buildSwapCalls` reproduces the golden calldata of the original hand-encoded builder in both directions. The golden values are keccak256 hashes of each call's data, plus its target and value.
5. StateView reports a nonzero `sqrtPriceX96` and nonzero active liquidity.
6. `quoteSwap` returns a nonzero output for 0.001 ETH → USDC and for 1 USDC → ETH. The minimum received from the SDK trade is exactly `amountOut × 9950 / 10000`, and the script prints the trade's price impact.
7. `buildSwapCalls` returns one call for ETH → USDC, sent to the Universal Router with exactly the input ETH. Its `eth_call` succeeds with a minimum output 0.5% below the quote. The call uses the `V4_SWAP` command with the `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL` and `TAKE_ALL` actions, and runs from a simulation account with a state-overridden ETH balance.
8. The same swap with a minimum one unit above the quote reverts with `V4TooLittleReceived(uint256,uint256)`, selector `0x8b063d73`.
9. `buildSwapCalls` returns three calls for USDC → ETH: USDC `approve` to Permit2, Permit2 `approve` to the Universal Router, and the swap. An `eth_simulateV1` run of that batch succeeds and pays the account at least the minimum ETH. It runs from a simulation account given a USDC balance by overriding FiatToken storage slot 9. Afterwards, both the USDC allowance to Permit2 and the Permit2 allowance to the router are zero.

Observed on 2026-09-26 through `https://ethereum-sepolia-rpc.publicnode.com`:

- Block: `11784134`
- Active liquidity: `31518589992329918`
- Pool price: 31,817.81 USDC per ETH
- 0.001 ETH → 31.81699 USDC
- 1 USDC → 0.000031428307909673 ETH
- ETH → USDC `eth_call`: succeeded
- Minimum above quote: reverted with `V4TooLittleReceived`
- 1 USDC → ETH batch (block `11784194`): every call succeeded, 0.000031428307909673 ETH was received (exactly the quote), and both allowances ended at zero

The script imports TypeScript modules, so it runs with `--experimental-strip-types` and a small resolver hook (`app/scripts/lib/register-ts-resolver.mjs`). The hook resolves the modules' extensionless relative imports. It also loads the Uniswap SDKs' CommonJS builds, because their ESM builds only work in bundlers. It was verified on Node 22.14, 24.12 and 25.8.

With the SDK (block `11784594`), the golden calldata matched in both directions. The price impact of 0.001 ETH → USDC and 1 USDC → ETH was under 0.01% each. Live quotes also showed about 0.29% for 0.5 ETH, 0.57% for 1 ETH, and 1.12% for 2 ETH, which the app flags as high.

## Live swaps

Swaps executed by the Sodera app from a passkey-controlled Kernel account ([`0xFbf2213c7F5DE314729293fF1B541F8591637658`](https://sepolia.etherscan.io/address/0xFbf2213c7F5DE314729293fF1B541F8591637658)) through EntryPoint v0.7. Every UserOperation was sponsored through ZeroDev, by the `SingletonPaymasterV7` contract (`0x777777777777AeC03fd955926DbF81597e66834C`):

| Direction | Transaction | Result |
| --- | --- | --- |
| ETH → USDC | [`0x9b75ba46258116210043604a65f3a30f0684fd4b57cfdcd36839465504e3faf0`](https://sepolia.etherscan.io/tx/0x9b75ba46258116210043604a65f3a30f0684fd4b57cfdcd36839465504e3faf0) | 0.1 ETH → 3,179.920816 USDC on 2026-09-26 at 05:57 UTC. |
| USDC → ETH | [`0x4a1d948edede137eb61f644cfaaeb8eaa0589da5f3c3247b2607b59e84b4faab`](https://sepolia.etherscan.io/tx/0x4a1d948edede137eb61f644cfaaeb8eaa0589da5f3c3247b2607b59e84b4faab) | 2 USDC → 0.000062856582279472 ETH on 2026-09-26 at 05:52 UTC. |
| USDC → ETH | [`0x80e6031700477a5503a900196fd22fb4824f4012df8757e8b400dcf084005dbe`](https://sepolia.etherscan.io/tx/0x80e6031700477a5503a900196fd22fb4824f4012df8757e8b400dcf084005dbe) | 1 USDC → 0.000031428307909673 ETH on 2026-09-26 at 05:48 UTC, the exact quoted output. It was the account's first UserOperation, so it also deployed the Kernel account. |
