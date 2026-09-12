# Ethereum Sepolia USDC and WBTC assets

Research date: 2026-09-13

## Recommendation

| App label | Exact checksummed address | Classification | Confidence |
| --- | --- | --- | --- |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | **Canonical Circle-issued testnet USDC**, with no financial value or dollar backing | **High** |
| WBTC | `0x29f2D40B0605204364af54EC677bD022dA425d03` | **Aave test WBTC mock**, not canonical WBTC and not BTC-backed | **High** for address/usability; **high** that it must be presented as a mock |

Use Circle USDC for the current hackathon and exclude WBTC from the wallet and demo. Preserve the Aave test WBTC address only as a deferred option; never describe it as BitGo-issued, canonical, redeemable, or BTC-backed. The official WBTC contract-address page publishes only supported **mainnets** and has no Sepolia entry; its Ethereum canonical address is mainnet-only `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` ([WBTC contract addresses](https://docs.wbtc.network/resources/contract-addresses)). This is strong evidence that canonical WBTC is unavailable on Sepolia, though it cannot prove that BitGo has never deployed an unpublished test contract.

Circle explicitly lists the recommended Ethereum Sepolia address. Circle also warns that testnet USDC has no financial value and is not backed by dollars ([Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)). Aave's maintained deployment registry identifies the recommended WBTC address as Sepolia V3's `WBTC_UNDERLYING`, with 8 decimals, and identifies its faucet ([Aave Sepolia address-book module](https://assets.aave.com/address-book/releases/latest/modules/AaveV3Sepolia.json), [address-book repository](https://github.com/aave-dao/aave-address-book)).

## Live-chain verification

Snapshot: Sepolia chain ID `11155111`, block `11690434`, timestamp `2026-09-12T17:42:00Z`, queried through `https://ethereum-sepolia-rpc.publicnode.com`. Values came from `eth_getCode` and `eth_call`; contract type/source corroboration came from Blockscout's Sepolia explorer API. Supplies are observations at that block and will change.

| Check | Circle USDC | Aave test WBTC |
| --- | --- | --- |
| Runtime bytecode | Present, 1,798 bytes; keccak256 `0xcd3f29e2ea9c61dadd48bfeaf8b2884b6de9dfee7bf45329452c4c33d0868ceb` | Present, 5,462 bytes; keccak256 `0xada27a4287f9171a4d23a4d5977c9a583d718906f6aa2d6d7f24739c397306f2` |
| `name()` / `symbol()` | `USDC` / `USDC` | `WBTC` / `WBTC` |
| `decimals()` | `6` | `8` |
| `totalSupply()` raw | `10742410754430015707` | `32227903455443514` |
| Human supply | `10,742,410,754,430.015707` test USDC | `322,279,034.55443514` test WBTC |
| Contract form | Verified `FiatTokenProxy`; upgradeable | Verified `TestnetERC20`; no proxy detected |
| Owner/issuer control | Token owner `0xaB7Dbf0Fc9d32349c484419073098DcD52C14798`; role addresses below | Owner `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`, the Aave faucet |
| Permit surface | Domain present, version `2`; EOA and ERC-1271-capable overloads in implementation | EIP-2612-shaped domain and `permit`, but implementation uses `ecrecover` only |

The USDC proxy's live `implementation()` is `0xDa317C1d3E835dD5F1BE459006471aCAA1289068`, verified by the explorer as `FiatTokenV2_2`. Its runtime is present (23,464 bytes; keccak256 `0xf4898b096a273d86cda13cce6503404da4005565fae6026a94919b231229d85b`). The proxy `admin()` is `0xD48f3032f64e3127883FDa62BC2C47C698d6Baf7`; `masterMinter()` is `0x4B22a317731c7b744B00038AB782F4C54D152Ddb`; `blacklister()` is `0x9d2E76E96b295f45f2F5B02a6b150526Be94A66D`; and `pauser()` is `0xaB7Dbf0Fc9d32349c484419073098DcD52C14798`. `paused()` was `false`. The explorer independently reports the proxy and current implementation ([USDC proxy API](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)). Circle's source documents that `FiatTokenProxy` delegates to upgradeable `FiatTokenV2_2`, and that owner-controlled roles can pause, blacklist, and mint ([Circle stablecoin EVM repository](https://github.com/circlefin/stablecoin-evm)).

The WBTC address is verified as Aave's `TestnetERC20`, not WBTC's production token contract. Its exposed ABI includes unrestricted ERC-20 transfer functions, owner-only mint functions, and permit, but no blacklist, pause, or upgrade functions ([deployed WBTC mock API](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0x29f2D40B0605204364af54EC677bD022dA425d03), [Aave `TestnetERC20` source](https://github.com/aave/aave-v3-periphery/blob/master/contracts/mocks/testnet-helpers/TestnetERC20.sol)). Symbol and decimals therefore establish UI compatibility, not issuer or backing.

## Funding routes

### USDC

Use Circle's public faucet, select **USDC** and **Ethereum Sepolia**, and enter the Kernel address: [faucet.circle.com](https://faucet.circle.com/). Circle currently states a limit of 20 testnet USDC per address/network every two hours and explicitly permits experimentation with wallets or smart contracts. A counterfactual Kernel address can receive an ERC-20 balance before deployment, but deploy and verify the account before attempting to send that balance.

### WBTC mock

Call Aave's faucet at `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`:

```solidity
mint(
  0x29f2D40B0605204364af54EC677bD022dA425d03,
  kernelAddress,
  amountInSatoshis
)
```

At the snapshot, live calls returned `isPermissioned() == false`, `isMintable(WBTC) == true`, and `MAX_MINT_AMOUNT() == 10000` whole tokens per call. An `eth_call` simulation from an unrelated address to mint `1 WBTC` (`100000000` raw units) succeeded. The faucet is the token owner and performs the owner-only mint on the caller's behalf. The Aave address book is the authoritative deployment link; the explorer confirms the deployed faucet ABI/source ([Aave Sepolia module](https://assets.aave.com/address-book/releases/latest/modules/AaveV3Sepolia.json), [deployed faucet API](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D)). Faucet permission, mintability, cap, and ownership are mutable admin settings, so recheck them before a demo.

## Kernel / ERC-4337 compatibility

Both tokens can be transferred from a deployed ERC-4337 Kernel account. A successful UserOperation can make the Kernel execute the token's standard `transfer(recipient, amount)` call; the token sees `msg.sender == kernelAddress`, which is valid ERC-20 behavior. No token requires the holder to be an EOA. The UserOperation still needs valid Kernel authorization and Bundler gas handling (sponsored or funded), and the token balance must cover the transfer.

- **USDC direct transfer:** usable while the token is unpaused and neither sender nor recipient is blacklisted. Circle can change those states and can upgrade the implementation. Direct `approve` from Kernel is also usable.
- **USDC permit:** `FiatTokenV2_2` offers the legacy EIP-2612 `(v,r,s)` overload and a `bytes signature` overload. Circle's `SignatureChecker` routes the bytes overload to ERC-1271 for contract owners ([`FiatTokenV2_2`](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/FiatTokenV2_2.sol), [`SignatureChecker`](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/util/SignatureChecker.sol)). Kernel permit support is therefore plausible through the bytes overload only if the installed validator's Kernel-level `isValidSignature` accepts the exact typed-data digest and signature encoding. This was not exercised live; use direct `approve` for the hackathon unless separately integration-tested.
- **Aave mock direct transfer:** usable; its verified implementation has no blacklist, pause, transfer fee, or proxy hook.
- **Aave mock permit:** unsuitable for a Kernel-owned balance. Its permit recovers an EOA with `ecrecover` and requires that recovered EOA to equal `owner`; it has no ERC-1271 path. Use a Kernel-executed `approve` instead.

## Caveats and confidence boundary

- **Canonical terminology:** Circle's address is canonical **testnet USDC issued by Circle**, but it is valueless and unbacked. Aave's WBTC is unequivocally a **mock** despite matching WBTC's name, ticker, and 8 decimals.
- **Canonical WBTC absence:** no Sepolia contract or faucet appears in WBTC's official address list, which is explicitly a supported-mainnet list. The conclusion is "no published canonical WBTC on Sepolia," not proof that no private/unpublished BitGo test deployment exists.
- **Mutable contracts:** Circle may upgrade, pause, blacklist, or change roles. Aave governance/admin can change faucet permission and mintability; the WBTC mock owner can mint supply through the faucet. Pin chain ID and address, then re-read bytecode, metadata, proxy implementation, pause state, and faucet status before the final demo.
- **Permit:** neither permit path should be assumed from ABI presence. USDC's ERC-1271 path still needs an end-to-end Kernel signature test; Aave mock permit is EOA-only by implementation.
- **Funding availability:** Circle's faucet is rate-limited. Aave's current permissionless faucet state is on-chain but not immutable. Pre-fund demo accounts and retain a funded fallback Kernel address.

## Primary source index

- Circle: [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [public testnet faucet](https://faucet.circle.com/), [stablecoin EVM contracts](https://github.com/circlefin/stablecoin-evm), [`FiatTokenV2_2`](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/FiatTokenV2_2.sol), and [`SignatureChecker`](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/util/SignatureChecker.sol).
- WBTC/BitGo ecosystem: [official contract addresses](https://docs.wbtc.network/resources/contract-addresses), [WBTC backing overview](https://docs.wbtc.network/overview/wbtc-overview), [mint/burn model](https://docs.wbtc.network/how-wbtc-works/mint-burn-mechanism), and [official token-contract repository](https://github.com/WrappedBTC/bitcoin-token-smart-contracts).
- Aave: [Sepolia address-book module](https://assets.aave.com/address-book/releases/latest/modules/AaveV3Sepolia.json), [address-book repository](https://github.com/aave-dao/aave-address-book), and [`TestnetERC20`](https://github.com/aave/aave-v3-periphery/blob/master/contracts/mocks/testnet-helpers/TestnetERC20.sol).
- Live explorer corroboration: [USDC proxy](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238), [Aave WBTC mock](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0x29f2D40B0605204364af54EC677bD022dA425d03), and [Aave faucet](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D).
