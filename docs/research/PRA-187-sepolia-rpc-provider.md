# PRA-187: Ethereum Sepolia JSON-RPC provider

Research date: 2026-09-11

## Decision summary

**Use `https://ethereum-sepolia-rpc.publicnode.com` as `SEPOLIA_RPC_URL` for the 10-day hackathon. Keep the existing project-scoped ZeroDev Sepolia Bundler/Paymaster endpoint in `ZERODEV_SEPOLIA_BUNDLER_RPC`; do not collapse the two configuration values. Defer QuickNode provisioning until PublicNode demonstrates an actual availability, latency, or rate-limit problem, and never switch providers silently at runtime.**

PublicNode is the lowest-friction fit for the scoped proof because it requires no account or client secret, is independent from the ZeroDev submission path, and has already passed Sodera's exact compatibility checks. Its official Ethereum page publishes both Sepolia HTTP and WebSocket endpoints. On 2026-09-11, the HTTP endpoint returned chain ID `11155111`, the expected deployed bytecode for EntryPoint, Kernel factory, Kernel implementation, and WebAuthn validator, and supported the exact state-override `eth_call`. The genuine assertion returned validation data `0`, while the changed challenge returned `1` ([PublicNode Ethereum](https://ethereum.publicnode.com), [PRA-184 report](./PRA-184-kernel-webauthn-validator.md), [PRA-185 report](./PRA-185-android-credential-manager.md)).

QuickNode is the deferred contingency because its first-party `eth_call` reference explicitly documents the third state-override parameter and includes a viem example. Its Ethereum product page explicitly lists Sepolia chain ID `11155111`, HTTPS/WSS, and the standard methods Sodera needs. The current free trial provides one endpoint, 10 million API credits, and 15 requests/second for one month, which is ample if PublicNode becomes unreliable ([QuickNode `eth_call`](https://www.quicknode.com/docs/ethereum/eth_call), [Ethereum networks](https://www.quicknode.com/chains/ethereum), [pricing](https://www.quicknode.com/pricing)). Provisioning it now would add a token-bearing endpoint and trial lifecycle without resolving an observed blocker.

This recommendation does not rely on an unsupported claim that one vendor is "more popular." The defensible ecosystem evidence is narrower: QuickNode and Alchemy publish viem examples, Chainstack lists viem as supported tooling, and ZeroDev and viem both document separate public/execution and Bundler client roles ([QuickNode `eth_call`](https://www.quicknode.com/docs/ethereum/eth_call), [Alchemy Ethereum quickstart](https://www.alchemy.com/docs/reference/ethereum-api-quickstart), [Chainstack Ethereum quickstart](https://docs.chainstack.com/reference/ethereum-getting-started), [viem Public Client](https://viem.sh/docs/clients/public), [viem Bundler Client](https://viem.sh/account-abstraction/clients/bundler)).

## Two RPC roles, not one

| Role | Sodera client/configuration | Required protocol surface | Current flow |
| --- | --- | --- | --- |
| Ethereum execution RPC | viem `createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) })` | Standard Ethereum execution JSON-RPC reads, calls, logs, gas data, and transaction receipts | Derives/checks the Kernel account, reads chain state, runs validator calls, and independently verifies the resulting transaction/account state. |
| ERC-4337 Bundler/Paymaster | viem `createBundlerClient` plus ZeroDev `createZeroDevPaymasterClient`, both using `ZERODEV_SEPOLIA_BUNDLER_RPC` | `eth_supportedEntryPoints`, `eth_estimateUserOperationGas`, `eth_sendUserOperation`, `eth_getUserOperationReceipt`, ZeroDev sponsorship methods, and `pimlico_getUserOperationGasPrice` | Estimates and sponsors the UserOperation, accepts it into the alternative mempool, submits it through EntryPoint v0.7, and returns its UserOperation receipt. |

These are different APIs even when a vendor exposes them through one URL. Viem defines a Public Client as the interface to public Ethereum JSON-RPC methods and defines a Bundler Client as the interface for sending and retrieving ERC-4337 UserOperations. Its Bundler Client takes an underlying execution `client` separately from its Bundler `transport` ([Public Client](https://viem.sh/docs/clients/public), [Bundler Client](https://viem.sh/account-abstraction/clients/bundler)). The current `app/scripts/verify-kernel-live.mjs` follows exactly that shape.

### Can the ZeroDev URL technically be `publicClient`?

**Yes, technically, for the standard methods its gateway proxies. No, it should not be Sodera's selected `SEPOLIA_RPC_URL`.** ZeroDev's own quickstart constructs a viem Public Client over the same `ZERODEV_RPC` used for its Bundler and Paymaster, so the unified endpoint can proxy execution RPC. The same example immediately says, "Use your own RPC provider in production (e.g. Infura/Alchemy)" ([ZeroDev quickstart](https://docs.zerodev.app/get-started/quickstart)).

PRA-187 should keep a separate execution endpoint because:

- ZeroDev's documented contract for the project URL is Bundler/Paymaster service; the reviewed public docs do not guarantee Sodera's exact state-override `eth_call` behavior or all standard log/receipt methods.
- The ticket requires independent resulting-state evidence. Reading the chain through a provider independent of the Bundler is a materially better corroboration than asking the submission gateway to attest to its own result.
- Separate URLs isolate quotas and incidents and make either provider replaceable without changing the other role.
- A unified URL would make ZeroDev both the submission path and the only observation path, increasing correlated failure risk during the hackathon.
- PRA-187 explicitly requires missing or incompatible configuration to fail visibly without provider/network fallback. Distinct required variables make that boundary testable.

## Exact PRA-187 execution-RPC requirements

The source of truth is PRA-187's acceptance criteria, the pinned SDK flow in `app/scripts/verify-kernel-live.mjs`, and the physical-validator proof in `app/scripts/verify-device-webauthn.mjs`. Sepolia must return chain ID `11155111` (`0xaa36a7`), matching viem's `sepolia` chain and the UserOperation hash domain.

| Method or feature | Need | Why |
| --- | --- | --- |
| `eth_chainId` | Required, fail closed | Both endpoints must identify Ethereum Sepolia `11155111`; no network fallback is allowed. |
| `eth_call` | Required | Kernel/validator reads, EntryPoint nonce/account queries, counterfactual account logic, post-execution contract reads, and negative authorization calls use it. Viem `readContract` also maps to `eth_call`. |
| `eth_call` state override | Required for the existing evidence/regression flow; not required for the final deployed-account happy path | `verify-device-webauthn.mjs` injects only the genuine passkey public-key storage into validator state, then proves the exact assertion succeeds and a changed challenge fails. Viem exposes this as `stateOverride` on `call` ([viem `call`](https://viem.sh/docs/actions/public/call#stateoverride-optional)). PRA-187 should keep this check available even though the real account stores its key on deployment. |
| `eth_getCode` | Required | `account.isDeployed()`, pinned contract presence, and post-deployment evidence need current runtime code. An empty result at Sepolia precompile `0x100` is not by itself a failure, as PRA-184 explains. |
| `eth_getBalance` | Required | Determines whether the counterfactual account is funded and can independently prove bounded ETH state changes. |
| `eth_getStorageAt` | Required | The current live verifier checks the Kernel ERC-1967 implementation slot; it is useful independent state evidence after deployment. |
| `eth_getTransactionReceipt` | Required | After the Bundler returns a successful UserOperation receipt and transaction hash, retrieve the outer Ethereum transaction receipt independently and require `status == 0x1`. A transaction receipt alone is not enough: PRA-187 must also require the inner UserOperation receipt's `success == true`. |
| Receipt logs and `eth_getLogs` | Receipt logs required; `eth_getLogs` recommended | EntryPoint `UserOperationEvent` and operation-specific events provide independent state evidence. Receipt logs avoid broad scans. `eth_getLogs` is needed only for recovery/backfill or a bounded block-range check, not for continuous indexing. |
| `eth_getBlockByNumber` | Recommended/current fee support | Supplies current EIP-1559 base fee and block context. Viem fee estimation may use it. |
| `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_gasPrice` | Recommended, not on the pinned happy-path critical path | A general viem Public Client may use these to estimate EIP-1559/legacy fees. The current live script instead obtains UserOperation fee fields from `pimlico_getUserOperationGasPrice` on the ZeroDev Bundler. |
| `eth_estimateGas` | Standard compatibility, not a substitute for Bundler estimation | Useful for ordinary transaction/call tooling. UserOperation limits must come from `eth_estimateUserOperationGas` on the Bundler because ERC-4337 has call, verification, pre-verification, and paymaster gas fields. |
| `eth_getTransactionCount` | Standard compatibility, usually indirect | Useful for ordinary EOAs, but Kernel's ERC-4337 nonce is read through EntryPoint contract calls rather than treated as an EOA transaction count. |
| HTTP batch requests | Optional optimization | Useful for grouped reads, but the current script's `Promise.all` does not require JSON-RPC batch support. Do not make correctness depend on batching during the hackathon. |
| WebSocket / `eth_subscribe` | Not needed | Viem's HTTP transport and bounded polling are sufficient for one operation and receipt. Persistent mobile sockets add lifecycle/reconnect complexity with no PRA-187 acceptance benefit. |
| Archive state | Not needed | Every required decision and proof is at `latest` or around the newly submitted transaction. Historical state older than a provider's retained full-node window is outside PRA-187. |
| `debug_*`, `trace_*`, Beacon API | Not needed | Receipt status, EntryPoint events, contract reads, balance/code/storage, and operation-specific state prove acceptance. Tracing is a troubleshooting option, not an acceptance dependency. Consensus-layer APIs are unrelated. |
| `eth_sendRawTransaction` | Not needed for this flow | ZeroDev's Bundler submits the outer EntryPoint transaction. Sodera submits a signed UserOperation, not an EOA transaction, to the Bundler. |

## Provider comparison

All plan figures below are snapshots of first-party pages on 2026-09-11 and can change. "State override unknown" means the provider may implement it, but its reviewed first-party `eth_call` reference does not document the third parameter; it is not a claim of non-support.

| Provider | Ethereum Sepolia and auth | Free-tier suitability | State override evidence | Operational/security assessment for PRA-187 |
| --- | --- | --- | --- | --- |
| **QuickNode** | Explicit Sepolia `11155111`; private HTTPS/WSS URL containing an auth token ([Ethereum](https://www.quicknode.com/chains/ethereum), [endpoints](https://www.quicknode.com/docs/ethereum/endpoints)). | One-month free trial: 10M API credits, one endpoint, 15 requests/s; no free-tier SLA ([pricing](https://www.quicknode.com/pricing)). `eth_getLogs` is limited to five blocks per request on the free trial ([`eth_getLogs`](https://www.quicknode.com/docs/ethereum/eth_getLogs)), which is acceptable for receipt-adjacent verification. | **Explicitly documented** as the third `eth_call` parameter with balance, nonce, code, full-state, and `stateDiff` overrides, including viem and curl examples ([`eth_call`](https://www.quicknode.com/docs/ethereum/eth_call)). | **Deferred contingency.** Provision only after an observed PublicNode availability, latency, or quota failure. Its token-bearing URL must not be treated as secret if shipped directly in a mobile bundle. |
| **Alchemy** | Explicit Sepolia `11155111`; HTTPS/WSS URL containing an API key ([Sepolia](https://www.alchemy.com/rpc/ethereum-sepolia)). Official quickstart uses viem ([quickstart](https://www.alchemy.com/docs/reference/ethereum-api-quickstart)). | Free: 30M compute units/month, 25 requests/s, all mainnets/testnets; `eth_call` costs 26 CU ([pricing](https://www.alchemy.com/pricing), [`eth_call`](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-call)). | **Unknown for `eth_call`.** The current reference schema lists only transaction and block parameters. Alchemy lists Sepolia `eth_simulateV1`/simulation products, but those are not the same wire call used by Sodera's viem verifier. | Strong standard-RPC option with public status reporting and viem docs, but not selected until the exact third-parameter call passes a credentialed probe. Do not infer support from Debug API or a different simulation API. |
| **Infura** | Explicit Sepolia HTTPS/WSS endpoint with API key in URL ([endpoints](https://docs.infura.io/get-started/endpoints)). MetaMask uses Infura by default, and its current extension source constructs the built-in Sepolia URL as `https://sepolia.infura.io/v3/<project-id>` ([MetaMask support](https://support.metamask.io/configure/networks/why-infura-cannot-serve-certain-areas/), [source](https://github.com/MetaMask/metamask-extension/blob/develop/shared/constants/network.ts)). | Free: 3M credits/day and 500 credits/s; `eth_call` costs 80 credits ([pricing](https://docs.infura.io/get-started/pricing), [`eth_call`](https://docs.infura.io/reference/ethereum/json-rpc-methods/eth_call)). | **Unknown for `eth_call`.** Its current reference lists only transaction and block parameters. Sepolia `eth_simulateV1` explicitly supports state overrides, but changing Sodera's verifier to that method is unnecessary scope. | Strong documented core-method coverage and the default behind MetaMask's built-in Ethereum networks. Infura explicitly says never to put its API key in client-side code and supports limits/allowlists/JWTs ([API-key security](https://docs.infura.io/dashboard/how-to/secure-an-api/api-key)); direct mobile use therefore needs a public-key posture or a proxy. |
| **Chainstack** | Sepolia `11155111`, HTTPS/WSS, full and archive nodes; key-in-path or HTTP Basic authentication ([Ethereum quickstart](https://docs.chainstack.com/reference/ethereum-getting-started), [credentials](https://docs.chainstack.com/docs/manage-your-node#view-node-access-and-credentials)). | Developer: 3M request units/month and 25 requests/s; no archive/debug/trace on the free plan ([pricing](https://chainstack.com/pricing/)). This is sufficient because PRA-187 needs none of those extras. | **Unknown for `eth_call`.** Its reference lists two parameters. Its official simulation guide documents state overrides through `eth_simulateV1`, not the exact viem `eth_call` shape ([`eth_call`](https://docs.chainstack.com/reference/ethereum-ethcall), [simulation guide](https://docs.chainstack.com/docs/ethereum-simulate-a-uniswap-swap)). | Good standard-RPC candidate and clear viem/tooling support. Chainstack itself recommends treating endpoint credentials as secrets and proxying frontend traffic ([security guide](https://docs.chainstack.com/docs/best-practices-for-securing-your-chainstack-endpoint)). Not selected without the state-override probe. |
| **Ankr** | Official docs list Ethereum Sepolia HTTPS/WSS at `rpc.ankr.com/eth_sepolia/{token}` and chain ID `11155111` ([Ethereum networks](https://www.ankr.com/docs/rpc-service/chains/chains-list/c-i/#ethereum)). | Freemium: 200M API credits/month under the public rate limit of about 1,800 requests/minute across endpoints; public/freemium traffic is lower priority during high load ([plans](https://www.ankr.com/docs/rpc-service/service-plans/)). | **Unknown for `eth_call`.** The reference documents only transaction and block parameters; `eth_simulateV1` separately documents limited state overrides ([Ethereum methods](https://www.ankr.com/docs/rpc-service/chains/chains-api/ethereum/web3-p2/#eth_call)). | Attractive quota and broad core-method list, but lower priority under load and no documented exact override make it a secondary candidate rather than the hackathon default. |
| **PublicNode** | Official no-key Ethereum Sepolia HTTP/WSS endpoints ([Ethereum endpoint page](https://ethereum.publicnode.com)). | Free/shared; no account setup. No first-party numeric rate limit or SLA was found. | **Direct Sodera evidence:** the existing PRA-184/PRA-185 reports and fresh PRA-187 probes record successful chain/deployment checks and exact state-override `eth_call` against `https://ethereum-sepolia-rpc.publicnode.com`. | **Hackathon primary.** It is already compatible, independent from ZeroDev, safe to configure without a token, and requires no speculative account setup. Shared capacity and the lack of an SLA make it unsuitable as an unquestioned production dependency. |

### Reliability conclusion

No free plan reviewed offers a contractual availability guarantee. Provider status pages and infrastructure claims help incident response but do not prove future reliability. For this 10-day testnet build, the practical controls are: run the exact PublicNode compatibility probe before execution, fail visibly on chain mismatch or unsupported methods, bound retries with jitter, poll receipts rather than keeping mobile WebSockets alive, and record the selected provider in evidence. Provision and probe QuickNode only after a repeatable PublicNode availability, latency, or rate-limit failure; changing providers is an explicit configuration decision rather than automatic failover.

## Security and configuration

Use these names consistently:

```dotenv
# Explicit hackathon execution RPC; public and contains no credential.
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ZERODEV_SEPOLIA_BUNDLER_RPC=https://rpc.zerodev.app/api/v3/<project>/chain/11155111
```

- Keep `SEPOLIA_RPC_URL` and `ZERODEV_SEPOLIA_BUNDLER_RPC` separate and required. Assert both return `11155111` before deriving or signing an operation.
- Keep the existing names for scripts to avoid configuration drift. Do not add a provider-specific key variable when the complete provider URL is what viem consumes.
- Do not commit URLs, include them in screenshots, error messages, telemetry, receipts, or evidence JSON. Redact request errors that may contain the transport URL.
- `app/.env.local` is suitable for local scripts only. The lack of an `EXPO_PUBLIC_` prefix prevents Expo's normal public-variable inlining, but it does not make a value magically available and secret inside client JavaScript.
- If the Expo app calls JSON-RPC directly, any embedded URL/token is recoverable from the bundle or network traffic. Name it `EXPO_PUBLIC_SEPOLIA_RPC_URL` only after intentionally treating it as public, restricting it to Sepolia and the smallest supported method/usage scope, setting quota alerts, and accepting rotation risk. Native mobile apps cannot rely on a browser `Origin` header or stable source IP as a complete secret-control boundary.
- The safer post-hackathon design is a narrow Sodera backend relay with method allowlisting, body/range limits, rate limits, and server-held provider credentials. That backend is not required to prove PRA-187 and should not block the 10-day build.
- Treat the ZeroDev project URL as equally sensitive to abuse even though its capabilities differ. Scope its sponsorship policy tightly; a leaked paymaster-capable endpoint has direct quota/funding impact.
- Do not automatically switch from PublicNode after a provider error. Provisioning QuickNode, changing `SEPOLIA_RPC_URL`, and rerunning the chain/method probe must be an explicit operator decision so PRA-187's "no provider/network fallback" boundary and evidence provenance remain unambiguous.

## Minimal setup checklist

1. Set `SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com` in ignored local configuration. The same public value may remain in `.env.example`.
2. Keep the ZeroDev project-scoped Sepolia URL separately as `ZERODEV_SEPOLIA_BUNDLER_RPC` and confirm its chain is `11155111` and EntryPoint v0.7 is `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
3. Run the chain, core-method, and state-override checks below against PublicNode before account derivation and again before final evidence collection.
4. Keep receipt/log polling bounded to the submitted transaction and nearby blocks. Treat repeated timeouts, rate-limit responses, or excessive receipt latency as observable failures rather than silently retrying through another provider.
5. If those failures block the proof, create one QuickNode Ethereum **Sepolia** endpoint, record its owner, plan expiry, quota, and rotation procedure outside the repository, set it explicitly as `SEPOLIA_RPC_URL`, and rerun the full compatibility probe.
6. Before the final physical-device proof, record the selected provider name in non-secret metadata, re-run both endpoint chain checks, then collect the Bundler UserOperation receipt and independent execution-RPC transaction/state evidence.

## Verification commands

Run from `app/`. These commands consume existing environment variables without printing their values. They print only public chain data or a success label.

```bash
test -n "${SEPOLIA_RPC_URL:-}" && test -n "${ZERODEV_SEPOLIA_BUNDLER_RPC:-}"

curl --silent --show-error --fail \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "$SEPOLIA_RPC_URL" \
  | jq -e '.result == "0xaa36a7"' >/dev/null \
  && printf '%s\n' 'execution RPC: Sepolia OK'

curl --silent --show-error --fail \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "$ZERODEV_SEPOLIA_BUNDLER_RPC" \
  | jq -e '.result == "0xaa36a7"' >/dev/null \
  && printf '%s\n' 'ZeroDev RPC: Sepolia OK'

curl --silent --show-error --fail \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' \
  "$ZERODEV_SEPOLIA_BUNDLER_RPC" \
  | jq -e '.result | map(ascii_downcase) | index("0x0000000071727de22e5e9d8baf0edac6f37da032") != null' >/dev/null \
  && printf '%s\n' 'ZeroDev Bundler: EntryPoint v0.7 OK'

curl --silent --show-error --fail \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x0000000071727De22E5E9d8BAf0edAc6f37da032","latest"]}' \
  "$SEPOLIA_RPC_URL" \
  | jq -e '.result | type == "string" and startswith("0x") and length > 2' >/dev/null \
  && printf '%s\n' 'execution RPC: EntryPoint code OK'

pnpm verify:device-webauthn >/dev/null \
  && printf '%s\n' 'execution RPC: state-override validator vectors OK'

pnpm verify:kernel-webauthn >/dev/null \
  && printf '%s\n' 'execution and ZeroDev RPC compatibility OK'
```

For the final PRA-187 submission, use the existing live verifier shape rather than a raw `eth_sendRawTransaction`. It already keeps endpoints out of output and distinguishes UserOperation success from outer transaction inclusion:

```bash
SUBMIT_SYNTHETIC_USER_OPERATION=1 pnpm verify:kernel-live > /tmp/pra187-kernel-live-public-evidence.json
jq -e '.evidence.receipt.success == true' /tmp/pra187-kernel-live-public-evidence.json >/dev/null \
  && printf '%s\n' 'UserOperation receipt: success'
```

PRA-187 must replace the synthetic credential callback with the real Primary Passkey ceremony proven by PRA-185; this command is only an RPC/Bundler configuration check. Do not print the environment, run shell tracing (`set -x`), or include transport errors verbatim in committed evidence.

## Primary source index

- [PRA-187 Linear issue](https://linear.app/pragmacollective/issue/PRA-187/execute-a-kernel-operation-with-the-primary-passkey): acceptance criteria and no-fallback boundary.
- [`app/scripts/verify-kernel-live.mjs`](../../app/scripts/verify-kernel-live.mjs): current execution RPC, Bundler, Paymaster, fee, receipt, and post-state flow.
- [`app/scripts/verify-device-webauthn.mjs`](../../app/scripts/verify-device-webauthn.mjs): exact state-override requirement.
- [PRA-184](./PRA-184-kernel-webauthn-validator.md) and [PRA-185](./PRA-185-android-credential-manager.md): executed Sepolia and physical-passkey evidence consumed by PRA-187.
- [Ethereum.org networks](https://ethereum.org/en/developers/docs/networks/#sepolia): Sepolia is the application-development testnet.
- [Viem Public Client](https://viem.sh/docs/clients/public), [Bundler Client](https://viem.sh/account-abstraction/clients/bundler), and [`call` state override](https://viem.sh/docs/actions/public/call#stateoverride-optional): client-role and wire-method semantics.
- [ZeroDev quickstart](https://docs.zerodev.app/get-started/quickstart): unified endpoint is technically usable as a Public Client, while ZeroDev recommends an independent production RPC.
- QuickNode: [Ethereum/Sepolia](https://www.quicknode.com/chains/ethereum), [`eth_call`](https://www.quicknode.com/docs/ethereum/eth_call), [`eth_getLogs`](https://www.quicknode.com/docs/ethereum/eth_getLogs), [endpoints](https://www.quicknode.com/docs/ethereum/endpoints), [pricing](https://www.quicknode.com/pricing), and [status](https://status.quicknode.com).
- Alchemy: [Sepolia](https://www.alchemy.com/rpc/ethereum-sepolia), [Ethereum quickstart](https://www.alchemy.com/docs/reference/ethereum-api-quickstart), [`eth_call`](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-call), [pricing](https://www.alchemy.com/pricing), and [status](https://status.alchemy.com).
- Infura: [endpoints](https://docs.infura.io/get-started/endpoints), [`eth_call`](https://docs.infura.io/reference/ethereum/json-rpc-methods/eth_call), [pricing](https://docs.infura.io/get-started/pricing), and [API-key security](https://docs.infura.io/dashboard/how-to/secure-an-api/api-key). MetaMask: [default Infura support statement](https://support.metamask.io/configure/networks/why-infura-cannot-serve-certain-areas/) and [built-in Sepolia URL source](https://github.com/MetaMask/metamask-extension/blob/develop/shared/constants/network.ts).
- Chainstack: [Ethereum/Sepolia](https://docs.chainstack.com/reference/ethereum-getting-started), [`eth_call`](https://docs.chainstack.com/reference/ethereum-ethcall), [pricing](https://chainstack.com/pricing/), [credentials](https://docs.chainstack.com/docs/manage-your-node#view-node-access-and-credentials), and [security](https://docs.chainstack.com/docs/best-practices-for-securing-your-chainstack-endpoint).
- Ankr: [Ethereum/Sepolia](https://www.ankr.com/docs/rpc-service/chains/chains-list/c-i/#ethereum), [Ethereum methods](https://www.ankr.com/docs/rpc-service/chains/chains-api/ethereum/), and [plans/rate limits](https://www.ankr.com/docs/rpc-service/service-plans/).
- PublicNode: [Ethereum Sepolia endpoint and telemetry](https://ethereum.publicnode.com).
