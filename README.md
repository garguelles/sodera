# Sodera

Sodera is a seedless smart-account wallet and Android home launcher. This repository contains five independently installable applications.

## Applications

| Directory | Purpose |
| --- | --- |
| [`app/`](app/) | Expo SDK 57 mobile application and Android home launcher |
| [`landing/`](landing/) | React landing site and passkey domain host for `sodera.xyz` |
| [`agent/`](agent/) | Hono service that turns wallet requests into reviewable plans with Claude |
| [`ens/`](ens/) | Local ENSv2 namespace owner tool and read-only Sepolia checks |
| [`api/`](api/) | Separate ENS and Uniswap Hono API service entrypoints |

Each application owns its package manifest, lockfile, dependencies, commands, and deployment configuration. There is no repository-root JavaScript workspace or install command.

## Development

Install and run the mobile application from `app/`:

```bash
cd app
pnpm install
pnpm start
```

Install and run the landing site from `landing/`:

```bash
cd landing
pnpm install
pnpm dev
```

For namespace setup, run the standalone owner tool from `ens/`; see its [README](ens/README.md). For the ENS availability API or your teammate's Uniswap routes, see [`api/README.md`](api/README.md). See the application READMEs for verification, native development, Digital Asset Links, and deployment instructions.

## Uniswap Integration

Sodera's wallet swaps ETH ⇄ USDC on Ethereum Sepolia through Uniswap v4. The user's passkey-controlled Kernel smart account (ERC-4337, sponsored gas) calls the Uniswap contracts directly. The Uniswap SDK (`@uniswap/sdk-core`, `@uniswap/v4-sdk`) supplies the currencies, the pool key, the trade math (minimum received, rate and price impact) and the `V4Planner` swap encoding. `viem` makes the V4 Quoter call, encodes the approvals and handles RPC. The Uniswap Trading API is not used. One passkey confirmation executes the whole swap, including the approvals for USDC → ETH.

| What | Where |
| --- | --- |
| Uniswap contract addresses | [`app/src/wallet/sepolia.ts`](app/src/wallet/sepolia.ts) |
| SDK currencies, and the pinned pool key and ID (`Pool.getPoolKey` / `Pool.getPoolId`) | [`app/src/wallet/uniswap-sdk.ts`](app/src/wallet/uniswap-sdk.ts) |
| V4 Quoter quotes as SDK trades (minimum received, rate, price impact), and amount parsing | [`app/src/wallet/uniswap-quote.ts`](app/src/wallet/uniswap-quote.ts) |
| `V4Planner` swap encoding for the Universal Router `V4_SWAP` command, and exact-amount Permit2 approvals | [`app/src/wallet/uniswap-swap-calls.ts`](app/src/wallet/uniswap-swap-calls.ts) |
| Swap screen, review, and passkey execution | [`app/src/components/swap-screen.tsx`](app/src/components/swap-screen.tsx) |
| Live verification script (`pnpm verify:uniswap` from `app/`) | [`app/scripts/verify-uniswap-route.mjs`](app/scripts/verify-uniswap-route.mjs) |
| Route research, contracts, and evidence | [`docs/research/PRA-212-uniswap-v4-sepolia-route.md`](docs/research/PRA-212-uniswap-v4-sepolia-route.md) |
| Build plan and design decisions | [`docs/plans/uniswap-swaps.md`](docs/plans/uniswap-swaps.md) |
| Uniswap SDK adoption plan | [`docs/plans/uniswap-sdk-adoption.md`](docs/plans/uniswap-sdk-adoption.md) |
| Developer feedback for Uniswap | [`FEEDBACK.md`](FEEDBACK.md) |

Uniswap contracts used on Sepolia:

- [Universal Router `0x3A9D…F98b`](https://sepolia.etherscan.io/address/0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b)
- [V4 Quoter `0x61B3…9227`](https://sepolia.etherscan.io/address/0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227)
- [PoolManager `0xE03A…3543`](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543), via [StateView](https://sepolia.etherscan.io/address/0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C)
- [Permit2 `0x0000…8BA3`](https://sepolia.etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3)

The pool is native ETH / USDC with a 0.002% fee, tick spacing 1, and no hook. Its pool ID is `0xc743656d27fde4e2d5895e878557aaa56dd48c8656d25e9db35ba10b1fe3d824`.

Live swaps from a Sodera Kernel account:

- ETH → USDC: [`0x9b75…faf0`](https://sepolia.etherscan.io/tx/0x9b75ba46258116210043604a65f3a30f0684fd4b57cfdcd36839465504e3faf0) swapped 0.1 ETH for 3,179.920816 USDC.
- USDC → ETH: [`0x80e6…5dbe`](https://sepolia.etherscan.io/tx/0x80e6031700477a5503a900196fd22fb4824f4012df8757e8b400dcf084005dbe) swapped 1 USDC for 0.000031428307909673 ETH. This was the account's first operation, so it also deployed the wallet.

All swaps were sponsored by ZeroDev's paymaster. More are listed in the [route research](docs/research/PRA-212-uniswap-v4-sepolia-route.md#live-swaps).

## Project Documentation

- [`CONTEXT.md`](CONTEXT.md) defines the shared domain language.
- [`docs/adr/`](docs/adr/) records architecture decisions.
- [`docs/hackathon-specs.md`](docs/hackathon-specs.md) indexes the hackathon specifications.
- [`docs/hackathon-decisions.md`](docs/hackathon-decisions.md) records the current hackathon decisions.
- [`docs/agents/`](docs/agents/) configures issue tracking, triage labels, and domain-document conventions for engineering agents.
