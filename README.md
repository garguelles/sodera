# Sodera

Sodera is a seedless smart-account wallet and Android home launcher. This repository contains three independently installable applications.

## Applications

| Directory | Purpose |
| --- | --- |
| [`app/`](app/) | Expo SDK 57 mobile application and Android home launcher |
| [`landing/`](landing/) | React landing site and passkey domain host for `sodera.xyz` |
| [`agent/`](agent/) | Hono service that turns wallet requests into reviewable plans with Claude |

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

See the application READMEs for verification, native development, Digital Asset Links, and deployment instructions.

## Uniswap Integration

Sodera uses Uniswap on Ethereum Sepolia in two ways. Both run from the user's passkey-controlled Kernel smart account (ERC-4337, sponsored gas), and one passkey confirmation executes the whole batch, approvals included.

- **Swap** trades ETH ⇄ USDC in one pinned Uniswap v4 pool. The Uniswap SDK (`@uniswap/sdk-core`, `@uniswap/v4-sdk`) supplies the currencies, the pool key, the trade math (minimum received, rate and price impact) and the `V4Planner` encoding for Universal Router 2.0. `viem` makes the V4 Quoter call, encodes the approvals and handles RPC.
- **Pay with**, inside Send, pays someone an exact amount of one asset while spending the other. The agent backend asks the Uniswap Trading API for an exact-output route (`/quote`, then `/swap_5792`) with a server-side key, and returns one Universal Router 2.1.2 call. The wallet decodes and checks every command in it (with the v4 SDK's `V4BaseActionsParser`). It then adds its own approvals, capped at the quoted maximum, and its own transfer to the payee, and simulates the batch on Sepolia before the review.

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
| Pay with: Trading API client and `POST /pay/quote` | [`agent/src/uniswap-trading.ts`](agent/src/uniswap-trading.ts), [`agent/src/pay-quote.ts`](agent/src/pay-quote.ts) |
| Pay with: router call checks and the payment batch | [`app/src/wallet/pay-with-swap.ts`](app/src/wallet/pay-with-swap.ts) |
| Pay with: Sepolia simulation, Send screen, and activity rows | [`app/src/wallet/pay-with-simulation.ts`](app/src/wallet/pay-with-simulation.ts), [`app/src/components/send-screen.tsx`](app/src/components/send-screen.tsx), [`app/src/wallet/pay-with-activity.ts`](app/src/wallet/pay-with-activity.ts) |
| Pay with: Trading API research and plan | [`docs/research/trading-api-pay-with-sepolia.md`](docs/research/trading-api-pay-with-sepolia.md), [`docs/plans/pay-with-any-token.md`](docs/plans/pay-with-any-token.md) |
| Developer feedback for Uniswap | [`FEEDBACK.md`](FEEDBACK.md) |

Uniswap contracts used on Sepolia:

- [Universal Router 2.0 `0x3A9D…F98b`](https://sepolia.etherscan.io/address/0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b), for Swap
- [Universal Router 2.1.2 `0x7E4f…43f3`](https://sepolia.etherscan.io/address/0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3), for Pay with (the Trading API's router; its Permit2 allowances are separate)
- [V4 Quoter `0x61B3…9227`](https://sepolia.etherscan.io/address/0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227)
- [PoolManager `0xE03A…3543`](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543), via [StateView](https://sepolia.etherscan.io/address/0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C)
- [Permit2 `0x0000…8BA3`](https://sepolia.etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3)

Swap's pool is native ETH / USDC with a 0.002% fee, tick spacing 1, and no hook. Its pool ID is `0xc743656d27fde4e2d5895e878557aaa56dd48c8656d25e9db35ba10b1fe3d824`.

Live swaps from a Sodera Kernel account:

- ETH → USDC: [`0x9b75…faf0`](https://sepolia.etherscan.io/tx/0x9b75ba46258116210043604a65f3a30f0684fd4b57cfdcd36839465504e3faf0) swapped 0.1 ETH for 3,179.920816 USDC.
- USDC → ETH: [`0x80e6…5dbe`](https://sepolia.etherscan.io/tx/0x80e6031700477a5503a900196fd22fb4824f4012df8757e8b400dcf084005dbe) swapped 1 USDC for 0.000031428307909673 ETH. This was the account's first operation, so it also deployed the wallet.

Live Pay with payments from the same account:

- 10 USDC paid with ETH: [`0x0b06…70bb`](https://sepolia.etherscan.io/tx/0x0b06e8e799f05f54235a1ac4d0430b9cf919a84ffbe7faa7b5abe14240b670bb). The payee received exactly 10 USDC, and the account spent 0.000282410166306545 ETH after the router refunded the unused slippage buffer.
- 0.002 ETH paid with USDC: [`0x2c27…1875`](https://sepolia.etherscan.io/tx/0x2c27b215ab7004a9ef6c52b8c04835b8f6f8ec92970e0a96ad1759786a991875). The payee received exactly 0.002 ETH for 45.85871 USDC.

Every operation was sponsored through ZeroDev, whose paymaster on Sepolia is the [`SingletonPaymasterV7` contract `0x7777…834C`](https://sepolia.etherscan.io/address/0x777777777777AeC03fd955926DbF81597e66834C). More swaps are listed in the [route research](docs/research/PRA-212-uniswap-v4-sepolia-route.md#live-swaps).

## Project Documentation

- [`CONTEXT.md`](CONTEXT.md) defines the shared domain language.
- [`docs/adr/`](docs/adr/) records architecture decisions.
- [`docs/hackathon-specs.md`](docs/hackathon-specs.md) indexes the hackathon specifications.
- [`docs/hackathon-decisions.md`](docs/hackathon-decisions.md) records the current hackathon decisions.
- [`docs/agents/`](docs/agents/) configures issue tracking, triage labels, and domain-document conventions for engineering agents.
