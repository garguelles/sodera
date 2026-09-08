# PRA-184: Kernel raw-P256 validator compatibility

Research date: 2026-09-08

> **Status:** This report records the rejected raw-P256 path. [ADR-0010](../adr/0010-direct-kernel-passkey.md) subsequently selected ZeroDev's released WebAuthn validator and a direct platform passkey for the hackathon. The custom-validator actions below are retained as evidence, not current implementation instructions.

## Decision

**FAIL: public primary sources show raw-P256 Kernel implementations, including an audited historical validator, a historical Sepolia deployment, and a newer ERC-7579 draft. However, no single candidate is simultaneously current, merged/released, audited, SDK-supported, and provenance-backed as deployed on Ethereum Sepolia.**

ZeroDev's historical `P256Validator` in `zerodevapp/kernel-plugins` is useful source evidence for the old Kernel v2.3 / EntryPoint v0.6 path. It was audited and a pre-audit build was deployed to Sepolia, but it fails the current-maintenance, current-Kernel, release, and maintained-SDK requirements. A newer ERC-7579 raw-P256 validator exists in draft PR #61, but it is unmerged, unaudited, unreleased, and has no published deployment or SDK adapter. Neither must be represented as a supported Kernel v3.3/v4 path.

ZeroDev's currently documented P-256 product is its progressive **passkey/WebAuthn** validator. It signs and verifies the WebAuthn envelope rather than a raw caller-supplied 32-byte digest, so it is explicitly outside PRA-184's candidate set.

Status vocabulary in this report:

- **PASS**: directly established by a first-party source and satisfies the requested property.
- **FAIL**: first-party evidence contradicts the requested property or required evidence is publicly absent after the searches described below.
- **UNKNOWN**: cannot be established from public primary sources; a private/dashboard/provider check may still answer it.

## Scope and search method

The candidate search required an owned source to connect all three concepts: P-256/secp256r1, a validator/plugin, and ZeroDev Kernel. GitHub code search was run for combinations of `P256Validator`, `secp256r1`, `IKernelValidator`, `Kernel`, and ERC-7579, including ZeroDev and Rhinestone organizations. Generic P-256 libraries, non-Kernel account implementations, and WebAuthn/passkey validators were not promoted to candidates.

This produced two contract candidates: ZeroDev's historical [`p256/src/P256Validator.sol`](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol) and the draft ERC-7579 [`P256Validator.sol`](https://github.com/zerodevapp/kernel-7579-plugins/blob/aa85e2f3459c25dae522b5d3ef05a4ec677693b3/src/validators/P256Validator.sol) in [PR #61](https://github.com/zerodevapp/kernel-7579-plugins/pull/61). Both repositories are owned by the `zerodevapp` GitHub organization and directly implement the relevant validator interfaces; this is explicit compatibility rather than an inference from generic curve support.

## Candidate: ZeroDev kernel-plugins P256Validator

### Overall conclusion

**FAIL for PRA-184's selected path.** It is a genuine raw-P256 Kernel validator, but only a historical, unreleased Kernel v2.3 / EntryPoint v0.6 implementation. KALOS audited its source and a pre-audit build was deployed to Sepolia, but no public evidence establishes current maintenance or Kernel v3.3/v4 compatibility.

### Ownership and maintenance

- **PASS, ownership:** the source is in [`zerodevapp/kernel-plugins`](https://github.com/zerodevapp/kernel-plugins), not a third-party copy. The contract imports and implements ZeroDev's `IKernelValidator` directly ([pinned source, lines 3-13](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol#L3-L13)).
- **FAIL, currently maintained:** the last commit touching `P256Validator.sol` was unsigned commit [`fc1c0f1`, 2024-02-22](https://github.com/zerodevapp/kernel-plugins/commit/fc1c0f15463016bc8e97bc28e4b835728487e53d). The repository's last push was 2024-05-08, and its latest commit only changed `WebAuthnValidator.sol` ([`8f3d7eb`](https://github.com/zerodevapp/kernel-plugins/commit/8f3d7ebe8db3efb86975949d8bf4428271e3c45b)). In contrast, Kernel itself continued through [v3.3](https://github.com/zerodevapp/kernel/releases/tag/v3.3) and current v4 beta work. No `kernel-plugins` release tags or package release were found.
- **FAIL, maintained client integration:** ZeroDev implemented a complete raw-P256 SDK adapter on the closed, unmerged [`add-p256-validator` branch at `739f36f`](https://github.com/zerodevapp/sdk/tree/739f36f8fb5d7a57b4e1126f485a2687153026a5) in [SDK PR #78](https://github.com/zerodevapp/sdk/pull/78). It was never merged or released. The plugin's [`p256/README.md`](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/README.md) remains the default Foundry template, while ZeroDev's current SDK/docs expose the passkey validator instead ([official passkey docs source](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/onboarding/passkeys/overview.mdx)).

### Kernel and EntryPoint compatibility

- **PASS, historical Kernel pin:** the plugin repository pins its Kernel submodule to [`5eb3450`](https://github.com/zerodevapp/kernel/tree/5eb3450294ac50ac8a120369ed69b98b75998240). That Kernel source declares `KERNEL_VERSION = "0.2.3"` ([pinned `Constants.sol`, lines 5-7](https://github.com/zerodevapp/kernel/blob/5eb3450294ac50ac8a120369ed69b98b75998240/src/common/Constants.sol#L5-L7)). The validator uses the v2 `IKernelValidator` shape: `enable`, `disable`, `validateUserOp(UserOperation,...)`, `validateSignature`, and `validCaller` ([pinned interface](https://github.com/zerodevapp/kernel/blob/5eb3450294ac50ac8a120369ed69b98b75998240/src/interfaces/IKernelValidator.sol)).
- **PASS, historical EntryPoint pin:** that source uses the unpacked `UserOperation` type and v0.6-style `initCode`, `paymasterAndData`, and gas fields. EntryPoint v0.6 defines `getUserOpHash` as `keccak256(abi.encode(userOp.hash(), address(this), block.chainid))` ([official v0.6 source](https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/core/EntryPoint.sol#L352-L358)).
- **FAIL, current Kernel:** the historical contract has no first-party source or test connecting it to Kernel v3.3 (EntryPoint v0.7) or Kernel v4 (current ERC-7579-style module/root semantics). Kernel v3.3 is a distinct release ([ZeroDev release](https://github.com/zerodevapp/kernel/releases/tag/v3.3)); the historical validator's unpacked `UserOperation` ABI is not the v0.7 `PackedUserOperation` ABI. A separate current-interface draft exists, documented below, but compatibility must not be transferred between implementations.
- **FAIL, hosted-current version fit:** ZeroDev's maintained passkey example explicitly selects Kernel v3.3, EntryPoint v0.7, and `PasskeyValidatorContractVersion.V0_0_3_PATCHED` ([official docs source, lines 55-70](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/onboarding/passkeys/overview.mdx#L55-L70)). There is no corresponding maintained raw-P256 selection.

### Install and root semantics

- **PASS, historical root initialization:** the first-party test makes `P256Validator` the `defaultValidator` and initializes Kernel with `KernelStorage.initialize(p256Validator, abi.encode(x, y, false))` ([pinned test, lines 23-31 and 63-67](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/test/P256Validator.t.sol#L23-L31)). Kernel v2.3 routes signature mode `0x00000000` to the default/sudo validator and removes that four-byte mode before calling it ([pinned Kernel source, lines 92-112 and 291-305](https://github.com/zerodevapp/kernel/blob/5eb3450294ac50ac8a120369ed69b98b75998240/src/Kernel.sol#L92-L112)).
- **PASS, historical enable/disable behavior:** `enable` ABI-decodes `(uint256 x,uint256 y,bool usePrecompiled)`, rejects either zero coordinate, and stores the tuple under `msg.sender`; `disable` deletes it ([validator source, lines 18-48](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol#L18-L48)). The test also invokes `enable` and `disable` through Kernel execution ([test, lines 69-98](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/test/P256Validator.t.sol#L69-L98)).
- **FAIL, key validation strength:** installation only rejects zero coordinates. It does not prove that `(x,y)` is on P-256 during installation ([validator source, lines 35-44](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol#L35-L44)).
- **UNKNOWN, current root/install semantics:** the newer draft provides ERC-7579 module tests, but there is no released adapter or end-to-end test establishing the selected Kernel v3.3/v4 `installModule`/`setRoot` path; the v2 `defaultValidator` proof cannot establish those semantics.

### Signature encoding and digest semantics

- **PASS, exact raw signature encoding:** after Kernel removes its four-byte root-validator mode prefix, `P256Validator.validateUserOp` requires exactly ABI-decodable `abi.encode(uint256 r, uint256 s)`, a 64-byte two-word encoding. This is not ASN.1 DER and not a WebAuthn envelope ([validator source, lines 51-63](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol#L51-L63); [test signing, lines 145-149](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/test/P256Validator.t.sol#L145-L149)). The complete historical root UserOp signature is `bytes4(0x00000000) || abi.encode(r,s)`.
- **PASS, exact UserOp digest:** the validator passes `_userOpHash` unchanged to P-256 verification ([validator source, lines 58-60](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol#L58-L60)). Under the pinned v0.6 EntryPoint, this hash binds the UserOperation fields (including sender, nonce, callData/initCode and gas/paymaster values), EntryPoint address, and `block.chainid` ([EntryPoint v0.6 `getUserOpHash`](https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/core/EntryPoint.sol#L352-L358)). It is signed directly as a 32-byte P-256 digest; no EIP-191 prefix is added in `signUserOp` ([test, lines 145-149](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/test/P256Validator.t.sol#L145-L149)).
- **PASS, low-s policy:** the helper rejects `s > n/2` before verification ([pinned `P256.sol`, lines 34-48](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/src/P256.sol#L34-L48)).
- **PASS, ERC-1271 digest distinction:** for `isValidSignature(hash, signature)`, historical Kernel first builds `keccak256(0x1901 || EIP712Domain(Kernel,0.2.3,chainId,kernelAddress) || hash)` and passes that digest to the validator ([pinned Kernel source, lines 246-271](https://github.com/zerodevapp/kernel/blob/5eb3450294ac50ac8a120369ed69b98b75998240/src/Kernel.sol#L246-L271)). The validator itself still expects raw `abi.encode(r,s)` ([validator source, lines 66-77](https://github.com/zerodevapp/kernel-plugins/blob/fc1c0f15463016bc8e97bc28e4b835728487e53d/p256/src/P256Validator.sol#L66-L77)).
- **FAIL, test consistency:** `getValidatorSignature` signs an EIP-191-wrapped UserOp hash, while `signUserOp` signs the raw UserOp hash ([test, lines 42-46 versus 145-149](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/test/P256Validator.t.sol#L42-L46)). Several inherited external-call tests are explicitly skipped ([test, lines 100-118](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/test/P256Validator.t.sol#L100-L118)). This suite is not the acceptance-level compatibility proof PRA-184 requires.

### P-256 verifier dependency

- **PASS, pinned verifier design:** when `usePrecompiled == false`, the helper calls Daimo's verifier at deterministic address `0xc2b78104907F722DABAc4C69f826a522B2754De4`; when true, it calls historical RIP-7212 address `0x100` ([plugin helper, lines 8-31](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/src/P256.sol#L8-L31)). The plugin submodule pins Daimo source commit [`29475ae`](https://github.com/daimo-eth/p256-verifier/tree/29475ae300ec95d98d5c7cc34c094846f0aa2dcd).
- **PASS, verifier review evidence only:** Daimo states that `P256Verifier` was audited by Veridise and publishes the [October 2023 audit PDF](https://github.com/daimo-eth/p256-verifier/blob/607d3ec8377a3f59d65eca60d87dee8485d2ebcc/audits/2023-10-veridise.pdf). Its tests include Wycheproof vectors ([Daimo README](https://github.com/daimo-eth/p256-verifier/blob/607d3ec8377a3f59d65eca60d87dee8485d2ebcc/README.md)). This evidence applies to the verifier primitive, not ZeroDev's validator integration.
- **PASS, historical validator audit:** KALOS's [February 22, 2024 report](https://github.com/zerodevapp/kernel/blob/cd697c7e21715d015e0643af22310a99aa17433b/audits/kalos_webauthn_v1.pdf) explicitly scopes `P256.sol`, `P256Validator.sol`, `WebAuthn.sol`, `WebAuthnValidator.sol`, and `Base64URL.sol`. It reviewed commit [`dfc53f9`](https://github.com/zerodevapp/kernel-plugins/commit/dfc53f96dc4513d3c410881adb722cc618878d47); fixes landed in [`fc1c0f1`](https://github.com/zerodevapp/kernel-plugins/commit/fc1c0f15463016bc8e97bc28e4b835728487e53d). This audit does not cover the newer ERC-7579 draft or the earlier deployed bytecode.

### Ethereum Sepolia deployment provenance

- **PASS, verifier dependency deployment:** Ethereum Sepolia has verified `P256Verifier` bytecode at [`0xc2b7...De4`](https://eth-sepolia.blockscout.com/address/0xc2b78104907F722DABAc4C69f826a522B2754De4). Blockscout attributes its deterministic deployment to CREATE2 transaction [`0x2d44...b0f9`](https://eth-sepolia.blockscout.com/tx/0x2d446200a73568abd3085906b56e763c4a38de6f6ab3307c7637b6a4ac25b0f9), block 4,817,328 on 2023-12-04, through the canonical deterministic deployment proxy `0x4e59...956C`. A direct Sepolia `eth_getCode` check on 2026-09-08 returned non-empty runtime bytecode. This proves only the verifier dependency.
- **PASS, historical validator deployment:** ZeroDev's closed [SDK PR #78](https://github.com/zerodevapp/sdk/pull/78) identifies `P256_VALIDATOR_ADDRESS` as [`0xea91Fc104e3EE4A249ae7CE617fd988Ef020DD0c`](https://sepolia.etherscan.io/address/0xea91Fc104e3EE4A249ae7CE617fd988Ef020DD0c). It was deployed in [transaction `0xf23faf...2279`](https://sepolia.etherscan.io/tx/0xf23fafcfa51f8a557a2fb8cbc2b44188228cd4de11a65fd41a8357351f882279), block 5,020,910, on 2024-01-04. Its selectors match the earlier `p256PublicKey(address)` implementation rather than the patched audited `p256ValidatorData(address)` implementation. The deployment is unverified and predates the audit, so it does not prove deployment of the reviewed source.
- **FAIL, reviewed/current deployment:** no provenance-backed deployment of the patched audited historical source or the current ERC-7579 draft was found on Ethereum Sepolia.

## Candidate: draft ERC-7579 P256Validator

### Overall conclusion

**FAIL for PRA-184's selected path.** ZeroDev's [kernel-7579-plugins PR #61](https://github.com/zerodevapp/kernel-7579-plugins/pull/61) adds a genuine raw-P256 validator and signer against current ERC-7579 interfaces, including `PackedUserOperation` validation and raw-digest tests. This materially reduces the likely custom-porting scope, but the PR is draft/unmerged and the implementation is unreleased, unaudited, without a maintained SDK adapter, and without a published Sepolia deployment.

### Current-interface evidence

- **PASS, raw P-256:** the draft [`P256Validator.sol`](https://github.com/zerodevapp/kernel-7579-plugins/blob/aa85e2f3459c25dae522b5d3ef05a4ec677693b3/src/validators/P256Validator.sol#L22-L118) and [`P256Signer.sol`](https://github.com/zerodevapp/kernel-7579-plugins/blob/aa85e2f3459c25dae522b5d3ef05a4ec677693b3/src/signers/P256Signer.sol#L23-L119) verify raw P-256 signatures rather than WebAuthn envelopes.
- **PASS, current module interfaces:** the validator implements ERC-7579 validator/stateless-validator interfaces and accepts `PackedUserOperation`; its [tests](https://github.com/zerodevapp/kernel-7579-plugins/blob/cd707175e3d2dfacf6fd36982f33a3d97f2b8a36/test/P256Validator.t.sol#L31-L60) exercise direct raw-digest validation.
- **FAIL, supported path:** PR #61 is draft and unmerged. No package release, maintained SDK adapter, audit report, verified deployment, or complete pinned Kernel root installation/execution proof was found.

## Excluded implementations

### ZeroDev progressive passkey validator

**FAIL, out of scope rather than incompatible.** ZeroDev's maintained documentation explicitly says current P-256 support is implemented through a progressive **passkey validator**, and its API starts from a `WebAuthnKey` ([official docs source](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/onboarding/passkeys/overview.mdx)). Its envelope includes authenticator/client data semantics; it is not evidence that arbitrary Android raw ECDSA `(r,s)` over PRA-184's chosen digest is accepted. The separate historical [`WebAuthnValidator.sol`](https://github.com/zerodevapp/kernel-plugins/blob/8f3d7ebe8db3efb86975949d8bf4428271e3c45b/p256/src/WebAuthnValidator.sol) and current ZeroDev/Rhinestone WebAuthn modules were excluded for the same reason.

### Generic P-256 contracts and ERC-7579 modules

**FAIL, insufficient compatibility evidence.** Daimo `p256-verifier`, FreshCryptoLib, OpenZeppelin `P256`/`SignerP256`, Safe passkey/P-256 signers, Barz secp256r1 facets, and generic ERC-7579 WebAuthn modules are primitives or modules for other account/module models. None of their owned sources explicitly supplies a raw-P256 ZeroDev Kernel root-validator path. PRA-184 prohibits inferring Kernel compatibility from curve support alone.

## ZeroDev-hosted Ethereum Sepolia compatibility

### Public evidence

- **PASS, network offered:** ZeroDev's owned setup guide says to create a dashboard project for the desired network and calls Sepolia a common starting point ([official source](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/get-started/sdks/setup-project.mdx)).
- **PASS, SDK tests model hosted Sepolia for both EntryPoint generations:** current ZeroDev SDK test configuration has Ethereum Sepolia entries under EntryPoint `0.6` and `0.7`, with hosted bundler URL and Sepolia project ID supplied by environment variables ([pinned SDK source](https://github.com/zerodevapp/sdk/blob/cd7c05b53b6ae6bede7dfefe9e59fbddfadf0c0a/packages/test/config.ts)). This is public evidence that the software/test configuration contemplates both combinations; it is not proof that a specific tenant endpoint currently enables both.
- **PASS, Sepolia P-256 verification availability:** current ZeroDev passkey docs list `Sepolia` among testnets with a native passkey precompile ([official docs source](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/onboarding/passkeys/overview.mdx)). Separately, the Daimo fallback is publicly deployed as established above. Neither fact supplies a Kernel raw-P256 validator.

### Dashboard-only or credentialed checks

- **UNKNOWN, project creation and endpoint:** ZeroDev requires creating a project in the dashboard and copying its project-scoped RPC URL ([official setup source](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/get-started/sdks/setup-project.mdx)). Public docs do not expose a tenant-independent Ethereum Sepolia endpoint with which to verify `eth_supportedEntryPoints` or bundler behavior.
- **UNKNOWN, EntryPoint v0.6 availability for a new project:** the SDK test config contains a v0.6/Sepolia matrix entry, but its URL and project ID are secrets. A live project must confirm that the dashboard still provisions v0.6 rather than merely retaining test compatibility.
- **UNKNOWN, arbitrary validator acceptance:** bundlers may enforce ERC-4337 validation rules, but no public ZeroDev source states that the historical raw-P256 validator bytecode/address is allowlisted, deployed, or supported. This requires a credentialed `eth_estimateUserOperationGas` / send test against the selected tenant endpoint after a validator deployment is pinned.
- **UNKNOWN, sponsorship:** sponsorship policy is configured per dashboard project. The guide requires selecting the network and enabling a gas policy; it is not publicly inspectable ([official setup source](https://github.com/zerodevapp/docs/blob/17089793cb87c30c46bd22719dc33dc994da8caf/docs/pages/get-started/sdks/setup-project.mdx)). This belongs to PRA-195/PRA-186 and is distinct from validator compatibility.

## Required next decision

No raw-P256 candidate passes. PRA-184 therefore reached its specified fallback, but the project subsequently rejected unreleased validator code and selected the released WebAuthn path in ADR-0010. The following list records what a future raw-P256 reconsideration would require; it is not approved hackathon scope.

The minimum approval scope is:

1. Target one pinned maintained Kernel release and EntryPoint version; do not port the old ABI by assumption.
2. Implement the current Kernel root-validator/module interface with explicit installation data `(x,y,verifier mode/address)`, uninstall behavior, root replacement authorization, and on-curve/key validity checks.
3. Specify one signature format, preferably fixed-width `r || s` or ABI `(r,s)`, and one digest contract. State whether Android returns DER and where canonical DER-to-fixed conversion and low-s normalization occur.
4. Prove that the signed digest is the exact EntryPoint-generated UserOp hash for the pinned version, binding sender/account, nonce, calls, gas/paymaster fields, EntryPoint address, and chain ID. Keep ERC-1271/message semantics separate.
5. Add positive vectors and negative cases for replay, wrong account, chain, EntryPoint, nonce/calls, malformed/DER signatures, high-s, invalid points, unauthorized install/uninstall/root changes, and verifier absence/revert.
6. Obtain explicit security review of the validator integration and its verifier call assumptions. The Daimo audit alone is not sufficient.
7. Deploy deterministically or publish the Ethereum Sepolia deployment transaction, verified source/compiler settings, runtime bytecode hash, constructor/immutable configuration, and the Kernel/factory/EntryPoint addresses used.
8. Run credentialed hosted-Sepolia bundler estimation/submission and record `eth_supportedEntryPoints`, receipts, account/validator addresses, and whether sponsorship was enabled. Label these dashboard-only checks separately from public evidence.

Until those checks pass, the decisive compatibility conclusion remains **FAIL: the historical path is audited and deployed but obsolete and unreleased, while the current ERC-7579 path is draft-only, unaudited, unreleased, and has no published deployment or maintained SDK adapter**.
