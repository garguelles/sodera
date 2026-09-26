# 1inch Aqua and SwapVM on Ethereum Sepolia

Research date: 2026-09-27

## Decision

Earn uses 1inch Aqua with the official SwapVM Aqua router on Ethereum Sepolia. Both contracts are already deployed there by 1inch, so Sodera deploys no contracts.

| Contract | Address |
| --- | --- |
| Aqua | [`0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`](https://sepolia.etherscan.io/address/0x1111113ccf1426a8e30e2bff5e005d929bf6a90a) |
| AquaSwapVMRouter | [`0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE`](https://sepolia.etherscan.io/address/0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE) |

The addresses live in `app/src/wallet/sepolia.ts`.

## Why these are the official deployments

Neither the Aqua and SwapVM READMEs nor the `@1inch/aqua-sdk` and `@1inch/swap-vm-sdk` address maps list Sepolia. The mainnet router address `0x111111338c5091e8440b67b168bae16a668ac0de` has no code on Sepolia. The deployments were found on-chain instead:

- Aqua on Sepolia has the same address and byte-identical runtime code as on mainnet.
- Aqua on mainnet and Sepolia, and the SwapVM router on mainnet, were all deployed through the same `Create3Deployer` (`0x71481C3B9C6FBa3066AE84961EA22378A80cabe7`), sent from `0x0BD61d605C64A857C3D94779aEf7cA295702b3A2`.
- The Sepolia `AquaSwapVMRouter` was deployed by that same deployer on 2026-07-19, one minute after Aqua on Sepolia. Its source is verified on Blockscout (`src/routers/AquaSwapVMRouter.sol`, solc 0.8.30). Its constructor arguments are:
  - `aqua`: the Aqua address above
  - `weth`: `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`
  - `owner`: `0x4134e66d52EfC4C77DD8Ccc952D87b9E92E0C352` (can only rescue tokens stuck in the router)
  - `name`: `1inch SwapVM v1.0`
- Other teams actively ship strategies to it and trade against them.

The router's `weth` differs from `SEPOLIA_WETH_ADDRESS` (`0xfFf9…6B14`). This does not matter: WETH unwrapping is disallowed for Aqua orders, and strategies can hold any ERC-20, so Earn uses the same WETH as the rest of the app.

## SDK compatibility

`@1inch/swap-vm-sdk` 0.4.4 lists the Aqua router's opcodes in `aquaInstructions`. That table matches the verified router's `AquaOpcodes._opcodes()` index for index, so programs built with the SDK run on this router.

Other SDK facts the app relies on:

- `MakerTraits.default()` sets `useAquaInsteadOfSignature`. Orders are authorised by `Aqua.ship` from the maker, so the Kernel account never signs typed data.
- For Aqua orders, `Order.hash()` is `keccak256(order.encode())`. That is also the strategy hash Aqua derives in `ship`.
- `AquaXYCAmmStrategy.withFeeTokenIn(bps)` takes ordinary basis points (10,000 = 100%). The SDK scales them to the contract's 1e9 = 100% units.
- `TakerTraits.default()` is exact-in with `useTransferFromAndAquaPush`: the router pulls the taker's input with `transferFrom` and pushes it to the maker through Aqua. The taker approves the router, not Aqua.
- `@1inch/sdk-core`, which both SDKs use, imports Node's `assert` module.

## Alternatives checked

| Option | Result on Sepolia |
| --- | --- |
| Morpho | The core (`0xd011EE229E7459ba1ddd22631eF7bF528d424A14`) and MetaMorpho factory v1.1 are live. The 26 Circle USDC vaults were created by third parties and earn about 0%: the largest (about 1,351 USDC) lends to an idle market with no borrowers. |
| Aave v3 | The pool (`0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`) is live, with a USDC supply rate of about 58%. It lists Aave's own test USDC (`0x94a9…E4C8`), not Circle USDC. |
| Uniswap v4 LP | Possible through the PositionManager (`0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4`), but the pinned pool charges 0.002% and is mispriced about 11×. |

## Sources

- [1inch/aqua](https://github.com/1inch/aqua) and [1inch/swap-vm](https://github.com/1inch/swap-vm)
- [Sepolia AquaSwapVMRouter on Blockscout](https://eth-sepolia.blockscout.com/address/0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE)
- [Morpho contract addresses](https://docs.morpho.org/get-started/resources/addresses/)
- [ETHGlobal Tokyo 2026 prizes](https://ethglobal.com/events/tokyo2026/prizes)
