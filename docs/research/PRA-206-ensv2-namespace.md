# PRA-206: ENSv2 namespace architecture and lifecycle gates

Research date: 2026-09-12

Scope decision (2026-09-13): ENSv2 child-registry deployment and per-user subname issuance are deferred to the next hackathon. The current wallet UI uses `anon.sodera.eth` as an explicitly non-resolving fixture label. The evidence and proposed architecture below are preserved for the deferred implementation; no namespace writes should be performed for the current build.

## Executive answer

**The ETHOnline 2026 ENSv2 deployment is suitable for a Sodera namespace in principle, but PRA-206 is not yet safe to pass and username issuance must remain stopped.** The official hackathon deployment provides the required hierarchical registry, factory-deployed `UserRegistry` and `PermissionedResolver` proxies, owner-controlled records, transfers, expiry, reservation, and Universal Resolver V2 traversal. Sodera does not need a custom resolver implementation.

Three gates remain open:

- Live Sepolia evidence confirms that `sodera.eth` is registered to `0x7Ed0...3915` but has neither a resolver nor a subregistry. Sodera must deploy and mount its namespace proxy before issuance; no existing Sodera proxy is reachable from the canonical hierarchy.
- The beta documentation still contains incompatible resolver write examples. The Permissioned Resolver, Verifiable Factory, and hackathon Deployment Portal use DNS-name setters such as `setAddress(bytes,uint256,bytes)`, while the App Developer guide shows older namehash setters. Contract writes must use the implementation-specific interfaces and ABIs from the corrected docs build and Deployment Portal, then be checked against the deployed contracts rather than copied selectively from one prose page.
- Emancipation, lifecycle, label policy, and public-registration abuse controls require explicit user choices. A safe child role bitmap alone does not protect users while an ancestor can replace the `sodera.eth` subregistry pointer, an approved ERC-1155 operator inherits the owner's name roles, or a proxy remains locally upgradeable.

A Durin deployment is not a drop-in alternative for the pinned ETHOnline environment. Durin's temporary Sepolia ENSv2 adapter is hardcoded to the separate standard Sepolia ENSv2 registry, so the live `sodera.eth` owner cannot configure the shared adapter for the hackathon registration. Adopting Durin would also replace the direct ENSv2 child registry and per-account resolver model with an L2 ERC-721 registry, a trusted CCIP Read gateway signer, and an L1 resolver controlled by the Durin operator.

Status vocabulary:

- **PASS**: established by the official hackathon deployment page or protocol source semantics.
- **FAIL**: a required claim is contradicted or lacks evidence required by PRA-206.
- **UNKNOWN**: requires a live Sepolia observation or user decision not included in this research slice.

## Official hackathon deployment

The dedicated ETHOnline deployment is on Ethereum Sepolia, chain ID `11155111`. It is separate from both ENSv1 Sepolia and the standard ENSv2 Sepolia deployment. The official deployment page explicitly requires applications to override viem/ethers' built-in Sepolia Universal Resolver with the hackathon proxy.

| Role | Official hackathon address | How Sodera uses it |
| --- | --- | --- |
| Root registry | [`0xe7f0d5724f8337e3aa9a9910540341ff4273fed9`](https://sepolia.etherscan.io/address/0xe7f0d5724f8337e3aa9a9910540341ff4273fed9) | Root of every canonical hierarchy and resolution check. |
| `.eth` registry | [`0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e`](https://sepolia.etherscan.io/address/0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e) | Contains the `sodera` entry and its owner, expiry, resolver, roles, and subregistry pointer. |
| `.eth` registrar | [`0x7d1b7f586a62ac3f54b9a396849757814283270b`](https://sepolia.etherscan.io/address/0x7d1b7f586a62ac3f54b9a396849757814283270b) | Registration/renewal service for the parent `.eth` name, not for Sodera usernames. |
| Label store | [`0xd7351f76866123a7e49381f38a30a96adba7e855`](https://sepolia.etherscan.io/address/0xd7351f76866123a7e49381f38a30a96adba7e855) | Shared label database used by standard registries. |
| Contract namer | [`0x21a2b577709727119f1901314e0ba0150eafa15e`](https://sepolia.etherscan.io/address/0x21a2b577709727119f1901314e0ba0150eafa15e) | Names protocol contracts; not a Sodera authority. |
| Verifiable Factory | [`0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780`](https://sepolia.etherscan.io/address/0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780) | Deploys deterministic per-name and per-account UUPS proxies and verifies their provenance. |
| User registry implementation | [`0x47b442d0cf617c41cabaff5f02f44dd1e5f72546`](https://sepolia.etherscan.io/address/0x47b442d0cf617c41cabaff5f02f44dd1e5f72546) | Shared implementation for a factory-created Sodera registry proxy. Do not use this address as the registry instance. |
| Permissioned resolver implementation | [`0xa9d3814ab151bf6e37a427432795371a8361614e`](https://sepolia.etherscan.io/address/0xa9d3814ab151bf6e37a427432795371a8361614e) | Shared implementation for factory-created account resolver proxies. Do not set a name directly to the implementation. |
| Universal Resolver V2 implementation | [`0xfea8d4b7fcce0b8765c793d6695eac384aaa458f`](https://sepolia.etherscan.io/address/0xfea8d4b7fcce0b8765c793d6695eac384aaa458f) | Shared resolution implementation. Applications should not call or configure this address as the stable entry point. |
| Upgradable Universal Resolver proxy | [`0xd26f2040d083af1cd2962ba303f4bea0c4faf142`](https://sepolia.etherscan.io/address/0xd26f2040d083af1cd2962ba303f4bea0c4faf142) | Required hackathon resolution entry point and viem/ethers override. |
| Managed Universal Resolver proxy | [`0x1abed09f1f36383f27cf0b3a5e0ea1738e1fd921`](https://sepolia.etherscan.io/address/0x1abed09f1f36383f27cf0b3a5e0ea1738e1fd921) | Separate managed proxy in the deployment; not the address the hackathon page instructs apps to configure. |
| Registry upgrade set | [`0x658c43979721b6d30d173ea09622f2475761b382`](https://sepolia.etherscan.io/address/0x658c43979721b6d30d173ea09622f2475761b382) | Protocol-managed approved registry implementation set. Its presence does not grant it authority over a Sodera proxy; the proxy's root `ROLE_UPGRADE` holders still determine local upgrade authority. |
| Public resolver set | [`0x3866e84b54a78d1e3778421e0fbf3607fa9c402f`](https://sepolia.etherscan.io/address/0x3866e84b54a78d1e3778421e0fbf3607fa9c402f) | Approved public resolver set used by protocol flows; it is not a per-account resolver instance. |
| Batch registrar | [`0xc8efa80d9f645b26bacd1bae8638492df3bae8ca`](https://sepolia.etherscan.io/address/0xc8efa80d9f645b26bacd1bae8638492df3bae8ca) | Protocol batch utility; not a substitute for Sodera's issuance policy layer. |

This table corrects an earlier ambiguous reading of the addresses: `0x658c...` is `RegistryUpgradeSet`, not a Universal Resolver; `0x894b...` is `VerifiableFactory`, not `ETHRegistry`; and the required Universal Resolver proxy is `0xd26f...`.

### Version and interface status

**PASS, deployment identity.** The dedicated deployment page, Deployment Manager, and Deployment Portal all identify this environment as the ETHOnline 2026 Sepolia deployment. These addresses must be pinned together as one deployment set; addresses from `contracts-v2`'s 2026-06-29 or 2026-07-30 standard Sepolia artifacts are different deployments and cannot be mixed in.

**PASS, protocol shape.** The corrected [ETHOnline ENSv2 docs build](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/overview/), Portal ABI, and `contracts-v2` source around [`c6956ce`](https://github.com/ensdomains/contracts-v2/tree/c6956ce52c3e2ba48ceb166d404bcb4bba1aa932) agree on the relevant registry state model, factory initializer grants, DNS-name resolver setters, EAC, record linking, and UUPS authorization. The source is a compatibility anchor, not proven byte-for-byte provenance for the listed hackathon addresses.

**FAIL, exact version/provenance.** The official deployment table does not publish a release tag, source commit, compiler settings, runtime hashes, or deployment transaction beside the hackathon addresses. The public `contracts-v2` deployment artifacts inspected in commits [`48b3e2d`](https://github.com/ensdomains/contracts-v2/tree/48b3e2d39513b9dd32ef1850877a29009bc807b9) and [`f21e4b4`](https://github.com/ensdomains/contracts-v2/tree/f21e4b4a38c949a6fc5c7d3bdd1b418292c880f1) contain different standard-Sepolia address sets. Exact source/runtime provenance therefore remains a live verification gate.

**FAIL, resolver documentation consistency.** In the corrected docs build at the research date:

- The Registry Template, Verifiable Factory, and hackathon Portal agree on `UserRegistry.initialize((address account,uint256 roleBitmap)[] grants)`.
- The Permissioned Resolver and Verifiable Factory pages document `PermissionedResolver.initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)`.
- The Permissioned Resolver page and Portal use DNS-encoded setters such as `setAddress(bytes name,uint256 coinType,bytes addressBytes)` and linked records.
- The App Developer page still shows older namehash setters such as `setAddr(bytes32,address)` and `setText(bytes32,string,string)`, contradicting its own statement that it describes the resolver's actual interface.

No write implementation should proceed until the deployed implementations' verified ABIs/selectors are recovered and tested. Read-only resolution through `0xd26f...` is less exposed to this drift, but must still be tested against the hackathon deployment.

## Expected Sodera topology

The expected hierarchy has three shared protocol contracts and two classes of Sodera-specific proxy:

```text
RootRegistry 0xe7f0...
  -> getSubregistry("eth")
ETHRegistry 0x1d78...
  -> entry "sodera": owner + resolver + expiry + roles
  -> getSubregistry("sodera")
Sodera UserRegistry proxy (factory-created, address still unverified)
  -> getParent() == (ETHRegistry, "sodera")
  -> entry "<username>": Kernel owner + account resolver + expiry + roles
PermissionedResolver proxy per Kernel account (factory-created on demand)
  -> address, avatar text, and future records for names owned by that account
```

The two implementation addresses in the deployment table are templates, not usable instances. The Verifiable Factory creates:

- One `UserRegistry` UUPS proxy for the `sodera.eth` namespace, conventionally salted from `namehash("sodera.eth")` and a version.
- One `PermissionedResolver` UUPS proxy per Kernel owner, conventionally salted from the owner and a version. Multiple names owned by that same account may share it.

The actual proxy addresses, deployer, salt, initializer calldata, implementation slots, and `ProxyDeployed` transactions must be recorded from chain data. A deterministic address calculation is not proof that a contract was deployed or mounted in the canonical hierarchy.

## Live Sepolia observation

Observed through the configured Sepolia RPC at block `11683997` (`2026-09-11T19:36:12Z`), chain ID `11155111`:

| Check | Live result | Status |
| --- | --- | --- |
| `RootRegistry.getSubregistry("eth")` | `0x1D78834d97c1D7b1A38c1deDBD1a287cFEd3971e` | PASS |
| `ETHRegistry.getParent()` | `(0xe7f0D5724f8337e3Aa9A9910540341Ff4273fEd9, "eth")` | PASS |
| `ETHRegistry.getState(keccak256("sodera"))` | `REGISTERED`, expiry `1851792492`, owner `0x7Ed08e45067d7Bb1c064055eC99aCD6586453915`, token/resource `0x1180e3958b42a39a21a92602d758d134b74f347e8440c1df143c767a00000000` | PASS |
| `ETHRegistry.getSubregistry("sodera")` | zero address | FAIL: namespace not mounted |
| `ETHRegistry.getResolver("sodera")` | zero address | FAIL: bare name unresolved |
| Universal Resolver `findResolver(sodera.eth)` | resolver zero, node `0x932954911bb15b7dc814e9b843c1c6344527844dc666705d8aadfb2a96a9176f`, offset `11` | FAIL: no resolver configured |
| Owner name roles | `0x1110000000000000000000000000000001100000` | PASS for setup authority |
| Owner contract code | `0x` | EOA; human confirmation of custody still required |

The owner role bitmap contains `ROLE_SET_SUBREGISTRY`, `ROLE_SET_RESOLVER`, both corresponding admin roles, and `ROLE_CAN_TRANSFER_ADMIN`. It is therefore sufficient for the owner to mount the child registry and configure the bare-name resolver. It does not grant unregister or renewal authority to the owner. Root-level protocol authorities remain a separate ancestor trust assumption.

The registration transaction is [`0x693b1f559cb813a0009eb0af51e50cc3c60cb28b3a4ae01ea0d1a209005f2003`](https://sepolia.etherscan.io/tx/0x693b1f559cb813a0009eb0af51e50cc3c60cb28b3a4ae01ea0d1a209005f2003), block `11649074`, timestamp `2026-09-06T18:48:12Z`. It registered `sodera` for `63072000` seconds with both `subregistry` and `resolver` set to zero. The registration emitted the only `EACRolesChanged` event for the current Sodera resource through the observation block. No `ApprovalForAll` event for the owner was found from `ETHRegistry` deployment through the observation block, and the owner had sent no later transaction after registration (latest nonce `15`, registration nonce `14`).

The factory at `0x894b...7780` is live and reports proxy logic `0x2fDCaC2F94B2E65c5d5fBf36EC34483d25Ca9025`. Both official shared implementations return the standard ERC-1967 `proxiableUUID`. Because the canonical `sodera` subregistry pointer is zero, there is currently no deployed Sodera registry proxy that can be proven through the hierarchy or checked with `verifyContract`.

### Contracts Sodera must deploy

1. **Required before future issuance:** one `UserRegistry` proxy through the official Verifiable Factory, initialized with reviewed grants, then assigned as the `sodera` subregistry and given canonical parent `(ETHRegistry, "sodera")`.
2. **Required per Kernel account at issuance:** one `PermissionedResolver` proxy through the same factory. Names owned by one Kernel account may share that account's resolver.
3. **Conditional:** a registrar/policy contract only if registration will be permissionlessly callable on-chain. A controlled issuance operator can instead hold the minimal `ROLE_REGISTRAR` role, but must enforce the same normalization, reservation, eligibility, rate-limit, and sponsorship policy off-chain.

No custom registry implementation or custom resolver implementation is required or recommended.

## Custom resolver answer

**Do not build a custom resolver for the hackathon.** The official `PermissionedResolverImpl` provides the required Ethereum address record, `avatar` text record, other text/data profiles, multicall, owner-controlled EAC, and `IExtendedResolver` compatibility. A custom resolver would remove the standard verified-implementation basis required by ENS's definition of emancipation and add bytecode, interface, indexing, and upgrade review with no PRA-206 benefit.

Sodera may still need a small registrar/policy contract or operator service in front of the standard `UserRegistry`. The registry intentionally does not implement product-specific normalization, reserved-word policy, eligibility, pricing, rate limits, or anti-abuse controls. This policy layer should hold only `ROLE_REGISTRAR` and, if approved, `ROLE_RENEW`; it must not hold resolver, subregistry, unregister, transfer-admin, or upgrade powers.

## Durin and the prior CellFi implementation

The [temporary Durin ENSv2 Sepolia guide](https://gist.github.com/gskril/997a95d6dc8493d3ffe82531382b0924), published on 2026-06-14, describes this topology:

```text
ENSv2 parent name on Sepolia
  -> resolver: Durin L1Resolver 0x5DC0...
  -> CCIP Read: gateway.durin.dev and Durin gateway signer
  -> L2Registry on a supported L2
  -> approved L2Registrar issues ERC-721 subnames and writes records
```

This avoids one resolver proxy per user because `L2Registry` also implements the resolver and stores every subname's records. It does not avoid per-user state: each subname is minted as an ERC-721 in the L2 registry. Resolution depends on EIP-3668 support, Durin's hosted gateway, its configured signer, the selected L2 RPC, and the parent resolver pointer.

### Incompatibility with the ETHOnline deployment

The guide calls `setL2RegistryV2(label, targetChainId, targetRegistryAddress)` on `0x5DC04646D946d910FfB87E20Efb5C56d2F46075D`. The verified contract calls itself `L1Resolver`, not `L1Registry`, and reports:

- `v2EthRegistry() == 0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`
- `ens() == 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`
- `url() == https://gateway.durin.dev/v1/{sender}/{data}`
- `signer() == 0x1E0B906b2350aABE06e8051670b083CCe03287FD`

The first address is not the pinned ETHOnline `.eth` registry at `0x1D78834d97c1D7b1A38c1deDBD1a287cFEd3971e`. At the observation block, `ownerOf(uint256(keccak256("sodera")))` on Durin's registry returned zero. A read-only simulation of `setL2RegistryV2("sodera", 421614, 0x0000000000000000000000000000000000000001)` from the actual ETHOnline `sodera.eth` owner reverted with `Unauthorized()` (`0x82b42900`). The adapter's `l2Registry(namehash("sodera.eth"))` entry was also unset.

Setting the ETHOnline `sodera` resolver pointer to this contract would therefore not be sufficient: the resolver has no authorized target mapping for the name. A new adapter built specifically for the hackathon registry might be possible, but it would be a custom resolver plus gateway architecture and contradict the current requirement to use the pinned official ENSv2 contracts. It should not be introduced under PRA-206 without a separate architecture decision.

### What CellFi actually did

Authenticated inspection of the private `pragma-collective/cell-fi` repository shows that CellFi vendored Durin and used the unmodified example `L2Registrar` on Arbitrum Sepolia:

- `BLOCKCHAIN_ID` is `ARB-SEPOLIA`; names use the `cellfi.eth` suffix.
- The backend holds `PRIVATE_KEY` and calls `register(label, walletAddress)` after creating a Circle developer-controlled wallet.
- The registrar writes coin types `60` and the L2's ENSIP-11 coin type, then calls `L2Registry.createSubnode`.
- The vendored registrar has no caller authorization. Once approved by `L2Registry`, any address can call it to register any available label to any owner; its only label policy is a minimum of three Unicode code points.
- The SMS path reports wallet creation success even when ENS registration returns a failure, and the HTTP user-creation route does not invoke ENS registration at all.

CellFi therefore provides a useful flow sketch, not a reusable production policy contract. Sodera can retain the backend-orchestrated sequence, but must not copy the permissionless registrar, label validation, failure handling, private-key custody model, or assumption that ordinary ethers Sepolia resolution points at the intended ENS deployment.

### Architecture decision

For the current ETHOnline scope, continue with the official `UserRegistry` plus official `PermissionedResolver` proxies. Durin's advantages are cheaper L2 issuance and one shared resolver/registry contract; its costs are a different ownership model, cross-chain and CCIP Read dependencies, shared gateway trust, weaker compatibility with the isolated hackathon deployment, and departure from the documented ENSv2 emancipation path. The resolver-proxy cost should be measured before changing architecture, but Durin is currently a larger trust and integration change than deploying one deterministic resolver proxy per Kernel account.

## Effective authority chain

### Parent `sodera.eth`

`sodera.eth` is an entry in `ETHRegistry`, not a self-contained object. Its effective control includes:

- The current token owner and every role granted on the `sodera` resource.
- Every account with applicable root roles in `ETHRegistry`.
- Every ERC-1155 operator approved with `setApprovalForAll` by the owner. In Permissioned Registry, an approved operator inherits the owner's effective roles for all names owned in that registry.
- The current parent registry path from RootRegistry to ETHRegistry. A replaced `.eth` pointer can redirect the whole subtree.
- `ROLE_SET_SUBREGISTRY`, which can replace the entire visible `sodera.eth` namespace in one transaction.
- `ROLE_SET_RESOLVER`, which controls records for the bare `sodera.eth` name but does not by itself replace the child registry.
- Transfer authority. Transfer requires `ROLE_CAN_TRANSFER_ADMIN` on the owner and moves the owner's name-scoped roles to the new owner; third-party role grants are unaffected.

Consequently, a Sodera child registry can be internally emancipated while user identities remain redirectable at the ancestor. A claim that `<username>.sodera.eth` is non-custodial requires either a permanently locked `sodera` subregistry pointer or an explicit, documented trust assumption that the `sodera.eth` owner can redirect the namespace. Locking requires proving that no applicable principal retains `ROLE_SET_SUBREGISTRY` or `ROLE_SET_SUBREGISTRY_ADMIN` for that entry. This is operationally irreversible and prevents pointer-based recovery from a broken child registry.

### Sodera UserRegistry proxy

The standard safe target is:

- Sodera's issuance principal retains `ROLE_REGISTRAR` on `ROOT_RESOURCE`.
- A renewal principal may retain `ROLE_RENEW` after lifecycle policy is approved.
- No account retains root `ROLE_SET_RESOLVER`, `ROLE_SET_SUBREGISTRY`, `ROLE_UNREGISTER`, `ROLE_CAN_TRANSFER_ADMIN`, `ROLE_UPGRADE`, or their admin counterparts.
- `ROLE_SET_PARENT` and `ROLE_SET_PARENT_ADMIN` are revoked after `getParent()` is correctly set to `(ETHRegistry, "sodera")`, if the user chooses to lock the canonical mount.
- Each new username owner receives `ROLE_SET_RESOLVER`, `ROLE_SET_RESOLVER_ADMIN`, `ROLE_SET_SUBREGISTRY`, `ROLE_SET_SUBREGISTRY_ADMIN`, and `ROLE_CAN_TRANSFER_ADMIN` at registration. Name-level admin roles cannot be granted later, so the exact registration bitmap is a one-time security choice.

The docs' formal emancipation list does not include `ROLE_SET_PARENT`, but canonical-parent integrity still requires auditing and normally locking it. Likewise, `ROLE_SET_URI` affects metadata presentation rather than resolution or ownership, but any retained holder must be recorded.

`ROLE_UPGRADE` is local to each UUPS proxy. The shared implementation cannot upgrade all instances, and the factory does not become proxy admin. Conversely, leaving `ROLE_UPGRADE` on a Sodera-controlled principal permits replacing all child-registry logic and bypasses every role-based claim. Full emancipation requires both `ROLE_UPGRADE` and `ROLE_UPGRADE_ADMIN` to have zero root assignees.

### User name and account resolver

For `<username>.sodera.eth`:

- The Kernel account should own the registry token and its owner role bitmap.
- Sodera must not hold username-scoped resolver, subregistry, unregister, transfer-admin, or admin roles.
- The name's resolver pointer should be the user's factory-created Permissioned Resolver proxy.
- The resolver should grant the Kernel account the write and admin roles required for address and avatar records. No backend requires resolver authority for the MVP.
- Any resolver `ROLE_UPGRADE` or `ROLE_UPGRADE_ADMIN` is authority to replace the resolver logic and must belong only to an explicitly accepted principal, or be revoked for an immutable resolver.

Transfer does not complete an identity handoff by itself. The name token's owner roles move to the recipient, but the resolver pointer remains unchanged, resolver roles do not automatically move, and unrelated name delegates remain. A transferred name can therefore continue resolving records controlled by the old owner until the recipient changes the pointer. Sodera must not represent transfer as a complete account/identity migration.

## Lifecycle semantics

The standard Permissioned Registry has exactly three states:

| Status | Meaning |
| --- | --- |
| `AVAILABLE` | Never registered, explicitly unregistered, or `block.timestamp >= expiry`. |
| `RESERVED` | Has an unexpired entry but no owner/token. |
| `REGISTERED` | Has an unexpired owner/token. |

Important consequences:

- Registration receives an absolute `uint64` expiry timestamp. The registry has no built-in grace period.
- At expiry, `ownerOf`, `getResolver`, and `getSubregistry` return zero for the name. The whole child path stops resolving immediately.
- Root `ROLE_RENEW` can revive an expired name with its previous owner, token, and roles if nobody re-registers it first.
- Re-registration after expiry starts a fresh registration, burns the prior token if necessary, increments permission/token versions, and prevents stale roles from carrying over.
- `renew` can only extend expiry. It cannot shorten it.
- `unregister` immediately makes the label available and burns/version-invalidates a registered token.
- Role changes regenerate the ERC-1155 token ID. Renewals and transfers do not. Sodera must key identity state by normalized full name or `(registry,labelhash)`, never by token ID.

The lack of a grace period creates a race between revival and fresh registration. "We will renew later" is not a safe recovery policy after expiry.

## Label, reservation, and abuse semantics

The standard registry hashes the exact UTF-8 label bytes. Its shared `LabelStore` checks DNS label size but does not enforce ENSIP-15 normalization, lowercase-only usernames, scripts, confusables, product reserved words, or uniqueness across alternate byte representations. Availability alone therefore does not establish that a user input is a valid Sodera username.

Required separation:

- **Invalid** is determined by the user-approved Sodera validation policy before any availability call.
- **Available** means registry status `0` for the exact normalized label bytes.
- **Reserved** means registry status `1`, or a product-reserved label rejected by the policy layer before chain access. These are distinct and should not be conflated in evidence/UI.
- **Unavailable** means registry status `2` for the canonical label.

The application should run a pinned ENS normalization implementation first, compare/display the canonical result, then apply the chosen Sodera subset. The contract/policy layer must enforce the same canonical bytes; client-only validation is bypassable.

Open public issuance is not safe through direct `UserRegistry.register()` access. A public registrar or operator boundary must enforce canonical labels, reservations, one username per eligible Kernel account, request and wallet limits, global budgets, replay/idempotency, and bounded sponsorship. The shared "10 sponsored operations per wallet per day" policy does not prevent an attacker from creating many wallets.

## Remaining live evidence

The parent registration and current empty pointers are proven above. Before PRA-206 can pass, the deployment/configuration flow must still record:

1. Prove the deployed child registry's `getParent()` is `(ETHRegistry,"sodera")` and that Universal Resolver traversal reaches that same proxy.
2. Read the ERC-1967 implementation slot of the child registry and each account resolver. Verify factory provenance with `verifyContract(proxy)` against the official implementation addresses.
3. Enumerate all child root and name principals from initialization and `EACRolesChanged` logs, then query current `roles`, `roleCount`, and `hasRootRoles`. Counts alone do not identify holders.
4. Record the factory `ProxyDeployed` event and transaction for each proxy, including sender, salt, implementation, and initializer calldata.
5. Record every resolver, subregistry, role-change, transfer, unregister, renewal, and upgrade event affecting `sodera.eth` and the child registry. Public transaction links are required.
6. Recover the deployed implementation ABIs/selectors and runtime hashes from verified explorer data or reproducible build artifacts. Test `supportsInterface` and a read call for each interface Sodera will consume.
7. Resolve the bare parent and a controlled child through `0xd26f...`; prove an ETH address and `avatar` read. Verify that default viem Sepolia configuration does not accidentally query another ENS deployment.
8. Run focused permitted-owner and forbidden-operator simulations/calls for `setResolver`, `setSubregistry`, transfer, `unregister`, root role grant, and UUPS upgrade. A revert caused only by missing gas/funds is not authorization evidence.

`docs/sodera.md`'s statement that registration is complete is now proven only for the parent label. It must not be interpreted as proof that the Sodera child namespace or account resolvers have been deployed and configured.

## Likely owner actions

These are reviewed future actions, not instructions to expose a private key and not actions performed by this report:

1. Confirm the controlling wallet is the intended owner and remove unintended ERC-1155 operators or delegates.
2. Deploy the Sodera `UserRegistry` proxy through the pinned factory with reviewed initializer calldata and no unaccounted principal.
3. Set and verify its canonical parent before revoking parent-change authority, if canonical-parent locking is approved.
4. Set the `sodera` subregistry pointer from the actual `sodera.eth` owner.
5. Reduce child-registry root roles to the approved registrar/renewal authorities and prove all dangerous root role counts are zero.
6. Decide whether to retain or irreversibly revoke the `sodera.eth` entry's ability to replace the child pointer.
7. Deploy each user's Permissioned Resolver proxy with the deployed ABI, grant only the Kernel account, and test address/avatar writes before assigning it to a username.

All signing actions belong to the ENS owner-access subset of PRA-186. Publication must prepare calldata and expected state changes for human review; it must not obtain private keys or perform namespace configuration.

## Decisions required before issuance

PRA-206 cannot choose these product policies implicitly:

1. **Ancestor redirect:** permanently lock the `sodera.eth` subregistry pointer, or disclose and accept that the Sodera parent owner can redirect every username. Locking improves non-custody but removes pointer-based recovery.
2. **Child upgradeability:** revoke registry upgrade and admin roles permanently, or identify the retained upgrade principal, controls, delay/review process, and user-facing trust claim.
3. **Resolver upgradeability:** let each Kernel retain resolver upgrade authority, make each resolver immutable, or adopt another explicitly reviewed owner-controlled policy.
4. **Duration:** choose an absolute registration duration. `uint64.max` avoids accidental expiry but prevents recycling abandoned names without unregister authority; finite terms require funded, observable renewal before expiry.
5. **Renewal:** choose who may renew, who pays, when renewal starts, how sponsorship failure is surfaced, and whether users can self-fund. There is no protocol grace period.
6. **Visible expiry:** choose warning thresholds and post-expiry UI. Expiry must not lock or replace the Kernel wallet; it only invalidates the ENS identity path.
7. **External transfer:** choose when Sodera detaches the transferred username from the installation, how the recipient takes resolver control, and how stale delegates are surfaced. Do not invent rename or replacement-name behavior.
8. **Validation:** approve the exact normalization library/version and allowed character, length, script, punctuation, and confusable policy.
9. **Reservations:** approve the exact reserved-label list and whether reservations are product-policy rejects, on-chain `RESERVED` entries, or both.
10. **Public registration:** approve per-device/account/IP limits, global budget, allow/deny controls, challenge/attestation posture, monitoring, and behavior when the registration or sponsorship service is unavailable.

Until those choices and the live evidence are attached, dependent PRA-207 configuration and PRA-208 issuance must remain blocked. The defensible current claim is "Sodera intends to use the official ETHOnline ENSv2 hierarchy," not "Sodera usernames are emancipated."

## Primary sources

- [Corrected ETHOnline 2026 ENSv2 overview](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/overview/): entry point for the permissioned-resolver inode-refactor documentation build.
- [ETHOnline 2026 Sepolia deployment table](https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments/#sepolia-ensv2-beta): dedicated environment, complete address set, and required Universal Resolver override.
- [Hackathon Deployment Manager](https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/): exclusive registration/configuration application.
- [Hackathon Deployment Portal](https://hackathon-deployment-portal-app.ens-cf.workers.dev/): exclusive explorer and deployed-app ABI surface.
- [Registry Hierarchy](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/registry-hierarchy/): forward/backward pointers, longest-suffix resolution, subtree replacement, and canonical hierarchy.
- [Permissioned Registry](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/permissioned-registry/): lifecycle, roles, operators, transfer, parent pointer, and formal emancipation checks.
- [Permissioned Resolver](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/permissioned-resolver/): per-account proxy, DNS-name setters, linked records, record roles, initializer calls, and local upgrades.
- [Enhanced Access Control](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/enhanced-access-control/): root fallback, admin escalation, role counts, and grant/revoke semantics.
- [Verifiable Factory](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/verifiable-factory/): CREATE2 proxy deployment, provenance verification, exact registry/resolver initializer examples, implementation roles, and salts.
- [Universal Resolver V2](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/universal-resolver-v2/): traversal, canonical registry checks, ownership, forward resolution, and reverse verification.
- [Mutable Token IDs](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/mutable-token-ids/): token/resource versioning and stable application identifiers.
- [Registry Template](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/registry-template/) and [Contract Developer tutorial](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/tutorial-contract-developers/): standard UserRegistry topology, registrar boundary, registration bitmap, and expiry choices.
- [`contracts-v2` resolver refactor commit `c6956ce`](https://github.com/ensdomains/contracts-v2/tree/c6956ce52c3e2ba48ceb166d404bcb4bba1aa932): closest public source compatibility anchor for the Portal's linked-record resolver and grants-based proxy initialization; not claimed as exact deployed-bytecode provenance.
- [`verifiable-factory` commit `5ef7b1a`](https://github.com/ensdomains/verifiable-factory/tree/5ef7b1a88fd9062bae580ed4048ca369f18450c4): factory/proxy source inspected for deterministic deployment and verification behavior.
- [Temporary Durin on Sepolia ENSv2 guide](https://gist.github.com/gskril/997a95d6dc8493d3ffe82531382b0924): adapter configuration for the separate standard Sepolia ENSv2 registry.
- [Durin contracts](https://github.com/ensdomains/durin): L2 ERC-721 registry/resolver, customizable registrar, L1 CCIP Read resolver, and gateway implementation.
- Private [`pragma-collective/cell-fi`](https://github.com/pragma-collective/cell-fi) repository at `6ca8cbc9`: prior Arbitrum Sepolia integration and backend registration flow, inspected through authenticated GitHub access.
