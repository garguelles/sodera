# PRA-184: Kernel WebAuthn validator compatibility

Research date: 2026-09-09

## Decision

**PASS for hackathon compatibility; FAIL for a production security claim. ZeroDev's released WebAuthn validator directly authorized a Kernel 0.3.3 root on Ethereum Sepolia through a sponsored EntryPoint 0.7 UserOperation. The exact validator source bundle and build settings reproduce its deployment and runtime bytecode byte-for-byte, and positive and negative vectors passed against the deployed validator and account path. The exact source blob still cannot be tied to a unique public ZeroDev commit or matching audit, and physical Android ceremony evidence remains assigned to PRA-185/PRA-187.**

This is not the rejected raw-P256 path and it does not use Turnkey. A platform authenticator signs a WebAuthn assertion whose challenge is the EntryPoint UserOperation hash. Kernel stores the WebAuthn validator as its root validator and the validator stores the P-256 public key under the Kernel account address.

Status vocabulary in this report:

- **PASS**: established by a first-party source, a reproducible artifact check, or public chain state.
- **FAIL**: contradicted by the evidence or missing evidence required by the acceptance gate.
- **UNKNOWN**: requires credentials, a physical authenticator, or unavailable provenance.

## Pinned candidate

| Component | Pin | Evidence and status |
| --- | --- | --- |
| Chain | Ethereum Sepolia, chain ID `11155111` | **PASS.** Public chain state was queried directly. |
| SDK | `@zerodev/sdk@5.5.10` | **PASS, package.** npm integrity is `sha512-WVyj2XR9F6zK2GdXrvappx7yo6zoJ46cWe42dOIArp3xDjFBninjA4O1O94MwohB0G+yFqtXNsEU+WxdE67SgQ==`. Its peer is `viem@^2.28.0`. |
| Passkey adapter | `@zerodev/passkey-validator@5.6.0` | **PASS, package.** This is the security-patched release required by the docs. npm integrity is `sha512-ItnPs/6m3pT8tWaLqt31AFFQ4tAc5O01gtXP0Y7RW7xfuqUbgwYOghyeKMEkw6LfYykUWLhapL4B5c0CBYkgvg==`. |
| WebAuthn key helpers | `@zerodev/webauthn-key@5.5.0` | **PASS, package.** npm integrity is `sha512-AbD2d/qrsX7AWxJMEfwxnLbp1TjiUjc1V4ne3Q40UJxKe+lW64Td+y8OD0qSFMqgN6rQxJZ0aOAXmat8H6xluA==`. |
| Assertion bridge consumed by PRA-187 | `src/wallet/kernel-webauthn.ts` over the pinned `@zerodev/webauthn-key@5.5.0` primitives | **PASS, platform-neutral contract.** It accepts the standard native WebAuthn assertion fields, derives the exact UserOperation challenge, normalizes DER to low-`s`, and emits the selected validator ABI. PRA-185 owns which native Android ceremony implementation supplies those fields. `@zerodev/react-native-passkeys-utils@5.4.4` remains an unselected candidate rather than an implicit dependency. |
| Kernel | release `v3.3`, version string `0.3.3`, commit [`cd697c7`](https://github.com/zerodevapp/kernel/tree/cd697c7e21715d015e0643af22310a99aa17433b) | **PASS, source release.** The tag resolves directly to this signed commit and Kernel's EIP-712 version is `0.3.3`. |
| Kernel implementation | [`0xd6CE...5b28`](https://eth-sepolia.blockscout.com/address/0xd6CEDDe84be40893d153Be9d467CD6aD37875b28) | **PASS, deployment and reproducible build.** The 30-source bundle hash is `0x4bf3dda831ed92a4f603ed4b20950d43b07c32a05a4ecfc47e29d588d5f25366`; recompilation with Solidity `0.8.28` exactly matches creation code, deployment payload, ABI, immutable-patched runtime, and current chain code. Runtime code hash `0x1cacd781072bcb657a6306afd074049f35d0a9d7f50eccda9b12bdd00c636995`; deterministic-proxy deployment transaction [`0x7d1c...c95d`](https://eth-sepolia.blockscout.com/tx/0x7d1c2fdd95e18895ed27fbc4868de58ae085ec09b7d3c300ec7ab720464bc95d), block 7,881,934, 2025-03-11. |
| KernelFactory | [`0x2577...F2E9`](https://eth-sepolia.blockscout.com/address/0x2577507b78c2008Ff367261CB6285d44ba5eF2E9) | **PASS, deployment and reproducible build.** The two-source bundle hash is `0xeb83c26231e5c9eb9ba1ec925f761e16de5c8df4fef718cd163ed74c3032dc77`; recompilation with Solidity `0.8.28` exactly matches creation code, deployment payload, ABI, immutable-patched runtime, and current chain code. Runtime code hash `0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a`; immutable implementation is `0xd6CE...5b28`; deployment transaction [`0x6bff...99d2`](https://eth-sepolia.blockscout.com/tx/0x6bffaedba569ca0d5eb25ed44747dc0e11b87ce2a85cac4e3b7f75b3ba4799d2), block 7,931,152, 2025-03-18. |
| EntryPoint | v0.7 [`0x0000...a032`](https://eth-sepolia.blockscout.com/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) | **PASS, deployment and reproducible build.** The 18-source bundle hash is `0x9951f25a78201825f62295783c7069bb41ad4a3a47114883c23bb851500954fa`; recompilation with Solidity `0.8.23` exactly matches creation code, deployment payload, ABI, immutable-patched runtime, and current chain code. Runtime code hash `0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58`; deployment transaction [`0x0c0b...30eb`](https://eth-sepolia.blockscout.com/tx/0x0c0bc6a92965094232ed1a3788646890b8d6f4c3006eeda5db377d62f9a830eb), block 5,328,753, 2024-02-20. |
| Validator contract version | `PasskeyValidatorContractVersion.V0_0_3_PATCHED`, value `0.0.3` | **PASS, released adapter.** Versions `0.0.1` and `0.0.2` are explicitly named unpatched by package 5.6.0 and must not be used. |
| Validator deployment | [`0x7ab1...9e69`](https://eth-sepolia.blockscout.com/address/0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69) | **PASS, deployment and reproducible build; UNKNOWN, source history/audit.** Runtime code hash `0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea`; deterministic-proxy deployment transaction [`0x8bf4...4913`](https://eth-sepolia.blockscout.com/tx/0x8bf42851b99f5e5b1497121d55d3b822132dbfa06399b4ce34bc8febf53f4913), block 9,229,299, 2025-09-18. The nine-source Blockscout bundle hash is `0xaaaadd7d6d1bcf76502dc5cf815a183ab646f14c5bc1ff6b9729510d49151052`; compilation with official Solidity `0.8.30`, London EVM, IR pipeline, optimizer enabled with 20,000 runs, and no metadata bytecode hash reproduces the 4,766-byte initcode and 4,739-byte runtime exactly. The deployment transaction contains zero salt followed by exactly that initcode, deriving the selected CREATE2 address. No unique public ZeroDev commit or matching audit was found for this exact source blob. |

These package versions form a semver-compatible set: passkey validator 5.6.0 peers on `@zerodev/sdk@^5.4.0`, `@zerodev/webauthn-key@^5.4.2`, and `viem@^2.28.0`; WebAuthn key 5.5.0 peers on `viem@^2.28.0`.

### npm provenance caveat

npm reports `gitHead` values `427e48a` for SDK 5.5.10, `5bf80dc` for passkey validator 5.6.0, `1114391` for WebAuthn key 5.5.0, and `34568f0` for the React Native helper. These are not sufficient artifact provenance:

- Passkey validator `gitHead` `5bf80dc` does not contain validator `0.0.3`; its child commit [`7b503b7`](https://github.com/zerodevapp/sdk/commit/7b503b7ac43697f253b07ca9faa3bd1462b2a182) changes the package to 5.6.0 and adds `V0_0_3_PATCHED` plus `0x7ab1...9e69`.
- WebAuthn key `gitHead` `1114391` lists only Polygon chain IDs for the precompile. Its child release commit [`5821761`](https://github.com/zerodevapp/sdk/commit/58217618a3f3957ee2a85ba1a29fc8119b2d2df3) changes the package to 5.5.0 and adds Sepolia `11155111`.

This appears consistent with npm recording the parent checked out before a release/version commit, but it means the npm integrity values and unpacked tarballs, not `gitHead`, are the reproducible package pins.

## Direct root authority

**PASS, architecture and source semantics.** ZeroDev's maintained passkey guide says to create a Kernel account with the passkey validator as the `sudo` validator. Kernel 0.3.3 `initialize` stores the supplied validator identifier as `rootValidator` and immediately calls its installation flow with `validatorData`. During UserOperation validation, a root-mode nonce redirects validation to that stored identifier and calls its `validateUserOp` implementation. The deployed validator's `onInstall` decodes `((uint256 pubKeyX,uint256 pubKeyY),bytes32 authenticatorIdHash)`, rejects zero coordinates, and stores the key under `msg.sender`, which is the Kernel account.

The adapter's internal `validatorType: "SECONDARY"` label is confusing but not evidence of secondary authority in this construction. In SDK/Kernel encoding it selects the ordinary validator module type (`0x01`); root authority is conferred by placing that validator identifier in Kernel's `rootValidator` slot. Root-mode UserOperations use nonce validation type `0x00` and Kernel resolves them to that slot.

Kernel restricts `changeRootValidator`, `installModule`, and upgrades with `onlyEntryPointOrSelfOrRoot`. Therefore an unauthenticated external caller cannot replace the root; a valid current root operation can. No Turnkey signer, EOA, or remotely held secp256k1 key participates in this source path.

**PASS, executed root proof.** The clearly labeled credential `sodera.synthetic.p256.v1.DO-NOT-USE-IN-PRODUCTION`, using the public test scalar `1`, derived and deployed Kernel account [`0x8c99...c142`](https://eth-sepolia.blockscout.com/address/0x8c99983f0A1c91c41207ccFDaDddf0304565c142). Sponsored UserOperation [`0xde48...ce6d`](https://jiffyscan.xyz/userOpHash/0xde4810ba8639d2db487ce5172e3b2a795ced2b0f8829b326c542e3b4d62cce6d?network=sepolia) deployed it in transaction [`0x04bd...7969`](https://eth-sepolia.blockscout.com/tx/0x04bd8e4c56037e384b51ad64c81cf316f792379a7aa0ebaa8e9aa75df03f7969). Reads after execution established root identifier `0x01 || 0x7ab1...9e69`, validator module installation, validator initialization, exact stored P-256 coordinates, and ERC-1967 implementation `0xd6CE...5b28`. No EOA, Turnkey signer, or remote wallet key participated.

## Exact UserOperation and WebAuthn semantics

1. EntryPoint v0.7 computes `userOpHash = keccak256(abi.encode(userOp.hash(), entryPointAddress, chainId))`. `PackedUserOperation.hash()` binds sender, nonce, init code, call data, packed account gas limits, pre-verification gas, packed fee values, and paymaster data; signature is excluded.
2. `toPasskeyValidator.signUserOperation` clears `signature`, calls viem's `getUserOperationHash` with EntryPoint `0x0000...a032`, version `0.7`, and the client's chain ID, then passes `{ raw: userOpHash }` to its local account.
3. The 32 hash bytes, without the `0x` prefix and without EIP-191 wrapping, are encoded as unpadded base64url. For example, 32 zero bytes become `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.
4. The browser adapter requests an assertion with that challenge, the selected credential ID in `allowCredentials`, and `userVerification: "required"`. The React Native helper additionally passes the configured `rpId` to `react-native-passkeys.get`.
5. `authenticatorData`, signature, and credential IDs are base64url-decoded. `clientDataJSON` is decoded to its original UTF-8 string. The adapter finds the byte offset of the last exact substring `"type":"webauthn.get"`.
6. The authenticator's ASN.1 DER P-256 signature is parsed into fixed-width `r` and `s`. If `s > n/2`, the adapter replaces it with `n-s`, where `n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551`.
7. The final validator signature is `abi.encode(bytes authenticatorData,string clientDataJSON,uint256 responseTypeLocation,uint256 r,uint256 s,bool usePrecompiled)`.
8. The deployed validator fixes `challengeLocation = 23`, requires user presence and user verification flags, checks the type substring at the supplied response-type location, and checks `"challenge":"<base64url hash>"` at byte 23. It then verifies `(r,s)` over `sha256(authenticatorData || sha256(clientDataJSON))` using the installed `(x,y)` key.

WebAuthn key 5.5.0 selects `usePrecompiled = true` for Sepolia. An empty `eth_getCode` result at `0x100` is expected for a protocol precompile and is not evidence of absence. A malformed all-zero `eth_call` also returned empty data, so the native Sepolia P-256 path still needs a valid-vector call before this flag is accepted as execution evidence.

## Security boundaries

The verified validator source explicitly does **not** enforce several normal relying-party checks on-chain:

- It does not compare `origin` in `clientDataJSON` with an expected origin.
- It does not compare the first 32 bytes of `authenticatorData` (`rpIdHash`) with an installed RP ID.
- It does not enforce signature-counter, backup-state, cross-origin/top-origin, extension-output, or attestation policy.
- `authenticatorIdHash` is decoded during installation for event/discovery use but is not stored as authorization state; possession of the installed public key is what authorizes.

The platform authenticator is expected to enforce RP scoping, backed on Android by Digital Asset Links and on iOS by Associated Domains. Consequently, a tampered origin or RP hash fails against an unchanged signature because those bytes are signed, but a test fixture that uses the installed private key to re-sign a different origin or RP hash can pass the on-chain validator. Origin/RP mismatch must therefore be tested both at the native ceremony boundary and at the contract boundary; it is incorrect to claim that the contract itself rejects a freshly signed mismatch.

The 2024 KALOS incremental report covers an ERC-7579 `WebAuthnValidator.sol` at commit `ae10aa0f`, but the patched `0.0.3` deployment was made in September 2025. No evidence was found that the 2024 review covers the security-patched deployed bytecode. This report makes no production security claim.

## Required vector matrix

No row below is represented as executed unless its evidence says so.

| Vector | Required result | Current evidence |
| --- | --- | --- |
| Installed test key, exact UserOp hash, UP+UV, valid assertion | Accept | **PASS:** direct deployed-validator vector returned `0`; sponsored Kernel UserOperations succeeded. |
| Same assertion replayed with the same nonce | Reject | **PASS:** exact replay of successful UserOperation `0x1a8d...13b2` was rejected with `AA25 invalid account nonce`. |
| Same assertion against another Kernel account or installed key | Reject | **PASS:** deployed-validator calls with a different caller or overridden installed key returned `1`. |
| Same packed UserOperation on another chain | Reject | **PASS:** recomputed chain-domain hash with the original assertion returned `1`. |
| Same packed UserOperation against another EntryPoint | Reject | **PASS:** recomputed EntryPoint-domain hash with the original assertion returned `1`. |
| Change nonce, sender, calls, init code, gas limits, fees, or paymaster data | Reject | **PASS, executed:** deterministic tests prove every packed field changes the challenge, and every listed field mutation returned `1` from the deployed validator when checked with the original assertion. |
| Malformed ABI, malformed DER before ABI conversion, invalid `r/s`, bad type location, absent UP, or absent UV | Reject | **PASS:** client malformed DER/type checks fail before submission; deployed-validator malformed ABI reverted and bad type location, high-`s`, missing UP, and missing UV returned `1`. |
| Change challenge without re-signing | Reject | **PASS:** changed domain and nonce challenges with the unchanged assertion returned `1`. |
| Change origin or RP hash without re-signing | Reject | **PASS by digest construction:** both fields are covered by the signed digest; freshly re-signed mismatch behavior is recorded separately below. |
| Re-sign a wrong origin or RP hash with the installed key | Contract accepts; authenticator ceremony must prevent creation | **FAIL for contract-level RP/origin enforcement by design.** |
| External caller directly changes root or installs/removes a validator | Reject | **PASS:** direct external `changeRootValidator`, `installModule`, and `uninstallModule` calls all reverted. The root and installed validator remained unchanged. |
| Root-authorized UserOperation changes root | Accept, then old root rejects | **UNKNOWN:** required for recovery design but not executed. |

The live verifier reproducibly emits the complete unsigned packed UserOperation, expected UserOperation hash, base64url challenge, credential ID hash, public key coordinates, raw `authenticatorData`, exact `clientDataJSON`, response-type location, DER signature, normalized `r/s`, final assertion ABI bytes, final account signature, account/root/validator storage reads, estimation values, UserOperation hash, and receipt. Secret private key material, endpoint URLs, and authentication tokens are not recorded. PRA-187 should persist the equivalent artifact from the physical Android ceremony.

### Local deterministic evidence

`src/wallet/kernel-webauthn.test.ts` now fixes a complete EntryPoint 0.7 UserOperation and asserts its literal hash and unpadded base64url challenge. It verifies that every packed field changes the challenge while the placeholder signature does not, selects only validator `0.0.3`, decodes the final six-field ABI envelope, proves high-`s` normalization, and rejects malformed DER or missing `webauthn.get` client data before submission. This is credential-independent adapter evidence, not a substitute for the on-chain and physical-device vectors assigned to PRA-187 and PRA-185.

`pnpm verify:webauthn-provenance` downloads pinned Blockscout source bundles, checks every source-unit hash and compiler setting, recompiles EntryPoint with Solidity `0.8.23`, Kernel and KernelFactory with `0.8.28`, and the validator with `0.8.30`, then asserts exact initcode, ABI, runtime, deployment payload, deterministic address, and current chain code for all four contracts. `pnpm verify:webauthn-vectors` signs a fixed UserOperation hash with the labeled public test credential and runs the deployed validator matrix through Sepolia state overrides. `SUBMIT_SYNTHETIC_USER_OPERATION=1 pnpm verify:kernel-live` prepares, sponsors, signs, submits, asserts a successful receipt and exact replay failure, checks direct unauthorized root/module mutations, and emits the complete redacted execution vector. These scripts never read or persist a production credential private key.

## Public and credentialed Sepolia evidence

**PASS, public deployment evidence.** All four pinned addresses returned the runtime code hashes above from `https://ethereum-sepolia-rpc.publicnode.com` on 2026-09-09. The validator, factory, and implementation were deployed through the canonical deterministic deployment proxy `0x4e59...956C`; Blockscout publishes successful deployment transactions and verified source for the addresses.

Reproduce the runtime checks with:

```bash
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
cast codehash 0x0000000071727De22E5E9d8BAf0edAc6f37da032 --rpc-url "$RPC_URL"
cast codehash 0x2577507b78c2008Ff367261CB6285d44ba5eF2E9 --rpc-url "$RPC_URL"
cast codehash 0xd6CEDDe84be40893d153Be9d467CD6aD37875b28 --rpc-url "$RPC_URL"
cast codehash 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 --rpc-url "$RPC_URL"
```

**PASS, credentialed hosted execution.** On 2026-09-09, the configured ZeroDev Sepolia unified Bundler/Paymaster RPC returned the pinned EntryPoint 0.7 address, estimated the counterfactual operation, supplied sponsorship fields under the configured Sepolia policy, accepted four direct-passkey UserOperations, and returned successful receipts. The latest UserOperation was [`0x1a9e...bfb9`](https://jiffyscan.xyz/userOpHash/0x1a9e275d202709ec824c5e68a70c4668ce2e93708a4669810d52e2d8a611bfb9?network=sepolia), included in transaction [`0xef73...09f2`](https://eth-sepolia.blockscout.com/tx/0xef7316edd2383ec5ec44612f56b34192f2b1069517724e43bfe50912067909f2). Its emitted evidence showed the expected hash equaled the Bundler-returned hash, receipt `success` was `true`, exact replay failed with `AA25 invalid account nonce`, and direct unauthorized root change, module installation, and module removal all produced contract reverts. The project-scoped URL was not persisted in repository artifacts.

Copy `.env.example` to the ignored `.env.local` before running the verifiers. `SEPOLIA_RPC_URL` is required and every chain-backed verifier asserts chain ID `11155111`; there is no implicit network/provider fallback. Set `ZERODEV_SEPOLIA_BUNDLER_RPC` to the full Sepolia Bundler RPC URL copied from the ZeroDev project dashboard for hosted checks. The probe reports only whether the endpoint advertises EntryPoint 0.7 and never prints the URL. Neither variable uses Expo's `EXPO_PUBLIC_` prefix, so Expo does not inline it into the application bundle.

**UNKNOWN, physical Android evidence.** This report did not create or assert a credential on a supported physical Android device. PRA-185 owns RP/app association, platform attachment, user-verification evidence, cancellation/error behavior, and the direct native callback. The currently documented ZeroDev React Native wallet flow uses a Turnkey passkey stamper and is not evidence for ADR-0010's direct Kernel path.

## Primary source index

- ZeroDev's [pinned passkey guide](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/onboarding/passkeys/overview.mdx) selects Kernel 3.3, EntryPoint 0.7, and validator `V0_0_3_PATCHED`, then describes passing it as the sudo validator.
- Passkey validator release commit [`7b503b7`](https://github.com/zerodevapp/sdk/tree/7b503b7ac43697f253b07ca9faa3bd1462b2a182/plugins/passkey) contains package version 5.6.0, the patched enum, address map, UserOperation hashing, assertion request, DER conversion, installation data, and ABI envelope.
- WebAuthn key release commit [`5821761`](https://github.com/zerodevapp/sdk/tree/58217618a3f3957ee2a85ba1a29fc8119b2d2df3/plugins/webauthn-key) contains package version 5.5.0, base64url handling, response-type offset discovery, low-s normalization, and the Sepolia precompile selection.
- The official [`react-native-passkeys-utils`](https://github.com/zerodevapp/sdk/tree/34568f05853d954c2cd8559c847a93d7084a2beb/plugins/react-native-passkeys-utils) source supplies the direct native callback and final validator envelope. The separate [current React Native passkey guide](https://github.com/zerodevapp/docs/blob/main/docs/pages/wallets/react-native/passkeys.mdx) documents the Turnkey-backed wallet product and is intentionally not treated as direct-validator proof.
- Kernel release [`v3.3`](https://github.com/zerodevapp/kernel/tree/cd697c7e21715d015e0643af22310a99aa17433b) contains [`Kernel.initialize`, root dispatch, and protected root changes](https://github.com/zerodevapp/kernel/blob/cd697c7e21715d015e0643af22310a99aa17433b/src/Kernel.sol), plus the deterministic [`KernelFactory`](https://github.com/zerodevapp/kernel/blob/cd697c7e21715d015e0643af22310a99aa17433b/src/factory/KernelFactory.sol).
- EntryPoint [`v0.7.0`](https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/core/EntryPoint.sol#L382-L388) defines the final domain-separated UserOperation hash. [`UserOperationLib.hash`](https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/core/UserOperationLib.sol) defines the packed fields it binds.
- Sepolia Blockscout publishes the selected validator's [verified source and build settings](https://eth-sepolia.blockscout.com/address/0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69?tab=contract), including its explicit list of WebAuthn checks and omitted relying-party checks.
- KALOS's [2024 Kernel 7579 Plugins incremental report](https://github.com/zerodevapp/kernel/blob/cd697c7e21715d015e0643af22310a99aa17433b/audits/v_3_1_incremental_audit.pdf) identifies the reviewed WebAuthn validator as commit `ae10aa0f`; its date predates validator `0.0.3` deployment.

## Acceptance result and next actions

The candidate passes the hackathon compatibility gate: release availability, reproducible deployed build, direct-root design and storage, exact envelope tracing, positive and negative validator vectors, EntryPoint replay rejection, hosted estimation, sponsorship, submission, and receipts.

1. In PRA-185, select a native Android ceremony implementation that returns standard `authenticatorData`, `clientDataJSON`, and DER `signature` fields to the pinned `src/wallet/kernel-webauthn.ts` bridge. Do not bypass that bridge with a second envelope encoder or substitute the Turnkey wallet-react flow.
2. In PRA-187, repeat the successful operation path with the real Primary Passkey and retain the physical-device ceremony evidence from PRA-185.
3. In PRA-186/PRA-195, record the ZeroDev project identity and owners, Sepolia chain selection, Bundler access, EntryPoint 0.7 support, Paymaster sponsorship-policy rules, quota/billing limits, allowed callers/targets if configured, API-key access and rotation, and revocation procedure. Keep those dashboard-only settings and secrets separate from this redacted execution evidence.
4. Obtain from ZeroDev the unique source-history link and matching audit scope for validator `0x7ab1...9e69` before making a production security claim; build/runtime provenance is now independently reproduced.
5. Explicitly accept the validator's authenticator-enforced RP/origin boundary or select a validator that commits expected RP/origin policy on-chain. Do not mark the existing contract as rejecting freshly signed RP/origin mismatches.

PRA-187 may consume this document as the proven hackathon candidate pin and execution specification. It must not represent the synthetic credential as physical-device evidence or this report as a production security review.
