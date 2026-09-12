# Sodera — Web3-First Android Launcher

> **Historical architecture reference, not the current hackathon baseline.** This v0.5 source is retained for architectural context. The [current hackathon decisions](hackathon-decisions.md), [hackathon specs index](hackathon-specs.md), and [ADR-0010](adr/0010-direct-kernel-passkey.md) override conflicting requirements here, including the old Base/mainnet rollout, raw Android Keystore root, mandatory Google-free support, Arc priorities, wallpaper support, and feature priorities. The current build is testnet-only with Ethereum Sepolia as its single required network, a direct platform passkey using ZeroDev's released WebAuthn validator, Google-free GrapheneOS support deferred, Base deferred, Arc stretch, and wallpaper out of scope; production rollout remains unresolved. Apart from this notice and the section 2 ADR extraction, the original source is preserved below and must not be read as newly approved implementation scope.

**Product & Technical Specification**  
**Version:** 0.5  
**Status:** Draft / implementation baseline  
**Primary platform:** Android  
**Primary chain:** Base  
**Secondary chains:** Ethereum, Arc  
**Smart account framework:** ZeroDev Kernel  
**Account abstraction:** ERC-4337  
**Primary signer:** Device-bound Android Keystore P-256 key protected by biometrics  
**Wallet model:** Non-custodial, seedless smart account  
**Client:** React Native + Kotlin native modules

---

## 1. Product Summary

**Sodera** is an Android launcher where wallet identity and Web3 functionality are first-class parts of the home-screen experience.

It is simultaneously:

1. A full Android launcher / Home app.
2. A non-custodial smart-account wallet.
3. A Web3 identity surface built around the Sodera-owned `sodera.eth` ENSv2 namespace.
4. A payments and asset-management interface.
5. A swap surface powered by Uniswap.
6. A portfolio and on-chain activity surface powered by The Graph.
7. A future entry point for dapps, session permissions, on-chain applications, and Web3-native services.

The goal is **not** to build a traditional seed-phrase wallet inside a launcher.

The goal is to build:

> A Web3-native Android environment where the user's smart account is part of their device identity and the phone acts as an authorized signer.

The normal wallet experience should not require:

- a seed phrase
- a wallet password
- exporting a private key
- a custodial backend
- Google Password Manager
- Google Play Services
- Play Integrity for wallet access
- native gas tokens for normal sponsored transactions

The expected signing flow is:

```text
Transaction intent
      ↓
Human-readable review
      ↓
Biometric authorization
      ↓
Android Keystore P-256 signature
      ↓
ERC-4337 UserOperation
      ↓
ZeroDev Bundler
      ↓
ZeroDev Paymaster, when sponsored
      ↓
EntryPoint
      ↓
ZeroDev Kernel Smart Account
      ↓
Base / Ethereum
```

---

# 2. Locked Architecture Decisions

The original embedded decisions have been extracted into [standalone ADRs](adr/README.md). Their old identifiers map directly to zero-padded record numbers; the records preserve historical rationale and explicitly identify current hackathon scope changes.

| Original ID | Standalone Record |
| --- | --- |
| ADR-001 | [ADR-0001: Smart accounts instead of EOAs](adr/0001-smart-accounts.md) |
| ADR-002 | [ADR-0002: No default seed phrase](adr/0002-no-default-seed-phrase.md) |
| ADR-003 | [ADR-0003: Device-bound P-256 signer](adr/0003-device-bound-p256-signer.md), superseded for hackathon scope by ADR-0010 |
| ADR-004 | [ADR-0004: Biometrics authorize signing](adr/0004-biometrics-authorize-signing.md), with its Keystore flow superseded by ADR-0010 |
| ADR-005 | [ADR-0005: Base first](adr/0005-base-first.md), superseded for hackathon scope only by ADR-0009 |
| ADR-006 | [ADR-0006: ZeroDev account abstraction](adr/0006-zerodev-account-abstraction.md), with Sepolia requirement and optional Arc infrastructure exception |
| ADR-007 | [ADR-0007: No required Google services](adr/0007-no-required-google-services.md), deferred for hackathon scope by ADR-0010 |
| ADR-008 | [ADR-0008: Play Integrity cannot gate assets](adr/0008-play-integrity-cannot-gate-assets.md) |

[ADR-0009: Ethereum Sepolia as the single required hackathon testnet](adr/0009-ethereum-sepolia-hackathon.md) records the subsequent network decision. [ADR-0010: Platform passkey directly authorizes Kernel](adr/0010-direct-kernel-passkey.md) records the later signer pivot. Neither resolves production rollout. See the [ADR index](adr/README.md) for approval provenance and status, and [CONTEXT.md](../CONTEXT.md) for the resolved domain vocabulary.

---

# 3. High-Level Architecture

```text
                         WEB3 ANDROID LAUNCHER
                                  │
                ┌─────────────────┴─────────────────┐
                │                                   │
         React Native UI                      Android Native
                │                                   │
        Launcher + Wallet UI                  Kotlin Modules
                │                                   │
                │                            ┌──────┴───────┐
                │                            │              │
                │                     Launcher APIs    DeviceSigner
                │                                           │
                │                                    BiometricPrompt
                │                                           │
                │                                    Android Keystore
                │                                           │
                │                                  P-256 private key
                │                                  NEVER EXPORTED
                │                                           │
                └──────────────────────┬────────────────────┘
                                       │
                                  Wallet Engine
                                       │
                                      Viem
                                       │
                                ZeroDev SDK / Kernel
                                       │
                            Raw P-256 Kernel Validator
                                       │
                              P256VERIFY @ 0x100
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                        Base                    Ethereum
```

---

# 4. Chain Strategy

## 4.1 Base

Base is the primary production network for V1.

Supported initially:

- Base Sepolia
- Base mainnet

The application SHOULD be designed around stablecoin-oriented usage, with USDC as the primary payment asset for initial product flows.

Base support MUST be verified with an automated integration test that calls `P256VERIFY` at `0x100` using a signature generated from the Android-compatible P-256 test vectors.

Do not rely only on a chain-support list in application code.

---

## 4.2 Ethereum

Ethereum is the second production target.

EIP-7951 is Final and defines `P256VERIFY` at address `0x100` using the same 160-byte interface shape as the existing L2 P-256 precompile family.

The wallet abstraction MUST therefore avoid Base-specific signing assumptions.

Chain configuration should determine whether native P-256 verification is available.

---

## 4.3 Arc

Arc is an additional hackathon and product network focused on stablecoin-native payments.

Initial support SHOULD target:

- Arc testnet during development
- Arc mainnet or deployment-ready mainnet configuration for the ETHOnline submission
- USDC-first send / receive flows

Arc is not allowed to change the wallet ownership model. The user's account remains a ZeroDev Kernel smart account controlled by the same device-bound P-256 signer architecture.

ZeroDev's public supported-network list does not currently list Arc. Therefore Arc support MUST be implemented behind the existing account-abstraction infrastructure boundary:

```text
ZeroDev Kernel Smart Account
        ↓
ZeroDev SDK / Kernel client
        ↓
ERC-4337 infrastructure adapter
        ↓
Arc
```

Preferred order:

1. Use ZeroDev-hosted Bundler and Paymaster if Arc becomes available in the ZeroDev dashboard.
2. Otherwise use an Arc-compatible ERC-4337 Bundler / Paymaster while retaining ZeroDev Kernel and the ZeroDev SDK.
3. Do not replace Kernel merely to satisfy the Arc integration.

The Arc integration MUST demonstrate a real USDC payment flow from the launcher wallet rather than a read-only network switch.

---

## 4.4 Chain configuration

Chain configuration MUST be centralized.

Example:

```ts
type ChainConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;

  entryPoint: Address;
  entryPointVersion: string;

  kernelVersion: string;
  kernelFactory: Address;

  p256: {
    mode: "native-precompile" | "contract-fallback";
    address: Address;
  };

  bundler: {
    provider: "zerodev";
    url: string;
  };

  paymaster?: {
    provider: "zerodev";
    url: string;
  };
};
```

Chain addresses and contract versions MUST NOT be spread through feature code.

---

# 5. ZeroDev Kernel Architecture

ZeroDev Kernel is the selected smart-account framework.

Kernel provides modular account validation and plugin/module composition and supports ERC-4337 and ERC-7579-style extensibility.

Conceptually:

```text
Kernel Account
     │
     ├── Root / sudo validator
     │      Raw Android P-256 signer
     │
     ├── Recovery validator(s)
     │      Passkey / second device / guardian
     │
     ├── Permission signer(s)      [future]
     │      Session keys
     │
     ├── Policies                 [future]
     │      Spend limits
     │      Contract allowlists
     │      Expiration
     │
     └── Executors / hooks        [future]
```

The primary P-256 validator is the root ownership authority for V1.

Signer-management and recovery operations MUST receive equal or stronger authorization treatment than asset transfers.

---

# 6. ZeroDev Version Policy

ZeroDev SDK, Kernel, validator, EntryPoint, and plugin versions MUST be explicitly pinned.

Do not rely on SDK defaults for security-critical wallet parameters.

The repository MUST record at minimum:

```ts
type AccountImplementationMetadata = {
  kernelVersion: string;
  entryPointVersion: string;
  entryPointAddress: Address;
  factoryAddress: Address;
  rootValidatorAddress: Address;
  rootValidatorVersion: string;
};
```

The implementation MUST NOT silently migrate accounts when SDK packages are upgraded.

Any change to:

- Kernel implementation
- EntryPoint version
- root validator
- signature format
- account factory
- recovery module

requires an explicit migration plan and ADR.

This requirement is informed in part by the Peanut reference implementation, which contains explicit validator-version migration handling and guards against stale validator clients.

---

# 7. Primary Android Device Signer

## 7.1 Key generation

The native Android layer MUST generate a P-256 key pair with Android Keystore.

Requirements:

- algorithm: ECDSA
- curve: P-256 / secp256r1
- private key: non-exportable
- authentication required for signing
- hardware-backed when supported
- StrongBox preferred when supported and appropriate

The application MUST record only non-secret signer metadata outside Keystore.

Example:

```ts
type DeviceSignerMetadata = {
  id: string;
  keyAlias: string;
  publicKeyX: Hex;
  publicKeyY: Hex;
  securityLevel:
    | "strongbox"
    | "trusted-environment"
    | "software";
  createdAt: string;
};
```

`keyAlias` is not a secret but SHOULD remain internal to the native signer implementation.

---

## 7.2 Forbidden APIs

The codebase MUST NOT expose functions such as:

```ts
getPrivateKey()
exportPrivateKey()
backupPrivateKey()
getSeedPhrase()
exportSeedPhrase()
```

No such function should exist even as an unused debug helper in production code.

---

## 7.3 React Native boundary

React Native MUST never receive private key material.

Allowed data across the bridge:

```text
public key
signer ID
security metadata
signature r/s
errors / status
```

Forbidden data:

```text
private key
seed
raw biometric data
Keystore secret material
```

---

# 8. Native DeviceSigner Interface

Conceptual TypeScript-facing API:

```ts
interface DeviceSigner {
  create(): Promise<{
    signerId: string;
    publicKeyX: Hex;
    publicKeyY: Hex;
    securityLevel:
      | "strongbox"
      | "trusted-environment"
      | "software";
  }>;

  sign(input: {
    signerId: string;
    digest: Hex;
    reason: string;
  }): Promise<{
    r: Hex;
    s: Hex;
  }>;

  exists(signerId: string): Promise<boolean>;

  getMetadata(signerId: string): Promise<DeviceSignerMetadata>;

  delete(signerId: string): Promise<void>;
}
```

`sign()` MUST trigger biometric authorization according to wallet security policy.

The native layer SHOULD normalize ECDSA signatures as required by the on-chain validator policy.

DER parsing MUST be performed natively or in a tightly controlled cryptographic utility layer rather than in UI code.

---

# 9. Biometric Signing

## 9.1 Default behavior

Unrestricted wallet transactions MUST require explicit user confirmation followed by biometric authorization.

```text
Review
  ↓
Confirm
  ↓
BiometricPrompt
  ↓
Keystore signature
```

The application MUST NOT silently sign transactions in response to background activity, dapp messages, push notifications, or deep links.

---

## 9.2 Device credential fallback

Whether PIN / pattern / device credential is accepted as a fallback to strong biometrics is a separate product-security decision.

For the initial POC:

- strong biometrics SHOULD be preferred
- device credential fallback MAY be enabled for development
- production behavior MUST be documented explicitly before launch

---

# 10. Raw P-256 Kernel Validator

This is the most important account-abstraction integration specific to this project.

Peanut uses ZeroDev's WebAuthn/passkey validator. Our root signer does **not** use WebAuthn for the primary key.

Our signature flow is:

```text
Android Keystore
      ↓
P-256 sign(digest)
      ↓
r + s
      ↓
Kernel raw P-256 validator
      ↓
P256VERIFY
```

There is no requirement for the primary signer to produce:

- `clientDataJSON`
- `authenticatorData`
- RP ID
- WebAuthn credential ID

Therefore the project MUST NOT simply use `@zerodev/passkey-validator` for the primary root signer unless its signing/validation model is explicitly adapted to raw Keystore signatures.

---

## 10.1 Validator POC decision gate

Before the full wallet is built, the team MUST determine whether the currently supported ZeroDev ecosystem contains a maintained raw P-256 validator compatible with the selected Kernel version.

If yes:

- evaluate it
- inspect its audit history
- pin its exact contract and package version

If no:

- implement a minimal ERC-7579-compatible Kernel validator
- store the owner's P-256 public key coordinates
- validate the UserOperation digest with `P256VERIFY`
- use the standardized precompile interface where available
- use a reviewed fallback verifier only for chains where native verification is unavailable

ZeroDev explicitly supports custom validators/plugins, so a custom validator is compatible with the selected account model.

---

## 10.2 Validator conceptual contract

Illustrative only:

```solidity
interface IP256RootValidator {
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 validationData);
}
```

Per-account validator state conceptually includes:

```text
wallet
  → publicKeyX
  → publicKeyY
```

Signature contains:

```text
r
s
```

Verification input:

```text
hash || r || s || qx || qy
```

which maps naturally to the standardized `P256VERIFY` interface.

---

## 10.3 P-256 fallback

Base and modern Ethereum targets should use the native precompile when available.

For unsupported EVM networks, an audited verifier such as the Daimo P256 verifier can be evaluated as a fallback.

V1 does not need to support arbitrary EVM chains.

Prefer reducing chain count rather than increasing cryptographic verification complexity.

---

# 11. Smart Account Creation

## 11.1 User flow

```text
Welcome
   ↓
Create Wallet
   ↓
Create secure device signer
   ↓
Biometric confirmation
   ↓
Derive Kernel counterfactual address
   ↓
Configure recovery
   ↓
Wallet ready
```

No seed phrase is shown.

No wallet password is required.

No private key is shown.

---

## 11.2 Technical flow

1. Native `DeviceSigner.create()` generates a P-256 key.
2. Native layer returns only X/Y public coordinates and signer metadata.
3. Wallet Engine constructs the ZeroDev Kernel account with the P-256 root validator.
4. Kernel factory configuration determines a deterministic/counterfactual smart-account address.
5. Account may remain undeployed until the first UserOperation.
6. Recovery configuration is registered before significant funds are encouraged to be deposited.
7. Account metadata is persisted locally and optionally synchronized as non-secret metadata.

---

# 12. Wallet Recovery

Recovery is a first-class wallet feature.

Because the root key is intentionally non-exportable:

```text
Recovery ≠ recover old private key
Recovery = authorize a new signer
```

The smart account is persistent on-chain while device signers are replaceable.

---

## 12.1 MVP recovery model

A production wallet MUST support at least one recovery signer independent of the primary device.

Recommended MVP model:

```text
Kernel Smart Account
       │
       ├── Primary signer
       │      Android Keystore P-256
       │
       └── Recovery signer
              WebAuthn passkey or second-device credential
```

The exact ZeroDev recovery module / validator implementation is an implementation decision to be selected after the root-signing POC.

---

## 12.2 Future recovery model

```text
Kernel Smart Account
       │
       ├── Phone A — device P-256
       ├── Phone B — device P-256
       ├── Passkey — recovery
       ├── Hardware FIDO key — recovery
       └── Guardians — recovery
```

The backend MUST NEVER possess unilateral authority to replace the root signer.

---

# 13. Device Migration

Normal migration:

```text
Phone A
Signer A
   │
   │ authorize
   ↓
Phone B generates Signer B
   │
   ↓
Add Signer B
   │
   ↓
Verify Signer B works
   │
   ↓
Optional: remove Signer A
```

The wallet address and assets do not change.

Only authorization changes.

---

# 14. Lost Device Recovery

```text
Phone A lost
      ↓
Authenticate recovery signer
      ↓
Phone B generates new P-256 signer
      ↓
Recovery action installs Signer B
      ↓
Remove Signer A
      ↓
Same Kernel account
Same address
Same assets
```

The UX SHOULD communicate:

> Your wallet lives on-chain. Your phone is one of the credentials authorized to control it.

---

# 15. ERC-4337 Transaction Flow

All smart-account transactions MUST use ERC-4337 UserOperations unless an explicit future architecture changes this.

```text
UI transaction intent
      ↓
Wallet Engine
      ↓
construct calls
      ↓
construct UserOperation
      ↓
simulate
      ↓
human-readable review
      ↓
user confirms
      ↓
biometric authentication
      ↓
DeviceSigner signs digest
      ↓
attach P-256 signature
      ↓
ZeroDev Bundler
      ↓
EntryPoint
      ↓
Kernel account
      ↓
target contract
```

---

# 16. Transaction Review

Before biometric signing, the user SHOULD be shown a human-readable summary.

Example:

```text
Send

100 USDC

To
alice.eth
0x7234...9A21

Network
Base

Network fee
Sponsored

[ Cancel ]     [ Confirm ]
```

The biometric prompt should appear only after explicit confirmation.

---

# 17. Transaction Simulation

UserOperations SHOULD be simulated before signing.

Simulation should detect where possible:

- execution revert
- insufficient balance
- invalid calldata
- unsupported token
- incorrect chain
- failed smart-account validation
- failed Paymaster policy

A failed simulation SHOULD block the normal send path.

An advanced override is not required for V1.

---

# 18. ZeroDev Bundler

The MVP MUST use the ZeroDev Bundler.

The Bundler client MUST be wrapped by the Wallet Engine.

Feature code MUST NOT call Bundler-specific RPC methods directly.

Conceptual interface:

```ts
interface BundlerClient {
  estimateUserOperation(op: UserOperation): Promise<GasEstimate>;
  sendUserOperation(op: UserOperation): Promise<UserOperationHash>;
  waitForReceipt(hash: UserOperationHash): Promise<UserOperationReceipt>;
}
```

The implementation MUST explicitly validate that Bundler configuration is present.

It MUST NOT silently fall back to an ordinary public RPC URL when ERC-4337 RPC configuration is missing.

This guard is inspired by a real failure mode documented in Peanut's ZeroDev integration.

---

# 19. ZeroDev Paymaster

The MVP SHOULD use ZeroDev Paymaster infrastructure for sponsored operations.

Initial sponsored operations may include:

- initial Kernel deployment
- first user transactions
- USDC sends
- signer addition
- signer removal
- recovery transactions

The exact sponsorship policy is a backend/product policy rather than wallet ownership logic.

---

## 19.1 Paymaster abuse controls

Free gas MUST be protected from abuse.

Potential signals:

```text
wallet age
account usage
transaction value
operation type
rate limits
device installation ID
IP / network reputation
historical sponsorship consumption
optional attestation
optional Play Integrity
```

Failure to qualify for sponsorship MUST NOT prevent the wallet from functioning.

The fallback is:

```text
Sponsored transaction unavailable
          ↓
user pays gas from smart account
```

or another supported gas-payment mechanism.

---

# 20. Wallet Engine

The React Native application SHOULD interact with one high-level Wallet Engine rather than calling ZeroDev SDK objects throughout the UI.

Conceptual API:

```ts
interface WalletEngine {
  createAccount(): Promise<WalletAccount>;

  getAccount(): Promise<WalletAccount>;

  getAddress(): Address;

  getBalances(): Promise<Balance[]>;

  prepareTransaction(
    intent: TransactionIntent
  ): Promise<PreparedOperation>;

  simulate(
    operation: PreparedOperation
  ): Promise<SimulationResult>;

  signAndSend(
    operation: PreparedOperation
  ): Promise<UserOperationHash>;

  getActivity(): Promise<Activity[]>;

  addSigner(
    signer: PublicSigner
  ): Promise<UserOperationHash>;

  removeSigner(
    signerId: string
  ): Promise<UserOperationHash>;
}
```

UI code SHOULD NOT know about:

- EntryPoint calldata
- Bundler RPC methods
- Paymaster RPC methods
- validator encoding
- P-256 ABI encoding
- factory deployment calldata

---

# 21. Backend Architecture

A backend is useful but MUST NOT be part of the signing trust root.

Potential backend capabilities:

```text
API
 ├── portfolio indexing
 ├── token metadata
 ├── fiat prices
 ├── transaction notifications
 ├── Paymaster policy
 ├── remote chain configuration
 ├── feature flags
 ├── recovery coordination metadata
 └── device / abuse risk signals
```

Core invariant:

```text
Backend compromised
      ≠
Wallet compromised
```

The backend MUST NOT possess a universal key or credential capable of transferring arbitrary user assets.

---

# 22. Android Launcher Architecture

The application is both a normal Android app and an Android Home application.

Native launcher responsibilities:

- register Home activity
- discover launchable applications
- launch applications
- resolve labels and icons
- listen for installed/removed package changes
- handle launcher lifecycle behavior
- wallpaper integration
- shortcuts later
- widget hosting later

React Native responsibilities:

- home-screen layout
- app drawer
- wallet UI
- search UI
- settings
- portfolio
- transaction activity
- Web3 features

---

# 23. Launcher MVP

V1 launcher features:

- register as Android launcher
- set as default Home app
- display installed apps
- launch apps
- app search
- favorites / pinned apps
- minimal home layout
- wallpaper support
- launcher settings
- wallet entry point

Not required for initial MVP:

- Android widgets
- advanced folder behavior
- Pixel-style animations
- icon packs
- notification dots
- complex gesture customization
- deep shortcut editing

---

# 24. Wallet MVP

The first production-capable wallet should support:

- create Kernel smart account
- Android Keystore P-256 signer
- biometric transaction signing
- Base mainnet
- Base Sepolia
- Arc testnet
- Arc mainnet / deployment-ready Arc configuration
- receive native assets
- receive ERC-20 assets
- send ETH
- send ERC-20
- USDC-first UX
- token balances
- portfolio value powered by The Graph
- recent transaction activity powered by The Graph
- launcher-owned ENSv2 identity / subname
- ENS name resolution for send flows
- Uniswap swap flow
- UserOperation simulation
- ZeroDev Bundler
- ZeroDev Paymaster
- recovery configuration
- signer management
- device migration

---

# 25. Explicit V1 Non-Goals

Do not include initially:

- BIP-39 seed phrases
- private-key import/export
- arbitrary EOA import
- NFTs
- bridges
- staking
- lending
- perpetuals
- built-in dapp browser
- WalletConnect
- dozens of chains
- session keys
- social recovery
- custom chain addition
- multisig approval UX
- full Android widget hosting
- elaborate launcher animations

These may be added after the signing, account, recovery, and launcher foundations are proven.

---

# 26. Wallet-Centric Launcher UX

Proposed home surface:

```text
┌──────────────────────────────┐
│  10:42                 82%   │
│                              │
│  gm                          │
│  0x72F...91AD               │
│                              │
│  Portfolio                   │
│  $••••••                     │
│                              │
│  ETH       USDC              │
│                              │
│  [Send] [Receive] [Activity] │
│                              │
│  Browser      Camera         │
│  Signal       Spotify        │
│                              │
└──────────────────────────────┘
```

Initial gestures:

```text
Swipe up       → app drawer
Tap portfolio  → wallet
Tap asset      → asset details
Tap address    → receive
Long press     → launcher settings
```

---

# 27. Home-Screen Financial Privacy

The launcher is visible frequently and may be observed by other people.

Default recommendation:

```text
Portfolio
$••••••
```

Settings SHOULD eventually allow:

```text
Home Screen Privacy

[x] Hide total portfolio
[x] Hide token balances
[x] Hide transaction previews
[ ] Show wallet address
```

Sensitive financial data SHOULD be independently lockable from ordinary launcher usage.

Opening the app drawer must not require wallet authentication.

---

# 28. GrapheneOS Support

GrapheneOS is a supported target, not an unsupported edge case.

The wallet MUST function on a GrapheneOS device without installing sandboxed Google Play.

Required core dependencies should remain within standard Android / AOSP capabilities:

```text
Android Keystore
KeyMint / hardware-backed keys
BiometricPrompt
networking
package manager / launcher APIs
React Native runtime
```

---

## 28.1 Device integrity

If device attestation is added, prefer standard Android hardware key attestation as an integrity signal rather than making Play Integrity authoritative.

A future attestation backend MAY support official GrapheneOS verified-boot signing keys.

Attestation is for risk assessment, not wallet custody.

---

## 28.2 Rooted / compromised devices

The wallet SHOULD detect materially reduced device security where practical and warn the user.

Example:

```text
Security warning

This device may provide reduced protection
for your wallet signing key.

[ Learn More ]
[ Continue ]
```

Whether certain configurations are blocked is a future policy decision.

Recovery MUST remain possible from a healthy second signer.

---

# 29. Google Play Distribution

The application is intended for Google Play distribution in addition to direct APK distribution.

Recommended distribution:

```text
Google Play
  → Android App Bundle

GitHub Releases / project site
  → signed APK
```

Both builds SHOULD derive from the same source and signing/release process.

---

## 29.1 Play developer account

Because the app provides a cryptocurrency software wallet / financial service, release planning should assume a Google Play **Organization** developer account.

An organization account requires organization verification and a D-U-N-S number.

---

## 29.2 Financial Features declaration

The app MUST complete Google Play's Financial Features declaration.

The application should declare the relevant category including:

- cryptocurrency wallet

The wallet is non-custodial.

Google's cryptocurrency exchanges/software-wallet policy currently states that non-custodial wallets are outside the scope of that specific policy, but other Google Play policies, financial declarations, and local legal requirements still apply.

This policy MUST be re-checked immediately before production release because financial-app requirements can change.

---

# 30. Play Integrity Policy

The application MUST NOT require Play Integrity for the wallet to operate.

Allowed use:

```text
Paymaster risk scoring
abuse prevention
promotional eligibility
optional telemetry signal
```

Forbidden use:

```text
unlock wallet
sign transaction
recover wallet
remove signer
view wallet address
access user assets
```

A GrapheneOS device should therefore be able to use the wallet normally even when Play Integrity signals differ from Google-certified stock Android.

---

# 31. Suggested Technology Stack

## Client

```text
React Native
TypeScript
Viem
TanStack Query
React Navigation or equivalent
```

## Android native

```text
Kotlin
Android Keystore
BiometricPrompt
KeyInfo / security-level inspection
StrongBox where available
PackageManager / Launcher APIs
```

## Smart accounts

```text
ZeroDev Kernel
ERC-4337
ERC-7579-compatible validator architecture
ERC-1271
```

## P-256

```text
Android Keystore P-256 signer
P256VERIFY @ 0x100
Custom/raw ZeroDev Kernel validator if required
Daimo P256 verifier considered only as fallback/reference
```

## Account-abstraction infrastructure

```text
ZeroDev Bundler
ZeroDev Paymaster
```

## Chain

```text
Base Sepolia
Base mainnet

Later:
Ethereum Sepolia
Ethereum mainnet
```

---

# 32. Suggested Repository Structure

```text
android/
  app/

  launcher/
    LauncherModule.kt
    InstalledAppsModule.kt
    PackageEventsModule.kt

  wallet/
    DeviceSignerModule.kt
    DeviceSigner.kt
    BiometricSigner.kt
    KeystoreManager.kt
    HardwareSecurity.kt
    P256SignatureParser.kt

src/
  launcher/
    home/
    drawer/
    apps/
    settings/

  wallet/
    engine/
    account/
    zerodev/
    signer/
    validator/
    operations/
    bundler/
    paymaster/
    transactions/
    portfolio/
    recovery/

  chains/
    config/
    rpc/

  features/
    send/
    receive/
    activity/
    security/
    recovery/

contracts/
  src/
    P256RootValidator.sol

  test/
    P256RootValidator.t.sol

  script/
```

The `contracts/` directory is required only if the POC confirms that a custom raw-P256 Kernel validator is needed.

---

# 33. Security Invariants

These are non-negotiable architecture rules.

## INV-001

Private signing keys never enter the React Native / JavaScript runtime.

## INV-002

The primary P-256 private key never leaves Android Keystore.

## INV-003

Biometric data is never treated as a private key or key derivation input.

## INV-004

The backend cannot independently transfer wallet assets.

## INV-005

Every unrestricted value-moving operation requires explicit user authorization.

## INV-006

Signer-management operations require equivalent or stronger authorization than ordinary transfers.

## INV-007

No seed phrase exists in the default wallet architecture.

## INV-008

Loss of one device does not destroy the smart account when recovery is configured.

## INV-009

React Native never selects arbitrary Keystore keys; wallet signer identity is explicitly bound to a signer ID / Keystore alias.

## INV-010

Transactions are bound to the expected chain, account, nonce, EntryPoint, and operation contents.

## INV-011

Missing ZeroDev Bundler/Paymaster configuration causes an explicit wallet infrastructure error rather than falling back silently to an incompatible RPC.

## INV-012

Play Integrity cannot lock users out of their wallet.

## INV-013

SDK upgrades cannot silently migrate the account implementation or validator.

## INV-014

The launcher remains useful as a launcher even if wallet infrastructure is temporarily unavailable.

---

# 34. Threat Model

The system SHOULD explicitly design for:

### Lost phone

Mitigation: recovery signer + signer removal.

### Stolen unlocked phone

Mitigation: per-operation biometric authorization and wallet privacy controls.

### Compromised backend

Mitigation: backend possesses no root signing authority.

### Compromised RPC

Mitigation: chain ID validation, simulation consistency, multiple-provider option later, trusted transaction construction.

### Malicious deep link

Mitigation: deep links create transaction intents only; they can never directly sign.

### Clipboard address replacement

Mitigation: prominently display destination and checksum/ENS before biometric authorization.

### React Native compromise

Mitigation: signing key remains native/Keystore-bound; however malicious JS could request a malicious signature, so transaction review and signed-digest construction boundaries need careful review.

### Supply-chain dependency compromise

Mitigation: lockfiles, pinned versions, reviewed dependency updates, security-critical package isolation.

### Paymaster abuse

Mitigation: server-side policy, rate limits, sponsorship allowlists, optional integrity signals.

### Validator migration mistake

Mitigation: explicit version metadata, migration tests, no silent upgrades.

---

# 35. Signing Boundary Hardening

For V1, the Wallet Engine may construct the UserOperation hash in TypeScript and request native signing.

Before production release, evaluate moving additional transaction-context validation into Kotlin so a compromised JavaScript layer cannot present benign UI while requesting an unrelated digest.

Potential stronger native signing API:

```ts
signUserOperation({
  chainId,
  account,
  entryPoint,
  userOperationHash,
  displaySummaryHash
})
```

A future hardened design could have the native layer independently validate or construct the final signing digest from typed operation fields.

This should be treated as a security-review item before meaningful value is stored in the wallet.

---

# 36. Observability

Logs MUST NOT contain:

- private keys
- raw sensitive authentication material
- recovery secrets
- full biometric-related data

Safe operational fields may include:

- chain ID
- smart-account address
- UserOperation hash
- transaction hash
- Bundler request ID
- validator version
- account version
- failure category
- signer security level

Crash reporting MUST scrub transaction-sensitive data where practical.

---

# 37. Testing Strategy

## 37.1 Native signer tests

Test:

- P-256 key creation
- key hardware/security level detection
- biometric authorization
- invalid biometric handling
- canceled biometric flow
- DER signature parsing
- `r` / `s` correctness
- low-S policy where required
- signer deletion
- invalidated Keystore keys

---

## 37.2 On-chain P-256 tests

Test vectors MUST verify:

```text
Android-compatible P-256 signature
      ↓
P256VERIFY @ 0x100
      ↓
true
```

Also test:

- wrong digest
- wrong public key
- malformed signature
- out-of-range values
- chain with unsupported precompile

---

## 37.3 Kernel validator tests

Test:

- account installation
- root ownership
- valid UserOperation
- invalid signature
- replay attempt
- wrong account
- wrong chain context
- validator installation/removal
- recovery signer installation

---

## 37.4 ERC-4337 integration tests

Base Sepolia automated test:

```text
create counterfactual account
      ↓
fund test asset
      ↓
construct UserOperation
      ↓
sponsor with ZeroDev
      ↓
sign with P-256 test signer
      ↓
submit through ZeroDev Bundler
      ↓
wait for UserOperation receipt
      ↓
verify state change
```

---

## 37.5 Device tests

Test on at least:

- GrapheneOS Pixel device
- stock Pixel / Android device
- StrongBox-capable device
- device without StrongBox
- emulator for non-security UI tests

The cryptographic security path SHOULD NOT rely only on emulator tests.

---

## 37.6 Lifecycle tests

Explicitly test:

- app update
- Android OS update
- add biometric
- remove biometric
- reset screen lock
- app data clear
- app uninstall/reinstall
- factory reset
- Keystore invalidation
- device migration
- lost-device recovery

---

# 38. POC Milestone 0 — Prove P-256

This is the first technical milestone.

Build a minimal Android application that:

1. Generates a P-256 key in Android Keystore.
2. Reports whether the key is StrongBox / hardware-backed / software-backed.
3. Returns the public X/Y coordinates.
4. Uses `BiometricPrompt` before signing.
5. Signs a fixed 32-byte digest.
6. Parses the resulting signature into `r` and `s`.
7. Verifies the signature locally.
8. Verifies the same signature against `P256VERIFY` on Base Sepolia.

Success condition:

```text
Android Keystore
       ↓
Biometric
       ↓
P-256 signature
       ↓
Base Sepolia P256VERIFY
       ↓
VALID
```

No ZeroDev yet.

---

# 39. POC Milestone 1 — Prove ZeroDev Kernel + raw P-256

Determine the maintained ZeroDev path for a raw P-256 root validator.

Preferred order:

1. Use an actively maintained ZeroDev raw P-256 validator if one exists for the chosen Kernel version.
2. Otherwise implement a minimal custom ERC-7579 validator compatible with Kernel.

Then:

```text
Android P-256 public key
       ↓
Kernel counterfactual account
       ↓
Raw P-256 root validator
       ↓
Android signs UserOperation hash
       ↓
ZeroDev Bundler
       ↓
Base Sepolia
       ↓
UserOperation succeeds
```

Success condition:

> A Kernel account controlled only by the Android Keystore P-256 key executes a valid UserOperation.

This is the most important architecture proof in the project.

---

# 40. POC Milestone 2 — Gas Sponsorship

Add ZeroDev Paymaster.

Demonstrate:

```text
Smart account has USDC
Smart account has 0 ETH
       ↓
Send USDC
       ↓
Biometric signature
       ↓
ZeroDev-sponsored UserOperation
       ↓
Transaction succeeds
```

Success condition:

> User can send a supported asset without holding native gas.

---

# 41. POC Milestone 3 — Recovery

Add a second signer / recovery credential.

Demonstrate:

```text
Signer A controls account
       ↓
Add Signer B
       ↓
Sign with B
       ↓
Remove A
       ↓
Account remains accessible
```

Success condition:

> The original non-exportable Android key can be permanently lost without losing the smart account.

---

# 42. POC Milestone 4 — Launcher Shell

Build:

- Android HOME registration
- installed-app discovery
- app launching
- React Native home surface
- app drawer
- launcher settings

Success condition:

> The application is usable as the default Android launcher independently of wallet functionality.

---

# 43. MVP Integration Milestone

Combine wallet and launcher:

```text
Install app
      ↓
Set as launcher
      ↓
Create wallet
      ↓
Biometric
      ↓
See smart-account address
      ↓
Receive USDC
      ↓
Send USDC
      ↓
Biometric
      ↓
ZeroDev sponsored UserOperation
      ↓
Confirmed
```

with:

```text
No seed phrase
No private-key export
No wallet password
No Google-service dependency
No ETH required for sponsored send
```

---

# 44. Product Roadmap

## Phase 0 — Cryptographic spike

- Android Keystore P-256
- biometric signing
- P256VERIFY Base Sepolia

## Phase 1 — ZeroDev account abstraction

- Kernel
- raw P-256 root validator
- ZeroDev Bundler
- Base Sepolia UserOperation

## Phase 2 — Wallet transaction MVP

- ZeroDev Paymaster
- balances
- send
- receive
- USDC
- activity
- simulation

## Phase 3 — Recovery

- secondary signer
- add/remove signer
- migration
- lost-device recovery

## Phase 4 — Launcher MVP

- HOME activity
- installed apps
- app drawer
- search
- favorites
- settings

## Phase 5 — Web3 launcher integration

- wallet identity on home screen
- portfolio
- send / receive
- recent activity
- privacy controls

## Phase 6 — Ethereum

- Ethereum Sepolia
- EIP-7951 integration verification
- Ethereum mainnet

## Phase 7 — Advanced account features

- session keys
- permission policies
- dapp permissions
- spending limits
- recurring authorization
- cross-chain UX

---

# 45. Future Session-Key Model

ZeroDev Kernel's permission system is especially relevant to the long-term launcher concept.

Future example:

```text
Game permission

Signer:
Temporary session key

Allowed contracts:
game.example contracts

Allowed asset:
USDC

Maximum spend:
10 USDC / day

Expires:
24 hours
```

This could allow selected low-risk interactions without prompting for biometrics every time while preserving root-key security.

Session keys are NOT part of the MVP.

---

# 46. Future Web3 Search

Launcher search may eventually resolve:

- installed apps
- ENS names
- wallet addresses
- tokens
- transactions
- dapps
- contacts

Example:

```text
> alice.eth

alice.eth
0x1234...ABCD

[ Send ]
[ Copy Address ]
[ View Activity ]
```

This is a product differentiator but not required to prove the wallet architecture.

---

# 47. Future Web3 App Surface

The launcher may eventually merge installed apps and Web3 shortcuts:

```text
Finance

Coinbase     Aave
Uniswap      Morpho
Wallet       Banking App
```

The launcher should feel like an operating shell rather than a wallet dashboard attached to an app drawer.

---

# 48. Peanut Protocol as Reference Implementation

The Peanut UI codebase is a valuable implementation reference because it demonstrates a production-oriented application using:

- ZeroDev Kernel
- ZeroDev Bundler
- ZeroDev Paymaster
- Viem
- ZeroDev passkey/WebAuthn validation
- P-256 signature handling
- Android-native WebAuthn integration
- validator migrations

Repository:

https://github.com/peanutprotocol/peanut-ui

Particularly relevant files as of this specification:

```text
src/context/kernelClient.context.tsx
src/utils/native-webauthn.ts
src/constants/zerodev.consts.ts
```

Important distinction:

> Peanut's root path uses WebAuthn/passkey semantics. This project uses a raw Android Keystore P-256 root signer.

Therefore Peanut should be used as an architectural and operational reference, not copied blindly at the validator/signature boundary.

Useful patterns to borrow:

- explicit ZeroDev configuration validation
- validator/version pinning
- migration-aware wallet metadata
- P-256 DER parsing / signature normalization concepts
- explicit credential/signer binding
- Bundler and Paymaster error handling
- UserOperation lifecycle management

---

# 49. External Technical References

## ZeroDev

ZeroDev documentation:  
https://docs.zerodev.app/

Creating a smart account:  
https://docs.zerodev.app/onboarding/create-a-smart-account

Plugins / validators:  
https://docs.zerodev.app/smart-accounts/use-plugins/overview

Permissions / session keys:  
https://docs.zerodev.app/smart-accounts/permissions/intro

Kernel repository:  
https://github.com/zerodevapp/kernel

Kernel ERC-7579 plugins:  
https://github.com/zerodevapp/kernel-7579-plugins

---

## P-256 / Ethereum

EIP-7951 — P256VERIFY precompile:  
https://eips.ethereum.org/EIPS/eip-7951

RIP-7212 — original L2 P-256 precompile proposal:  
https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md

Daimo P256 verifier:  
https://github.com/daimo-eth/p256-verifier

---

## Android / GrapheneOS

Android Keystore:  
https://developer.android.com/privacy-and-security/keystore

Android biometric authentication:  
https://developer.android.com/identity/sign-in/biometric-auth

GrapheneOS attestation compatibility guide:  
https://grapheneos.org/articles/attestation-compatibility-guide

GrapheneOS usage guide:  
https://grapheneos.org/usage

---

## Google Play

Cryptocurrency exchanges and software-wallet policy:  
https://support.google.com/googleplay/android-developer/answer/16329703

Financial Features declaration:  
https://support.google.com/googleplay/android-developer/answer/13849271

Developer account type:  
https://support.google.com/googleplay/android-developer/answer/13634885

---

# 50. Open Questions

These decisions intentionally remain open until implementation spikes provide evidence.

## Q-001 — Which exact ZeroDev Kernel generation/version?

Select a single currently supported ZeroDev SDK + Kernel + EntryPoint combination during POC Milestone 1 and pin it.

Do not choose based solely on example-code recency.

---

## Q-002 — Does ZeroDev currently maintain a raw P-256 validator suitable for the chosen Kernel version?

If not, implement and audit/review a minimal custom validator.

This must be resolved before building recovery and production wallet features.

---

## Q-003 — What is the production biometric policy?

Options:

- strong biometric only
- strong biometric + device credential fallback
- policy based on transaction risk/value

---

## Q-004 — What happens on devices without hardware-backed Keystore?

Possible policies:

- block wallet creation
- allow with warning
- allow only low-value usage
- allow launcher but disable wallet

---

## Q-005 — What is the first recovery method?

Candidates:

- WebAuthn passkey
- second Android device
- hardware security key
- guardian-based recovery

A production wallet MUST not encourage large deposits until recovery is configured.

---

## Q-006 — How much gas should the project sponsor?

Determine:

- daily sponsorship limits
- supported operation types
- supported assets
- anti-abuse rules
- fallback when sponsorship is unavailable

---

# 51. Definition of Architectural Success

The foundational architecture is proven when this exact flow works on a real Android device, ideally GrapheneOS:

```text
GrapheneOS / Android device
        ↓
Create non-exportable P-256 Keystore key
        ↓
Create ZeroDev Kernel smart account
        ↓
Receive USDC on Base
        ↓
Construct ERC-4337 UserOperation
        ↓
Review transaction
        ↓
BiometricPrompt
        ↓
Keystore P-256 signature
        ↓
Raw P-256 Kernel validator
        ↓
ZeroDev Bundler + Paymaster
        ↓
Base
        ↓
USDC transfer confirmed
```

and then:

```text
Lose / remove original device signer
        ↓
Recover through secondary signer
        ↓
Authorize new Android device
        ↓
Same Kernel smart account
Same wallet address
Same assets
```

At that point the core proposition is validated:

> The smart account is the wallet. The Android device is a replaceable hardware-backed signer. Biometrics authorize signing. The user's wallet identity survives any individual phone.

---

# 52. ETHOnline 2026 Strong-Fit Integrations

The ETHOnline 2026 implementation SHOULD target sponsor integrations only when they reinforce the original product thesis. The launcher MUST remain a Web3-first Android launcher and seedless smart-account wallet rather than becoming a collection of unrelated bounty features.

The four strong-fit integrations are:

1. ENSv2 — `sodera.eth` identity namespace.
2. Arc — stablecoin payment network.
3. Uniswap — native wallet swap action.
4. The Graph — portfolio and on-chain activity data layer.

These integrations map directly to the core product:

```text
ENS          → identity
ZeroDev      → account ownership and execution
The Graph    → portfolio and activity
Base / Arc   → payments and settlement
Uniswap      → asset exchange
Launcher     → persistent operating surface
```

## 52.1 ENSv2 — `sodera.eth` Identity Namespace (Deferred)

> **Current hackathon scope:** The wallet displays the fixed fixture identity `anon.sodera.eth`. It does not deploy a child registry, provision per-account resolvers, claim user subnames, or present the fixture as an on-chain ownership or resolution result. The architecture below is retained for the next hackathon.

### Goal

ENS MUST be more than address decoration. It is the human-readable identity layer for the launcher and the user's ZeroDev Kernel smart account.

The product name is **Sodera** and the ENSv2 parent namespace is:

```text
sodera.eth
```

`sodera.eth` has been registered on the ENSv2 Sepolia beta deployment for the ETHOnline 2026 build. It is the canonical parent namespace for Sodera user identities. The parent `.eth` registration is already complete; the remaining ENSv2 work for the product is to attach/configure the child registry and issue user identities under `sodera.eth`.

Every user can receive a subname under that namespace:

```text
gerard.sodera.eth
alice.sodera.eth
bob.sodera.eth
```

This gives the product a native identity namespace without requiring every user to purchase a separate second-level `.eth` name.

### ETHOnline 2026 ENSv2 resources

The hackathon implementation MUST use the ENS-provided ETHOnline / ENSv2 beta tooling and deployment references below. These URLs are intentionally documented here because they are hackathon-specific and may differ from the eventual ENSv2 production interfaces:

- **Hackathon-specific ENS app / Deployment Manager:** https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/
- **Hackathon-specific ENS explorer / Deployment Portal:** https://hackathon-deployment-portal-app.ens-cf.workers.dev/
- **Hackathon ENSv2 deployment docs — Sepolia ENSv2 beta:** https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments/#sepolia-ensv2-beta

The application SHOULD pin the Sepolia contract addresses, ABIs, and interfaces actually used during the hackathon and record them in an implementation-specific deployment configuration or ADR. Do not infer production ENSv2 addresses from the hackathon deployment.

### ENSv2 architecture assumptions

ENSv2 is hierarchical rather than flat. A name can point to its own child registry, and resolution walks the registry hierarchy through Universal Resolver V2.

The `sodera.eth` namespace MUST therefore be modeled as an actual ENSv2 registry subtree rather than as a flat set of resolver records.

Conceptually:

```text
RootRegistry
    └── ETHRegistry
          └── sodera.eth
                └── Sodera UserRegistry
                      ├── gerard.sodera.eth
                      ├── alice.sodera.eth
                      └── bob.sodera.eth
```

`sodera.eth` SHOULD set its `subregistry` pointer to a Sodera-controlled `UserRegistry` / `PermissionedRegistry` deployed through the ENSv2 Verifiable Factory.

The Sodera registry manages allocation of first-level user labels such as `gerard`, `alice`, and `bob`.

The implementation SHOULD target the full ENS-compatible permissioned registry model rather than a resolution-only custom registry so the namespace remains compatible with standard ENS ownership, indexing, and permission semantics.

### Emancipated user-name ownership

Sodera SHOULD use an **emancipated registry configuration** for issued user names.

Sodera remains able to register new available labels and renew names, but MUST NOT retain root-level roles that allow it to interfere with already-issued identities.

The Sodera registry operator MAY retain the non-dangerous root roles required for operation:

```text
ROLE_REGISTRAR
ROLE_RENEW
```

The Sodera registry SHOULD NOT retain dangerous root roles such as:

```text
ROLE_SET_RESOLVER
ROLE_SET_SUBREGISTRY
ROLE_UNREGISTER
ROLE_SET_RESOLVER_ADMIN
ROLE_SET_SUBREGISTRY_ADMIN
ROLE_UNREGISTER_ADMIN
ROLE_CAN_TRANSFER_ADMIN
ROLE_UPGRADE
ROLE_UPGRADE_ADMIN
```

This produces the intended trust model:

```text
Sodera
   │
   │ ROLE_REGISTRAR
   ▼
Registers `gerard`
   │
   ▼
gerard.sodera.eth
   │
   ├── owner: Gerard's ZeroDev Kernel account
   ├── can control resolver
   ├── can control child registry
   └── can transfer the name

Sodera cannot:
   ✗ replace Gerard's resolver
   ✗ replace Gerard's subregistry
   ✗ unregister Gerard's identity
   ✗ seize transfer rights
```

The user's registration role bitmap SHOULD include the appropriate name-scoped roles, including at minimum:

```text
ROLE_SET_RESOLVER
ROLE_SET_SUBREGISTRY
ROLE_CAN_TRANSFER_ADMIN
```

The exact role bitmap MUST be pinned and documented as part of the `sodera.eth` namespace deployment configuration.

This is preferred over a centrally managed Sodera namespace because the Sodera identity should remain non-custodial in the same spirit as the wallet itself.

### Ownership and token model

Each issued ENSv2 user name is represented by an `ERC1155Singleton` token in the Sodera registry.

The owner SHOULD be the user's ZeroDev Kernel smart-account address:

```text
owner(
  gerard.sodera.eth
) = 0xKernelSmartAccount
```

The implementation MUST NOT persist ENSv2 token IDs as stable name identifiers because ENSv2 token IDs can change when permissions change or when a name is re-registered.

Application caches and backend records SHOULD key namespace identities using stable values such as:

```text
full ENS name
label / labelhash
registry address + labelhash
```

and MUST NOT treat a previously observed ERC1155 token ID as a permanent identifier.

### Per-account Permissioned Resolver

ENSv2 uses per-account Permissioned Resolver instances rather than one shared public resolver.

The user's ZeroDev Kernel account SHOULD use its own Permissioned Resolver proxy, deployed through the ENSv2 Verifiable Factory.

Conceptually:

```text
Gerard's Kernel account
        │
        ├── owns gerard.sodera.eth
        │
        └── Gerard PermissionedResolver
                │
                ├── address records
                ├── avatar
                ├── text records
                └── payment preferences
```

Multiple ENS names owned by the same Kernel account MAY share that account's Permissioned Resolver.

For write flows, the app MUST look up the name's current resolver immediately before constructing the write transaction. It MUST NOT permanently hard-code or cache a resolver address as the authoritative write target because a name's resolver pointer can change.

### Resolver permissions

Permissioned Resolver uses Enhanced Access Control with fine-grained roles. The MVP SHOULD make the user's Kernel account the primary authority for its identity records.

Future features MAY delegate narrowly-scoped record permissions to other signers or services rather than granting broad resolver control.

Examples:

```text
Kernel root signer
    → may update all user-owned identity records

Profile session key
    → may update avatar + selected profile text records only

Payment automation
    → may update payment.chain / payment.token only
```

Any such delegation MUST use record-scoped ENSv2 permissions and MUST NOT grant a backend global authority over the user's resolver.

### Namespace hierarchy

The intended Sodera identity hierarchy is:

```text
sodera.eth
    │
    ├── gerard.sodera.eth
    │      │
    │      ├── pay.gerard.sodera.eth
    │      └── device.gerard.sodera.eth      # optional / future
    │
    ├── alice.sodera.eth
    └── bob.sodera.eth
```

For the hackathon MVP, the only REQUIRED issued identity is:

```text
<username>.sodera.eth
```

Because the user receives `ROLE_SET_SUBREGISTRY`, the architecture leaves room for that user to deploy or select their own child registry later and create deeper names without the launcher acting as custodian of the subtree.

Nested names such as `pay.*` and `device.*` are optional demonstrations and MUST NOT delay the core wallet implementation.

### Name registration flow

A new Sodera identity SHOULD be created approximately as follows:

```text
1. User creates ZeroDev Kernel smart account.

2. User chooses Sodera username.

3. Launcher checks the label status in Sodera UserRegistry.

4. Sodera registrar registers the label:

   label      = "gerard"
   owner      = user's Kernel account
   subregistry = optional / initially zero
   resolver   = user's Permissioned Resolver
   roleBitmap = emancipated owner roles
   expiry     = configured namespace expiry

5. gerard.sodera.eth becomes owned by the Kernel account.

6. Initial records are written to the user's Permissioned Resolver.

7. Launcher resolves the full name through Universal Resolver V2 and verifies
   that the configured address resolves back to the expected Kernel account.
```

Subname registration does not need to duplicate the `.eth` commit-reveal registrar flow because the launcher controls allocation inside its own registry.

### Name lifecycle

The Sodera namespace MUST explicitly define its expiry and renewal policy.

ENSv2 registry names can be `AVAILABLE`, `RESERVED`, or `REGISTERED`, and `register()` receives an absolute expiry timestamp.

For MVP, the launcher SHOULD either:

1. issue long-lived user names and automatically sponsor renewals; or
2. use a documented renewable membership period while guaranteeing that the launcher cannot arbitrarily unregister an active emancipated name.

Automatic renewal through the launcher's retained `ROLE_RENEW` is preferred for an identity product because users should not unexpectedly lose their Sodera identity through an invisible protocol expiry.

### Records

Initial useful records SHOULD include standard ENS records where possible:

```text
address / coin address → Kernel smart-account address
avatar                 → user avatar
url                    → optional profile URL
```

Sodera MAY also use documented application-specific text records such as:

```text
payment.chain  → preferred payment chain
payment.token  → preferred payment token, e.g. USDC
```

Custom record keys MUST be documented and kept minimal for MVP.

### Primary name and reverse resolution

Where supported by the ENSv2 Sepolia deployment and libraries used for the hackathon, the launcher SHOULD configure the Sodera-issued name as the smart account's primary name / reverse identity.

This allows the product to display:

```text
gerard.sodera.eth
```

when starting only from the Kernel smart-account address.

Reverse resolution SHOULD be treated as part of identity presentation rather than as wallet authorization.

### Universal Resolver V2

All read paths SHOULD resolve through an ENSv2-ready library / Universal Resolver V2 rather than manually traversing registries.

The wallet MUST support both:

```text
alice.eth
alice.sodera.eth
```

without application-level assumptions about which registry contract contains the name.

Read-only ENS integration SHOULD remain isolated behind an `EnsIdentityService` abstraction so the app can adopt final ENSv2 library APIs as they stabilize.

Example conceptual interface:

```ts
interface EnsIdentityService {
  resolveAddress(name: string, coinType?: bigint): Promise<Address | null>;
  getPrimaryName(address: Address): Promise<string | null>;
  getProfile(name: string): Promise<EnsProfile>;
  getResolver(name: string): Promise<Address>;
  isLauncherNameAvailable(label: string): Promise<boolean>;
  registerLauncherName(label: string, owner: Address): Promise<Hash>;
}
```

### Launcher UX

The home screen should display the ENS identity as the user's primary human-readable wallet identity:

```text
┌──────────────────────────────┐
│ gm, Gerard                   │
│ gerard.sodera.eth        │
│                              │
│ Portfolio                    │
│ $18,420.52                   │
│                              │
│ [ Send ] [ Receive ] [ Swap ]│
└──────────────────────────────┘
```

The raw address remains available but secondary.

The settings UI SHOULD expose namespace ownership in a way that makes the non-custodial model visible:

```text
ENS Identity

gerard.sodera.eth

Owner
0xKernel...

Namespace control
✓ Resolver controlled by your smart account
✓ Subnames controlled by your smart account
✓ Transfer rights controlled by your smart account
```

### Sending to ENS names

The send flow MUST accept ENS names:

```text
Send USDC
    ↓
alice.eth
or
alice.sodera.eth
    ↓
Universal Resolver V2
    ↓
resolved address
    ↓
transaction simulation
    ↓
biometric confirmation
```

Resolution MUST happen before transaction authorization.

The transaction review screen MUST show both:

```text
alice.sodera.eth
0x1234...abcd
```

to reduce address-substitution risk.

The resolved address MUST be included in the transaction simulation and MUST NOT be silently re-resolved to a different address after the user approves the review screen.

### ENSv2 indexing considerations

ENSv2 has no single flat registry to enumerate. If the launcher later needs directory/search functionality for all issued launcher identities, that MUST be treated as an indexing problem.

The indexer SHOULD follow Sodera-registry lifecycle events such as registration, renewal, resolver changes, role changes, transfers, and subregistry changes.

Because token IDs are mutable, indexed identity records MUST be keyed by registry + labelhash / canonical name rather than token ID.

This indexing may later be implemented using The Graph, which would create an additional natural intersection between the ENSv2 and The Graph integrations.

### ENSv2 hackathon implementation

ENSv2 contracts and interfaces are currently in public-beta / pre-mainnet form and may change before final mainnet deployment. The ETHOnline build SHOULD therefore use the canonical ENSv2 Sepolia deployment and pin the exact contract interfaces / SDK versions used during the hackathon.

The hackathon demo SHOULD prove all of the following:

1. Sodera controls the registered `sodera.eth` parent name on ENSv2 Sepolia and points it to a real ENSv2 child registry for user-name issuance.
2. The Sodera registry is a Permissioned Registry / UserRegistry in the ENSv2 hierarchy.
3. A new Kernel smart account receives `<username>.sodera.eth` as an ERC1155Singleton-owned name.
4. The user name is registered with an emancipated role configuration.
5. The Sodera namespace operator retains registration/renewal ability but cannot replace the user's resolver, replace the user's child registry, unregister the active identity, or seize transfer authority.
6. The user has a per-account Permissioned Resolver.
7. The Kernel account controls its own resolver records.
8. The launcher resolves the name through Universal Resolver V2 in a real send or identity flow.
9. The application demonstrates at least one meaningful Enhanced Access Control operation or verifies the emancipated role state on-chain.
10. The home screen displays the ENS identity as a first-class wallet identity.

### ENSv2 implementation invariants

**ENS-001** — Sodera-issued identities MUST be owned by the user's smart account, not by the Sodera backend.

**ENS-002** — Sodera SHOULD use an emancipated registry configuration for issued user names.

**ENS-003** — The Sodera backend MUST NOT retain a root permission capable of replacing user resolvers or deleting active user identities after emancipation.

**ENS-004** — Resolver addresses MUST be looked up before write operations rather than permanently hard-coded.

**ENS-005** — ENSv2 token IDs MUST NOT be treated as stable identity keys.

**ENS-006** — Resolution MUST use Universal Resolver V2 / an ENSv2-ready library.

**ENS-007** — The namespace's renewal policy MUST be explicit and user identities MUST NOT silently expire without visible handling.

**ENS-008** — ENS records are identity metadata; ownership of the ZeroDev smart account remains governed by Kernel validators and MUST NOT depend on ENS resolution.

ENS identity is a permanent product feature, not a disposable bounty integration.

---

## 52.2 Arc — Stablecoin-Native Payments

### Goal

Arc extends the launcher from a Base-first wallet into a multi-network stablecoin wallet without changing its account or signing architecture.

The primary Arc use case is:

> Send and receive USDC from the launcher using the same ZeroDev Kernel account experience and biometric device signer.

### User flow

```text
Home
  ↓
USDC
  ↓
Send
  ↓
Network: Arc
  ↓
Recipient: alice.sodera.eth
  ↓
Review
  ↓
BiometricPrompt
  ↓
P-256 signature
  ↓
Kernel UserOperation
  ↓
ERC-4337 Bundler / Paymaster
  ↓
Arc
  ↓
USDC transfer confirmed
```

### Integration requirements

The Arc integration SHOULD support:

- Arc network configuration
- USDC balance
- USDC receive flow
- USDC send flow
- UserOperation simulation
- biometric signing
- transaction activity
- sponsored transactions when compatible infrastructure is available

Arc MUST use the same `WalletEngine`, `DeviceSigner`, and Kernel abstractions as Base.

Feature code MUST NOT contain Arc-specific signing logic.

### ZeroDev compatibility strategy

ZeroDev Kernel remains the account implementation.

Because Arc is not currently listed in ZeroDev's public supported-network list, infrastructure selection MUST remain replaceable:

```ts
interface AccountAbstractionInfrastructure {
  getBundlerTransport(chainId: number): Transport;
  getPaymaster(chainId: number): Paymaster | undefined;
}
```

For Base:

```text
ZeroDev Kernel
+ ZeroDev Bundler
+ ZeroDev Paymaster
```

For Arc:

```text
ZeroDev Kernel
+ ZeroDev SDK
+ ZeroDev hosted infra if available
             OR
+ compatible ERC-4337 Bundler / Paymaster
```

This is infrastructure portability, not an account-architecture change.

### Hackathon demonstration

The Arc bounty demo SHOULD show a real USDC payment rather than only displaying balances.

Minimum demo:

```text
Receive USDC on Arc
        ↓
Send USDC on Arc
        ↓
Biometric approval
        ↓
confirmed transaction
```

The project SHOULD include an architecture diagram showing where Arc sits relative to ZeroDev Kernel, the device signer, Bundler, and Paymaster.

---

## 52.3 Uniswap — Native Swap Action

### Goal

Uniswap becomes the wallet's exchange layer.

The launcher home screen expands from:

```text
[ Send ] [ Receive ]
```

to:

```text
[ Send ] [ Receive ] [ Swap ]
```

Swap is a natural wallet capability and does not change the launcher thesis.

### Initial UX

```text
Swap

You pay
100 USDC

You receive
ETH

Network
Base

Rate
1 ETH = ... USDC

Price impact
...

[ Review Swap ]
```

Then:

```text
Review
   ↓
Simulation
   ↓
BiometricPrompt
   ↓
Kernel UserOperation
   ↓
Uniswap
   ↓
Swap confirmed
```

### Integration approach

For the hackathon MVP, prefer the simplest maintained Uniswap integration that produces a real executable swap and can be called from the ZeroDev smart account.

Preferred order:

1. Uniswap API / developer platform for quote and transaction construction when it supports the required smart-account flow.
2. Direct supported Uniswap protocol interaction when needed.

Do not build a custom router or v4 hook merely for the bounty.

### Smart-account execution

The swap transaction is executed by the Kernel account:

```text
React Native Swap UI
        ↓
Uniswap quote
        ↓
transaction calldata
        ↓
WalletEngine.prepareTransaction()
        ↓
ZeroDev Kernel UserOperation
        ↓
Biometric signature
        ↓
Bundler
        ↓
Kernel executes Uniswap call
```

Token approval SHOULD use the safest simple path available for the MVP. Where practical, Kernel batching MAY combine approval and swap into one user-facing operation.

### Safety requirements

Before biometric authorization the application MUST show:

- input asset and amount
- expected output asset and amount
- minimum received / slippage
- network
- price impact when available
- approvals being granted
- smart-account calls that will execute

The UserOperation MUST be simulated before signing.

### Hackathon submission requirements

The repository MUST include the Uniswap-specific submission artifacts required by the bounty, including:

- public source code
- `FEEDBACK.md`
- completed Uniswap developer feedback submission
- README section pointing judges to the exact Uniswap integration files / contracts

These are release checklist items and SHOULD be tracked before submission day.

---

## 52.4 The Graph — Portfolio and Activity Data Layer

### Goal

The Graph becomes a load-bearing data source for the wallet's portfolio and on-chain activity surfaces.

The launcher needs to answer:

```text
What do I own?
What happened to my wallet?
Where are my assets deployed?
```

The Graph SHOULD provide the structured on-chain data used to answer these questions.

### Product surfaces

The Graph data powers:

```text
Home portfolio summary
        │
        ├── token / protocol value
        ├── recent activity
        └── DeFi positions where supported

Wallet
        │
        ├── balances
        ├── activity
        └── protocol positions
```

### Hackathon implementation strategy

Simply querying one arbitrary Subgraph is insufficient for the targeted composable / standardized track. The implementation SHOULD therefore deliberately use The Graph's composable or standardized products.

Preferred architecture:

```text
The Graph
   │
   ├── Standardized Subgraphs
   │       ↓
   │   protocol / DeFi position data
   │
   └── Substreams
           ↓
       address-centric transfer / activity pipeline
           │
           └──────────────┐
                          ↓
                  PortfolioDataProvider
                          ↓
                     React Native
                          ↓
                       Launcher
```

This approach uses two Graph capabilities and maps them to real wallet requirements.

### Standardized Subgraphs

Use a standardized schema where applicable so the portfolio engine can query protocol data through a consistent model rather than embedding protocol-specific GraphQL throughout the UI.

Example abstraction:

```ts
interface ProtocolPosition {
  protocol: string;
  type: string;
  assets: AssetAmount[];
  valueUsd?: number;
  chainId: number;
}
```

The React Native application MUST consume normalized application models rather than protocol-specific query responses.

### Substreams activity pipeline

A Substreams pipeline MAY be used to derive wallet-centric activity such as:

- ERC-20 transfers involving the Kernel account
- native asset transfers
- smart-account execution events
- UserOperation-related activity

The resulting application model should be simple:

```ts
type WalletActivity = {
  id: string;
  chainId: number;
  timestamp: number;
  type: "send" | "receive" | "swap" | "contract-call";
  txHash: Hex;
  asset?: Asset;
  amount?: bigint;
  counterparty?: Address;
};
```

### Data-provider boundary

The rest of the application MUST access Graph data through an interface:

```ts
interface PortfolioDataProvider {
  getPortfolio(address: Address): Promise<Portfolio>;
  getActivity(address: Address): Promise<WalletActivity[]>;
  getProtocolPositions(address: Address): Promise<ProtocolPosition[]>;
}
```

This keeps GraphQL / Substreams-specific code out of UI components while making The Graph a load-bearing implementation of the wallet data layer.

### Live data requirement

Hackathon builds MUST consume live data from a Graph provider. Mocked portfolio data may be used for isolated UI development but MUST NOT be used in the judged end-to-end demo.

---

## 52.5 Combined Hackathon MVP

The ETHOnline build SHOULD demonstrate one cohesive product:

```text
                    WEB3 LAUNCHER
                         │
              anon.sodera.eth
               static fixture
                         │
             ┌───────────┴───────────┐
             │                       │
         ZeroDev Kernel          The Graph
             │                  portfolio/activity
             │                       │
             └───────────┬───────────┘
                         │
                    Wallet UI
                         │
          ┌──────────────┼──────────────┐
          │              │              │
        Send          Receive          Swap
          │              │              │
       Base/Arc       Base/Arc       Uniswap
```

Minimum integrated demonstration:

1. User sets the app as the Android launcher.
2. User creates a seedless ZeroDev Kernel smart account.
3. Android generates a non-exportable P-256 device signer.
4. The home screen displays the fixed `anon.sodera.eth` fixture identity without claiming on-chain ownership or resolution.
5. The home screen displays portfolio information sourced through The Graph.
6. User receives USDC.
7. User sends USDC on Base or Arc to an ENS name.
8. User authorizes the transaction with biometrics.
9. User performs a USDC ↔ ETH swap through Uniswap.
10. The resulting activity appears in the launcher activity feed through The Graph data layer.

The prize integrations MUST NOT introduce a second custody system, second embedded wallet, or alternative root signer.

ZeroDev Kernel + device-bound P-256 remains the account and security foundation for every flow.

---

## 52.6 Hackathon Priority Order

If implementation time becomes constrained, prioritize in this order:

```text
P0  ZeroDev + Android P-256 + Base transaction
P1  Launcher shell
P2  ENSv2 Sodera namespace
P3  The Graph portfolio / activity
P4  Arc USDC payment
P5  Uniswap swap
```

The product MUST remain functional even if the lowest-priority prize integration is incomplete.

The hackathon should optimize for a coherent working wallet and launcher rather than maximum bounty count.
