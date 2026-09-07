# Hackathon Specs

The approved build has eight required specs and two stretch specs. The delivery window is 10 days and the required network is Ethereum Sepolia only. Implementation has not started; external capabilities remain subject to each spec's verification gates.

## Required

| Spec | Linear | Outcome |
| --- | --- | --- |
| Device signer and smart account | [PRA-175](https://linear.app/pragmacollective/issue/PRA-175/spec-device-signer-and-smart-account) | Hardware-backed Android key authorizes a real Kernel operation |
| Launcher and onboarding | [PRA-176](https://linear.app/pragmacollective/issue/PRA-176/spec-launcher-and-onboarding) | Default Home, installed apps, and mandatory wallet/username onboarding |
| Payments and sponsorship | [PRA-177](https://linear.app/pragmacollective/issue/PRA-177/spec-payments-and-sponsorship) | ETH/USDC payments and shared, service-enforced sponsorship |
| Passkey recovery | [PRA-180](https://linear.app/pragmacollective/issue/PRA-180/spec-passkey-recovery) | Proton Pass restores the same account and revokes the lost signer |
| ENS identity and avatars | [PRA-179](https://linear.app/pragmacollective/issue/PRA-179/spec-ens-identity-and-avatars) | User-controlled username, resolution, and avatar updates |
| Uniswap swaps | [PRA-174](https://linear.app/pragmacollective/issue/PRA-174/spec-uniswap-swaps) | USDC/ETH swaps in both directions |
| Morpho USDC vault | [PRA-178](https://linear.app/pragmacollective/issue/PRA-178/spec-morpho-usdc-vault) | Deposit, display a position, and withdraw from one curated vault |
| Portfolio and activity | [PRA-182](https://linear.app/pragmacollective/issue/PRA-182/spec-portfolio-and-activity) | Live Graph data and USD valuation, including the vault position |

## Stretch

| Spec | Linear | Outcome |
| --- | --- | --- |
| Arc payments | [PRA-181](https://linear.app/pragmacollective/issue/PRA-181/stretch-spec-arc-payments) | Real Arc testnet USDC payment without replacing the root architecture |
| Second Android device recovery | [PRA-183](https://linear.app/pragmacollective/issue/PRA-183/stretch-spec-second-android-device-recovery) | An independently enrolled phone restores account control |

## Published Implementation Tickets

All ten specs were individually decomposed with `to-tickets`, reviewed, and approved. Linear contains 40 required implementation tickets, seven stretch implementation tickets, and one separate human setup checklist. All remain in Backlog at completion of this planning session; approval does not mean implementation or external feasibility has been verified.

| Ticket | Outcome | Native Blockers |
| --- | --- | --- |
| [PRA-185](https://linear.app/pragmacollective/issue/PRA-185) | Hardware-authorized Android P-256 proof | None |
| [PRA-184](https://linear.app/pragmacollective/issue/PRA-184) | Pinned Kernel raw-P256 validator proof | None |
| [PRA-187](https://linear.app/pragmacollective/issue/PRA-187) | Real device-signed Kernel execution | PRA-185, PRA-184 |
| [PRA-188](https://linear.app/pragmacollective/issue/PRA-188) | Restart-safe identity and key-failure handling | PRA-187 |
| [PRA-189](https://linear.app/pragmacollective/issue/PRA-189) | Integrated account, payment, identity, and recovery evidence | PRA-188, PRA-192, PRA-194, PRA-198, PRA-205, PRA-208 |
| [PRA-190](https://linear.app/pragmacollective/issue/PRA-190) | Android Home and installed-app launching | None |
| [PRA-191](https://linear.app/pragmacollective/issue/PRA-191) | Search, favorites, and basic preferences | PRA-190 |
| [PRA-192](https://linear.app/pragmacollective/issue/PRA-192) | Retry-safe mandatory wallet/username onboarding | PRA-190, PRA-188, PRA-199, PRA-208 |
| [PRA-194](https://linear.app/pragmacollective/issue/PRA-194) | Recover Wallet and later recovery enrollment | PRA-190, PRA-188, PRA-205 |
| [PRA-193](https://linear.app/pragmacollective/issue/PRA-193) | Live identity and financial Home surface | PRA-190, PRA-209, PRA-210, PRA-224 |
| [PRA-196](https://linear.app/pragmacollective/issue/PRA-196) | Shared Sepolia USDC compatibility gate | None |
| [PRA-195](https://linear.app/pragmacollective/issue/PRA-195) | ZeroDev sponsorship policy/access evidence | None; relevant human setup needed for live probes |
| [PRA-197](https://linear.app/pragmacollective/issue/PRA-197) | ETH/USDC receive and address QR/copy | PRA-196, PRA-188 |
| [PRA-198](https://linear.app/pragmacollective/issue/PRA-198) | Review-bound sends and shared operation lifecycle | PRA-196, PRA-188 |
| [PRA-199](https://linear.app/pragmacollective/issue/PRA-199) | Sponsored sends and explicit refusal/self-pay handling | PRA-195, PRA-198 |
| [PRA-200](https://linear.app/pragmacollective/issue/PRA-200) | ENS-recipient sends bound to the approved address | PRA-198, PRA-209 |
| [PRA-201](https://linear.app/pragmacollective/issue/PRA-201) | Independent Proton Pass and account discovery proof | None; relevant human setup needed for live probes |
| [PRA-202](https://linear.app/pragmacollective/issue/PRA-202) | Pinned Kernel recovery mechanism | PRA-201, PRA-187 |
| [PRA-203](https://linear.app/pragmacollective/issue/PRA-203) | Confirmed passkey recovery enrollment | PRA-202, PRA-198 |
| [PRA-204](https://linear.app/pragmacollective/issue/PRA-204) | Clean-install account recovery and old-signer revocation | PRA-203, PRA-188 |
| [PRA-205](https://linear.app/pragmacollective/issue/PRA-205) | Interrupted recovery, sponsorship, and identity retention | PRA-204, PRA-199, PRA-208, PRA-209, PRA-211 |
| [PRA-206](https://linear.app/pragmacollective/issue/PRA-206) | Namespace authority and lifecycle decisions | None; relevant owner setup needed for private actions |
| [PRA-207](https://linear.app/pragmacollective/issue/PRA-207) | Emancipated Sodera registry configuration | PRA-206 |
| [PRA-208](https://linear.app/pragmacollective/issue/PRA-208) | Confirmed one-name claim and per-account resolver | PRA-207, PRA-188, PRA-199 |
| [PRA-209](https://linear.app/pragmacollective/issue/PRA-209) | ENS resolution and verified identity profiles | PRA-206, PRA-208 |
| [PRA-210](https://linear.app/pragmacollective/issue/PRA-210) | Uploaded and confirmed ENS avatar | PRA-208, PRA-209 |
| [PRA-211](https://linear.app/pragmacollective/issue/PRA-211) | Transfer, expiry, and signer-change identity behavior | PRA-208, PRA-209 |
| [PRA-212](https://linear.app/pragmacollective/issue/PRA-212) | Verified bidirectional Uniswap quote flow | PRA-196, PRA-187 |
| [PRA-213](https://linear.app/pragmacollective/issue/PRA-213) | Kernel swaps returning the intended native/token assets | PRA-212, PRA-198 |
| [PRA-214](https://linear.app/pragmacollective/issue/PRA-214) | Swap sponsorship, expiry, and interruption handling | PRA-213, PRA-199 |
| [PRA-215](https://linear.app/pragmacollective/issue/PRA-215) | Live swap activity and submission evidence | PRA-214, PRA-224 |
| [PRA-216](https://linear.app/pragmacollective/issue/PRA-216) | Curated vault execution and live data requirements | PRA-196 |
| [PRA-217](https://linear.app/pragmacollective/issue/PRA-217) | Deposit USDC and display indexed vault position | PRA-216, PRA-198, PRA-222 |
| [PRA-218](https://linear.app/pragmacollective/issue/PRA-218) | Withdraw USDC to the same smart account | PRA-217 |
| [PRA-219](https://linear.app/pragmacollective/issue/PRA-219) | Vault sponsorship, interruptions, and reconciliation | PRA-218, PRA-199, PRA-224 |
| [PRA-220](https://linear.app/pragmacollective/issue/PRA-220) | Graph product and Sepolia coverage verification | PRA-196 |
| [PRA-221](https://linear.app/pragmacollective/issue/PRA-221) | Live holdings and USD valuation | PRA-220, PRA-188 |
| [PRA-222](https://linear.app/pragmacollective/issue/PRA-222) | Independent live Morpho position reads | PRA-220, PRA-216, PRA-188 |
| [PRA-223](https://linear.app/pragmacollective/issue/PRA-223) | Indexed activity and pending-operation reconciliation | PRA-220, PRA-198 |
| [PRA-224](https://linear.app/pragmacollective/issue/PRA-224) | Portfolio totals and full live data-flow evidence | PRA-221, PRA-222, PRA-223, PRA-213, PRA-218 |

All required-spec child dependencies are wired, including the shared data capabilities. PRA-222 is independently testable without PRA-217's deposit UI; PRA-224 consumes execution evidence from PRA-213/PRA-218, not their final verification consumers PRA-215/PRA-219. PRA-209 public-resolution development may begin after PRA-206, but final own-name acceptance also requires PRA-208. Existing native blockers alone do not replace provider/human feasibility gates; do not add whole-epic blockers that create cycles.

## Published Stretch Tickets

These low-priority tickets do not block required delivery. Scheduling is secondary to required work, not encoded as a whole-project blocker.

| Ticket | Outcome | Native Blockers |
| --- | --- | --- |
| [PRA-225](https://linear.app/pragmacollective/issue/PRA-225) | Arc execution and USDC denomination proof | PRA-187 |
| [PRA-226](https://linear.app/pragmacollective/issue/PRA-226) | Real Arc testnet USDC receive/send | PRA-225, PRA-198 |
| [PRA-227](https://linear.app/pragmacollective/issue/PRA-227) | Arc sponsorship, isolation, and demo evidence | PRA-226, PRA-199, PRA-190 |
| [PRA-228](https://linear.app/pragmacollective/issue/PRA-228) | Second-device authority and pairing verification | PRA-202 |
| [PRA-229](https://linear.app/pragmacollective/issue/PRA-229) | Independent Android recovery-device enrollment | PRA-228, PRA-198 |
| [PRA-230](https://linear.app/pragmacollective/issue/PRA-230) | Second-phone recovery and lost-signer revocation | PRA-229, PRA-205 |
| [PRA-231](https://linear.app/pragmacollective/issue/PRA-231) | Recovery-device revocation and interrupted flows | PRA-230, PRA-199, PRA-194 |

## Human Setup

[PRA-186: Provider accounts, API access, and secrets](https://linear.app/pragmacollective/issue/PRA-186) is assigned to the user and labeled `ready-for-human`. It covers ZeroDev, sponsorship configuration, Sepolia access/funding, ENS owner access, Proton Pass/device setup, and conditional Graph, Uniswap, hosting/storage, domain, pricing, build, and stretch-service access.

Secret values must not be posted in Linear or committed. Record only redacted configuration references and secure handoff locations. Agents own compatibility research and smoke tests; humans own account consent, credentials, private wallet approvals, and budget authorization. A provider account does not prove integration compatibility.

Only the relevant setup subset gates each feature. In particular PRA-187 needs Bundler access, RPC, and test funding, not completion of the entire cross-project checklist.

## Sequencing

- Start native signing proof and launcher-shell work independently. Run provider/deployment feasibility checks early rather than waiting for complete feature UIs.
- Kernel execution enables the shared operation lifecycle owned by Payments and Sponsorship. ENS writes, recovery, swaps, and vault actions reuse this lifecycle rather than building competing transaction engines.
- Complete wallet and ENS creation before completing new-user onboarding. Shell development does not wait for every wallet feature.
- Resolve the exact USDC test token jointly across payments, Uniswap, and Morpho; verify Graph coverage of that token and vault. Do not discover incompatible tokens after building the three flows separately.
- Morpho supplies the selected vault and execution outcomes; Portfolio and Activity owns normalized Graph-backed position display. Split capability dependencies at ticket level to avoid a whole-epic cycle.
- Required completion does not depend on either stretch spec. Do not assume Arc accounts or recovery state match Ethereum Sepolia automatically.
- Use `to-tickets` separately for each spec. Review each numbered proposal with the user before publishing child tickets and native blocking relationships. Epic-level labels authorize feasibility work, not bypassing unresolved gates.

## Starting Work

These required tickets have no native implementation blockers and can begin independently. Live checks still need relevant device access, credentials, or owner approvals from PRA-186.

- PRA-184: verify the Kernel raw-P256 validator path.
- PRA-185: prove hardware-authorized Android signing.
- PRA-190: build the Android Home shell.
- PRA-195: verify sponsorship-service capabilities and configuration.
- PRA-196: verify one shared Sepolia USDC asset, Uniswap route, and Morpho vault.
- PRA-201: prove Proton Pass access and clean-install discovery.
- PRA-206: verify namespace authority and settle lifecycle policy.

The published dependency map is acyclic and has no required ticket depending on a stretch ticket. Provider compatibility, unresolved policy decisions, credentials, and physical device evidence remain real gates. The 10-day window is a delivery constraint, not a verified estimate that all ticket work fits.

## Testing

The user approved user-visible flow tests as the primary boundary, supplemented by focused native/contract tests for authorization, signature correctness, and replay protection. Real Android hardware, GrapheneOS without Google services, live providers, and testnet receipts supply integration evidence. The starter has no existing test suite; no integration support or test result is implied by publication.

## Sources of Truth

- [Hackathon decisions and sponsorship rules](hackathon-decisions.md) capture the agreed scope and outstanding policy details.
- [Architecture decisions](adr/README.md) preserve the original decisions and the Ethereum Sepolia revision.
- [Domain glossary](../CONTEXT.md) defines the installation, wallet user, smart account, username, and credentials.
- [Original v0.5 source](../sodera.md) is historical context, not an additional backlog. These specs and agreed decisions override its conflicting requirements.
