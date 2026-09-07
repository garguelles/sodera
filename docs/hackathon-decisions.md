# Hackathon Scope and Rules

Status: decisions agreed during spec review; [all ten epic specs and their approved ticket breakdowns are published](hackathon-specs.md). No implementation is claimed.

This record captures clarifications to `sodera.md`. Epic specifications and implementation tickets belong in Linear. Unresolved choices below must not be treated as accepted defaults.

## Delivery Scope

- Build window: 10 days.
- Release boundary: testnet-only hackathon build, not a production-ready wallet.
- Required: Android launcher, device-bound P-256 Kernel wallet, Ethereum Sepolia payments, ENSv2 identity, The Graph portfolio/activity and Morpho vault data, Uniswap swaps, Morpho USDC vault integration, fiat valuation, and passkey recovery.
- Ethereum Sepolia is the single required network for all hackathon flows, subject to early feasibility verification. Base is deferred; Arc remains stretch. Do not silently switch networks if a required integration fails verification.
- Stretch: Arc payments and recovery using a second Android device.
- Extract the eight architecture decisions embedded in `sodera.md` into standalone ADRs during documentation restructuring. Preserve their history, but record the subsequently agreed Ethereum-Sepolia-only hackathon scope as a revision to the Base-first decision, not as an unchanged accepted decision.
- ZeroDev-hosted infrastructure is the required target for Ethereum Sepolia, pending verification. Arc may use compatible alternative infrastructure while retaining Kernel and the device signer.
- Verify Ethereum Sepolia's raw P-256/Kernel execution path, ZeroDev sponsorship, executable Uniswap testnet swaps and liquidity, and live Graph data availability before treating dependent implementation specs as ready.
- Exact versions and validator selection remain subject to technical feasibility checks.
- Agree on and publish specs first, then run `to-tickets` separately for each spec, preserving cross-spec dependencies.

## Launcher

- Include default Home registration, an installed-app drawer, app search, pinned favorites, basic settings, and the wallet home surface.
- Use a basic plain background. Wallpaper support is out of scope for the hackathon.
- Show balances and the portfolio total on the home screen by default, with an icon to toggle their visibility.
- Defer folders, widgets, icon packs, notification dots, and custom gestures.

## ENS Identity

- Require username claim, user-controlled name ownership and resolver, payment-address resolution, and home-screen identity display.
- Hackathon product model: one phone -> one Sodera installation -> one wallet user -> one smart-account address. That wallet has one Sodera username.
- "User" means the wallet user associated with the installation, not a separately verified human identity. Do not offer account switching, multiple wallets per installation, multiple usernames per wallet, or username changes.
- This installation-scoped product constraint does not remove on-chain ENS ownership and transfer rights. Externally transferred-name handling remains to be resolved.
- Let users select an avatar image from their phone, upload it to hosted storage, and save its URL in their ENS avatar record through a wallet-authorized update.
- Show initials until an avatar is set. Defer NFT avatars and image editing beyond basic cropping. The storage provider remains to be selected.
- Verify emancipated name permissions on-chain as part of the demo.
- Defer profile URLs, custom text records, and nested subnames.

## Payments

- Support sending and receiving ETH and one pinned USDC test token on Ethereum Sepolia.
- Accept recipient addresses and ENS names. Provide address copy and a receive QR code.
- Defer arbitrary ERC-20 discovery and token imports.

## Swaps

- Require USDC-to-ETH and ETH-to-USDC swaps on Ethereum Sepolia.
- Include quotes, slippage protection, approval review, biometric authorization, and confirmation.
- Defer arbitrary token selection and additional pairs.
- Verify and pin the exact test token and an executable Uniswap route with testnet liquidity. Mock swaps do not satisfy the required demonstration.

## Morpho and Portfolio Data

- Include Morpho USDC vaults as a required integration, with The Graph providing vault-related data.
- Support one curated USDC vault with deposit, position display, and withdrawal through the Kernel account.
- Use The Graph for vault and position data. Deposits and withdrawals require transaction review, simulation, and biometric authorization.
- Defer vault discovery, comparisons, and automated strategies.
- Display fiat value; the earlier proposal to defer fiat valuation and all DeFi positions was not accepted.
- Display USD values without an "illustrative" label. Value USDC at a fixed USD 1 per token.
- Obtain ETH/USD pricing from an external source, such as Chainlink; the exact source remains to be selected and verified.
- For the hackathon, assume pricing normally succeeds and use USD 0 for ETH valuation when no price is available. Do not add last-known-price or stale-price UI for this scope. This fallback can understate the displayed portfolio total; it does not change the token balance.
- The fixed USDC valuation and ETH price conversion are display conventions, not claims that testnet assets are redeemable for dollars.
- Verify Morpho deployment, compatible USDC vault availability, and Graph indexing coverage on Ethereum Sepolia. Required testnet-only scope remains unchanged; mainnet is not an implicit fallback.
- Exact Graph-backed fields and the ETH/USD source remain unresolved.

## Onboarding and Recovery

- Onboarding is open to everyone; no invitation is required.
- Wallet creation is mandatory.
- Claiming `<username>.sodera.eth` is mandatory for hackathon onboarding.
- Passkey recovery is a required implemented feature, but users may skip recovery enrollment.
- Warn users that losing the device before configuring recovery can permanently lose wallet access. Keep recovery enrollment available afterward.
- Proton Pass is the required recovery-provider target, with similar third-party providers supported where verified compatible.
- Recovery must work without Google services and after loss of the original phone. A credential accessible only on that phone is insufficient.
- Verify provider behavior on Android/GrapheneOS and compatibility with the selected Kernel recovery mechanism; compatibility is not yet established.
- The recovery demonstration must replace the original device signer and revoke its authority while retaining the same smart account.
- Fresh onboarding, including after reinstalling or moving to a new phone, offers Create Wallet or Recover Wallet.
- Recover Wallet uses the previously enrolled passkey to restore control of the existing smart account and username, replacing the lost device signer instead of creating another account. The installation then holds only the recovered wallet.

## Signing Authorization

- Prefer strong biometrics for device-key signing, with device PIN, pattern, or password allowed as a fallback for the testnet hackathon.
- Require explicit transaction review and confirmation before authentication. Do not permit silent background signing.
- Authentication must authorize use of the Keystore-held key; device credential fallback must not bypass key-use authorization or export key material.
- Verify the supported Android API/device configuration for biometric and device credential authorization. Production policy remains a separate decision.
- Require hardware-backed Keystore for the device signer: prefer StrongBox, with hardware-backed TEE as the fallback.
- Devices with only software-backed Keystore are incompatible with the hackathon wallet. Show an incompatibility message noting that support may be added in the future; do not create a software-backed signer.

## Gas Sponsorship Rules

The agreed policy is bounded sponsorship, not unlimited free transactions.

- Configure and enforce sponsorship quotas, reset rules, and budgets in the sponsorship service, not in application code. Do not build a separate application-side quota ledger.
- Failure, retry, and operation-counting semantics follow the selected sponsorship service. Document its effective behavior after configuration rather than inventing application-specific rules.
- Use one shared allowance of 10 sponsored operations per wallet per day, covering onboarding, ENS registration, recovery enrollment, signer replacement, sends, and swaps.
- Setup and recovery do not receive separate sponsorship allowances. Keep the shared allowance configurable and document any changes to the effective limit.
- Reset the per-wallet allowance at 00:00 UTC each day, not on a rolling 24-hour window. Show the remaining allowance and next reset time in the wallet.
- Verify that the service supports the agreed allowance and reset policy. Remaining-allowance UI must use authoritative service data; if unavailable, revisit that UI requirement rather than maintain a local estimate as authoritative.
- Exhausting the shared allowance can prevent a sponsored setup or recovery operation until the allowance resets; it must not revoke wallet access or authority. Self-funded execution remains the fallback where supported.
- Enforce service-wide sponsorship budget limits as well as per-wallet limits.
- Public onboarding requires bounded registration and sponsorship; per-wallet limits alone do not prevent abuse through creation of many wallets.
- Sponsorship eligibility must not control ownership of or access to an existing wallet.
- When sponsorship is unavailable, preserve wallet access and offer self-funded gas payment where supported.
- Do not silently submit a self-funded operation under a review that promised sponsored fees; changed fees require an updated review and confirmation.

The fee-review rule follows the source spec's explicit transaction-authorization requirement; its detailed UX remains to be specified.

### Unresolved Policy Parameters

- Verify and document service-defined operation-counting semantics (including failures and retries), policy configuration capabilities, and quota visibility.
- Whether to add a per-wallet gas-cost ceiling alongside the agreed 10-operation allowance.
- Service-wide budget amount and reset period.
- Registration limits and anti-abuse enforcement for open onboarding.
- Detailed sponsorship eligibility for lost-device recovery and signer replacement; these consume the shared allowance, with no separate reserved budget.
- Supported operation/asset allowlists and behavior when mandatory onboarding sponsorship is unavailable.

The 10-operation daily allowance is an agreed requirement, not a claim of deployed enforcement. The implementation must document the effective configured limits and keep that documentation current when policy changes.
