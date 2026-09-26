# Current Sepolia ENSv2 namespace check

The baseline snapshot below predates the namespace deployment. The [mounted-child evidence](#mounted-child-registry) records the later live state and transactions.

On September 26, 2026, the namespace verifier (now `pnpm verify:namespace` in `ens/`) made **read-only** Sepolia calls at block `11785402` using the current ENSv2 beta contracts from the [ENS deployment table](https://docs.ens.domains/learn/deployments/#sepolia-ensv2-beta).

| Check | Result |
| --- | --- |
| Chain | Ethereum Sepolia `11155111` |
| Root's `eth` subregistry | `0x657ea849311d3d5823348dded7c2aaafb3ede09e` (expected current ETHRegistry) |
| `sodera` status in current ETHRegistry | `REGISTERED` |
| Current owner | `0x7Ed08e45067d7Bb1c064055eC99aCD6586453915` |
| Parent expiry | 2029-09-26 01:53 UTC |
| Parent owner's name-scoped roles | `0x1110000000000000000000000000000001100000` |
| Owner can mount a subregistry | Yes, `ROLE_SET_SUBREGISTRY` is present |
| Parent name's assignee counts | `0x1110000000000000000000000000000001100000` |
| `sodera` child registry pointer | Zero address: no mounted child registry |

The script also checked that the published current root registry, ETHRegistry, factory, UserRegistry and resolver implementations, and Universal Resolver all have bytecode. This initial read did not prove wallet control, enumerate historical delegates/operators or runtime hashes, or establish initializer grants. At the time of this baseline snapshot, no deployment or name claim had been performed.

The screenshot of the [ENS Explorer](https://explorer.ens.dev/sodera.eth) shows an option to deploy a registry for this name. **Do not click Deploy yet:** first review the chosen implementation and the complete initialization role grants, canonical-parent/mount sequence, issuer/renewal authority, and later revocations. A generic ENS app deployment may initialize broad roles to the owner; the final user-owned configuration needs deliberate follow-up transactions and verification. ENS Explorer also warns that ENSv2 Sepolia beta registration/state may periodically reset, so re-run the verifier immediately before owner signing or testing.

## Reviewed owner setup

The user confirmed control of the recorded owner wallet `0x7Ed08e45067d7Bb1c064055eC99aCD6586453915`. `pnpm prepare:registry` in `ens/` performs a fresh read-only preflight and `eth_call` simulation from that account before printing **unsigned** transactions. At block `11785469`, the simulated factory deployment returned the same predicted child proxy, `0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7`. This prediction assumes that the **same owner wallet directly calls** the factory. A multisig/batch executor or a changed factory/owner produces a different address; rerun preflight with the actual deployer before signing.

The current deployed factory ABI has `deployProxy`, `proxyLogic`, and `verifyContract`, but **not** `predictProxyAddress` (present in newer factory source). The preparation script reads the deployed `proxyLogic`, derives the CREATE2 address from the deployed factory's documented bytecode scheme, then compares it against `deployProxy` simulation. The difference was found by an on-chain call; do not use the newer factory ABI for this deployment.

The initializer gives the owner only root `ROLE_SET_PARENT`, `ROLE_REGISTRAR_ADMIN`, and `ROLE_RENEW_ADMIN` (`0x1000100000000000000000000000000000100`). It gives no account `ROLE_REGISTRAR`, `ROLE_RENEW`, `ROLE_UPGRADE`, `ROLE_UNREGISTER`, root name resolver/subregistry setter roles, or their dangerous admin variants. The owner can later grant/rotate the dedicated issuer and renewal principals; those permissions are not active until separately granted. Registry deployment alone does not issue a name or enable renewal.

Review and sign **in order**, verifying each receipt and state before the next call:

1. Owner → VerifiableFactory `0x9e726eb570beb6bceb495ab8cda7df517d4e841c`: `deployProxy(UserRegistryImpl, salt, initializer)`. Confirm `ProxyDeployed`, proxy address and `verifyContract(proxy) == 0xa80338aaa8d23831cea25e858d1774534abb0263` and inspect owner root roles.
2. Same owner → new proxy: `setParent(0x657ea849311d3d5823348dded7c2aaafb3ede09e, "sodera")`. Confirm `getParent()` and the implementation/roles still match.
3. Same parent owner → ETHRegistry `0x657ea849311d3d5823348dded7c2aaafb3ede09e`: `setSubregistry(labelhash("sodera"), proxy)`. Confirm the parent pointer and canonical traversal.

After step 1 and after step 2, inspect the unmounted proxy with `ENS_CHILD_REGISTRY=<predicted proxy address> pnpm verify:namespace` in `ens/`. After step 3, `pnpm verify:namespace` picks up the mounted child automatically. Match its roles and canonical parent against the intended state before proceeding.

Use the script's **fresh JSON output** for the precise `to`, zero `valueWei`, and `data` for each call. If the owner, parent expiry, `.eth` pointer, predicted address, or simulated initializer differs, stop and review again. Do not sign steps 2–3 merely because they appear in the same output: check the preceding receipt first. Do not yet revoke the parent's right to replace the child pointer, or grant registrar/renewal authority before their software and tests exist. The first irreversible lock is a later, separately reviewed operation after a controlled name claim.

### MetaMask execution

On the machine with the MetaMask browser extension, run `pnpm dev` from the standalone `ens/` app and open its local Vite URL (normally `http://127.0.0.1:5173/`). The server binds to localhost, and the ENS owner tool is not part of the public `landing/` build. Do not use a remote site, a pasted private key, or the generic ENS Explorer Deploy action as a substitute.

Select Ethereum Sepolia and the confirmed `0x7Ed0...3915` account in MetaMask. Connecting only requests the address; no transactions are sent on connection. Compare the page's owner, predicted child, destination, calldata and role list with a fresh `pnpm prepare:registry` run in `ens/`. Each button requests **one** MetaMask confirmation and waits for its receipt and ENS state check before the next button is enabled. If MetaMask switches account or network, the page checks again immediately before sending. A transaction that fails or has an unexpected resulting state stops the sequence. Keep the receipt links for later review.

The owner completed these three transactions. Merely connecting and inspecting is safe; registration, renewal and any irrevocable namespace lock remain separate future actions. `pnpm prepare:registry` now intentionally stops because the child pointer is no longer empty.

## Mounted child registry

On September 26, 2026, the owner wallet completed the reviewed sequence on chain ID `11155111`:

| Step | Successful Sepolia transaction | Block |
| --- | --- | --- |
| Factory `ProxyDeployed` for `0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7` | [Deploy](https://eth-sepolia.blockscout.com/tx/0x60e662ef77a3242c4da6f8a335be34d8094a2fcc14519b0fdcb2138ee93ee1b8) | `11786227` |
| Child `ParentUpdated` to current ETHRegistry / `sodera` | [Set parent](https://eth-sepolia.blockscout.com/tx/0xf4b356c030a5f8eeb79958d99b36e138a3f75c05173c49138fdd0e1c66cb4c8f) | `11786233` |
| ETHRegistry `SubregistryUpdated` to the child proxy | [Mount](https://eth-sepolia.blockscout.com/tx/0x54bd4d9a5932f225c10b3f65dc3e1523e73f60e15731dda30074d4a79eb6aba5) | `11786235` |

Independent `pnpm verify:namespace` at block `11786243` confirmed `REGISTERED` parent status, owner `0x7Ed08e45067d7Bb1c064055eC99aCD6586453915`, parent expiry `2029-09-26T01:53:00Z`, the mounted child pointer, factory-verified official `UserRegistryImpl` `0xA80338aAA8D23831cEa25E858D1774534aBb0263`, child canonical parent `(ETHRegistry, "sodera")`, and child root role bitmap/count `0x1000100000000000000000000000000000100`. `isEmancipated()` was `true` for the **child** only. The parent owner still holds `ROLE_SET_SUBREGISTRY`, so the ancestor can redirect the subtree; parent lock is a distinct later decision.

This verifies the empty namespace configuration, **not** a user's issued subname, account resolver, address resolution, renewal, or the entire ancestor trust chain. No issuance or renewal principal has root operational authority yet; the owner retains registrar/renew admin roles for later grants.

## Proposed issuer

The owner designated public address `0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0` for a separate issuer service. At block `11786611`, `pnpm verify:issuer` reported zero child-root roles, `registrarGranted: false`, and a balance of `0` Sepolia wei. It checked the mounted child's official factory implementation and canonical parent. This proves neither control of the issuer key nor readiness to issue: the wallet needs Sepolia gas, and the isolated service's authentication, idempotency, budget and resolver/registration checks must pass before any `ROLE_REGISTRAR` grant.

At block `11786628`, after funding, the same read-only check reported `100000000000000000` wei (0.1 Sepolia ETH), still zero root roles and `registrarGranted: false`. The strengthened verifier also confirmed the pinned child address, current parent owner, and that the proposed issuer has no contract code. Funding establishes gas availability but not control of its key or a safe public claim service.

## Android claim proof

On September 27, 2026 (local time), the owner reported that Step 5 of the Passkey Proof screen succeeded on a connected physical Android device. A read-only query of the local Podman PostgreSQL `ens_claim_challenges` table showed the latest challenge for the device wallet (abbreviated `0xc451...6906`) was both consumed and verified at `2026-09-26 15:57:11 UTC`. The proof token, challenge bytes, assertion, and credential ID were not copied into this evidence. This corroborates the Android-to-local-API verification path; it does **not** prove ENS issuance or authorize a future registration, and the issuer still has no root registrar role.

## Issuer read-only preflight

The private-worker call builder was checked against the live Sepolia factory without using the issuer signing key or submitting a transaction. With the **public synthetic test Kernel only as a simulation argument**, `deployProxy(PermissionedResolverImpl, salt, initialize(grants, calls))` returned resolver address `0x263a8878b7e4a6066374C1044D1b427946733676`, matching the independently computed CREATE2 address. Initializer calldata grants address, text, link and upgrade roles and their admins to that Kernel only, and writes its coin-60 address for the full DNS name. The resolver was **not** deployed.

A separate `eth_call` of `UserRegistry.register()` from the proposed issuer returned revert selector `0x4b27a133` (`EACUnauthorizedAccountRoles(uint256,uint256,address)`), confirming that this issuer is **not yet authorized**. Local PostgreSQL tests use disposable schemas and leave the operational `ens_claims` table empty. No user name was registered and no issuer secret or registrar role was used in these checks.

After the challenge protocol was tightened to hash chain, registry, wallet, label, expiry and nonce, a further **synthetic-only**, read-only local API check returned challenge HTTP `201`, verification HTTP `200`, and replay HTTP `401`. The database stored the nonce and verified assertion; `ens_claims` stayed empty. This is not evidence that the changed challenge version has been accepted on the physical Android device, and the synthetic publicly known test Kernel is barred from actual issuance.

`pnpm prepare:issuer-grant` from `ens/` simulated `grantRootRoles(ROLE_REGISTRAR, issuer)` as the real parent owner at block `11787441`. The simulation succeeded and printed unsigned calldata targeting child registry `0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7`; **no transaction was sent**, and on-chain verification still reports zero issuer root roles. Owner review and a separate signature remain required.
