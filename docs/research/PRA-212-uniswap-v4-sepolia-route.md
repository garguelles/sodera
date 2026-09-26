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

The pinned values live in `app/src/wallet/sepolia.ts` as `SWAP_POOL_KEY` and `SWAP_POOL_ID`, next to the contract addresses.

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

The script reads `SEPOLIA_RPC_URL` (see `app/.env.example`). It imports the app's own pinned constants (`sepolia.ts`), quote module (`uniswap-quote.ts`) and swap-call builder (`uniswap-swap-calls.ts`), so it checks the code the app runs. It asserts the following:

1. The RPC reports chain ID `11155111`.
2. Every contract above, and USDC, has runtime bytecode.
3. The pool key's currencies are sorted, and `keccak256(abi.encode(SWAP_POOL_KEY))` equals `SWAP_POOL_ID`.
4. StateView reports a nonzero `sqrtPriceX96` and nonzero active liquidity.
5. `quoteSwap` returns a nonzero output for 0.001 ETH → USDC and for 1 USDC → ETH.
6. `buildSwapCalls` returns one call for ETH → USDC, sent to the Universal Router with exactly the input ETH. Its `eth_call` succeeds with a minimum output 0.5% below the quote. The call uses the `V4_SWAP` command with the `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL` and `TAKE_ALL` actions, and runs from a simulation account with a state-overridden ETH balance.
7. The same swap with a minimum one unit above the quote reverts with `V4TooLittleReceived(uint256,uint256)`, selector `0x8b063d73`.
8. `buildSwapCalls` returns three calls for USDC → ETH: USDC `approve` to Permit2, Permit2 `approve` to the Universal Router, and the swap. An `eth_simulateV1` run of that batch succeeds and pays the account at least the minimum ETH. It runs from a simulation account given a USDC balance by overriding FiatToken storage slot 9. Afterwards, both the USDC allowance to Permit2 and the Permit2 allowance to the router are zero.

Observed on 2026-09-26 through `https://ethereum-sepolia-rpc.publicnode.com`:

- Block: `11784134`
- Active liquidity: `31518589992329918`
- Pool price: 31,817.81 USDC per ETH
- 0.001 ETH → 31.81699 USDC
- 1 USDC → 0.000031428307909673 ETH
- ETH → USDC `eth_call`: succeeded
- Minimum above quote: reverted with `V4TooLittleReceived`
- 1 USDC → ETH batch (block `11784194`): every call succeeded, 0.000031428307909673 ETH was received (exactly the quote), and both allowances ended at zero

The script imports TypeScript modules, so it runs with `--experimental-strip-types` and a small resolver hook (`app/scripts/lib/register-ts-resolver.mjs`) for their extensionless relative imports. It was verified on Node 22.14, 24.12 and 25.8.
