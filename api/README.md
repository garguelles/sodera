# Sodera API

One public Hono API serves both ENS and Uniswap routes on the same port:

| Route module | Purpose | Current endpoints |
| --- | --- | --- |
| `src/ens/` | ENS namespace reads and one-time passkey proof; future bounded name issuance | `GET /ens/availability/:label`, and the proof endpoints when PostgreSQL is configured |
| `src/uniswap/` | Teammate-owned Uniswap routes | `GET /uniswap/healthz` |

`GET /healthz` serves the combined API. `agent/` remains the separate, keyless AI planning service. The combined public API must **not** hold the issuer wallet's signing key: when registration is implemented it will use a private issuer worker with a separate secret boundary. Do not put signing secrets in `EXPO_PUBLIC_*`, the local `ens/` owner tool, git, the public API or the agent planner.

The designated issuer **public address** is `0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0`. It holds 0.1 Sepolia ETH but has no registrar grant. Its private key must not be placed in this public API's environment.

## Development

From `api/`, with Podman installed:

```bash
make start
make status
```

`make start` builds and starts the **combined API** at `http://127.0.0.1:8082` and persistent PostgreSQL at `127.0.0.1:5433` in Podman, waits for their health checks, and returns to your terminal. ENS routes are under `/ens`, Uniswap routes under `/uniswap`. The local database password and IP-hash key in `compose.dev.yaml` are **development-only**. `make logs` follows service logs; `make stop` stops the stack but preserves the named database volume. Run `make start` again after changing API code to rebuild it.

`pnpm typecheck`, `pnpm test`, `pnpm test:db`, and `pnpm build` verify the project; `test:db` uses the running Podman PostgreSQL for concurrency/replay tests. For production, deploy the Dockerfile as **one Railway API service** with a separate Railway PostgreSQL service with durable storage. Reference its `DATABASE_URL` in the API, and set `SEPOLIA_RPC_URL` and a newly generated, secret `ENS_CHALLENGE_IP_KEY` of at least 32 characters. Railway supplies `PORT`. Never configure the issuer private key on this service. Generate an HTTPS domain before setting `EXPO_PUBLIC_API_URL` in the mobile build. For local Android debug builds connected by USB, see the loopback instructions below.

The ENS availability endpoint applies the app's canonical username policy, distinguishes product-reserved from chain-reserved/registered labels, verifies the current ENSv2 hierarchy and implementation on Sepolia, and reports whether the parent has at least one year left. It returns `503` when the hierarchy/RPC cannot be verified. It does not mint names, hold a signer, or expose a claim endpoint yet.

### ENS proof handshake

The ENS routes stay read-only when `DATABASE_URL` is absent. To enable challenge/verification endpoints, provision durable PostgreSQL and set `DATABASE_URL` plus a random `ENS_CHALLENGE_IP_KEY` of at least 32 characters in the API's secret environment. It creates the `ens_claim_challenges` table on startup. Never use an in-memory store or place the issuer signing key in the combined API.

1. `POST /ens/challenges` with `{ "account": "0x…", "label": "gargs" }` checks live name availability and a deployed Kernel, then returns a 32-byte base64url `challenge`, UUID `id`, name, chain ID, and a five-minute expiry. Its signed digest commits to a fresh nonce, chain, registry, account, label and expiry; the private worker recomputes this binding before acting. The database serializes issuance and caps requests at 5/account, 30/IP hash, and 500 total per hour.
2. The mobile app invokes the pinned Primary Passkey with that challenge. `POST /ens/challenges/{id}/verify` takes `{ "account": "0x…", "label": "gargs", "proof": { "authenticatorData": "…", "clientDataJSON": "…", "signature": "…" } }`. The server **atomically consumes** the stored challenge bound to chain, registry, account and label before checking the signed assertion against the Kernel's current on-chain validator key. A valid result returns a ten-minute opaque `claimToken`; the database stores only its hash. A failed or replayed assertion cannot reuse the challenge.

The optional manual diagnostic in `app/src/components/passkey-proof-screen.tsx` requires `EXPO_PUBLIC_API_URL` set to the API's **HTTPS** URL (or loopback HTTP in a debug build), a deployed Kernel, and a supported Android Primary Passkey. It reports verification only, never an issued name. A controlled live backend check used the explicitly synthetic public test key from [PRA-184](../docs/research/PRA-184-kernel-webauthn-validator.md); that account is explicitly blocked from real name issuance.

### Bounded claim queue (disabled by default)

`ENS_CLAIMS_ENABLED=0` keeps `POST /ens/claims` and `GET /ens/claims/:id` unavailable. After a reviewed issuer grant and verified private worker, set it to `1`. Startup refuses to open claims unless the pinned issuer has **exactly** root `ROLE_REGISTRAR` on the mounted child registry; each request rechecks that role. `POST /ens/claims` takes `{ "account": "0x…", "label": "gargs", "claimToken": "…" }`; a Postgres transaction atomically redeems the ten-minute proof token and queues the name, enforcing one active claim per wallet and per label. Retrying the **same token**, or presenting a fresh proof for the same wallet and pending name after an app restart, returns the same claim ID. The status endpoint returns `queued`, submitted-transaction stages, `confirmed`, or `needs_attention`. A queued response is not an issued ENS name. For the testnet hackathon there is **no daily ENS claim cap**; the API retains challenge issuance limits of 5/account, 30/IP hash, and 500 total per hour. These are separate from ZeroDev's sponsorship allowance.

The local `make start` keeps claims disabled. **Only after** the owner reviews and signs the registrar grant and installs the worker secret, claims can be enabled. The default private worker mode requires one `ENS_CONTROLLED_KERNEL`. Set `ENS_ISSUER_MODE=hackathon` for repeatable demonstrations using a fresh passkey-controlled Kernel and unique label per run, including when the worker is deployed on Railway. It still re-verifies each Kernel assertion and rejects the public synthetic test wallet. The app's separate `EXPO_PUBLIC_ENS_CLAIMS_ENABLED=1` flag shows the explicit **Request ENS name** diagnostic action. None of these flags are needed for read-only availability or Step 5 passkey-proof checks.

For the deployed demos, use the **same Railway project** with one public API service, a PostgreSQL service and a **private issuer worker** from this `api/` Dockerfile. Set `ENS_CLAIMS_ENABLED=1` on the public API only after the grant. Give the worker `DATABASE_URL` from the same Postgres service, `SEPOLIA_RPC_URL`, `ENS_ISSUER_MODE=hackathon`, and `ENS_ISSUER_PRIVATE_KEY` through Railway's secret environment **only on the worker**. Override its start command to `node dist/issuer/worker.js`; it exposes no public domain or HTTP port. The public API must not receive that key. For a local worker, the same hackathon mode can instead run through `pnpm issuer:dev` with an ignored `.env.issuer.local`.

The private worker uses the same repository's built output but a **different process and environment**, with no public HTTP port. It re-verifies the stored WebAuthn assertion against the Kernel's current on-chain validator key **and** recomputes its account/label-bound challenge before acting; the public API's database status alone does not authorize signing. It rejects the publicly known synthetic test wallet and accepts successive real Kernels only when `ENS_ISSUER_MODE=hackathon` is explicitly configured. It predicts and factory-deploys an official resolver granting only that Kernel address/text/link/upgrade authority, initializes its coin-60 record, then registers one year of name ownership with the approved per-name bitmap. It stores transaction hashes and rechecks on-chain state after restarts instead of assuming a submitted transaction succeeded. A changed owner, resolver, role or canonical ENS hierarchy pauses issuance for manual attention.

Before requesting an on-chain grant, run a **read-only** resolver initializer simulation from `api/` with `ENS_DRY_RUN_ACCOUNT=<controlled test Kernel> SEPOLIA_RPC_URL=<Sepolia RPC> pnpm verify:issuer-resolver`; the output must report `matches: true` and `transactionSent: false`. The synthetic test Kernel works for this call-data check only, not actual issuance. No worker or issuer key is configured by `make start`. With the new challenge-binding digest, rerun the Android Step 5 proof against the deployed API before the first claim; previously verified tokens cannot be reused. Do not open claims or grant registrar authority until the worker deployment and demo procedure have been reviewed.

### USB Android proof test without Railway

With a connected Android **debug** build and the Podman stack running, forward the API to the device with `adb reverse tcp:8082 tcp:8082`. Start the app's Metro server with `EXPO_PUBLIC_API_URL=http://127.0.0.1:8082` (the client allows cleartext only for loopback in development). The app's existing `sodera://passkey-proof` diagnostic offers an ENS proof action once the Kernel has deployed. Choose an available test label and confirm the screen says the passkey was verified **without issuing a name**. Restart Metro after changing the Expo environment variable. See the [app's device steps](../app/README.md#local-ens-passkey-proof). If Android's installed debug build blocks loopback cleartext, rebuild that development client with a debug-only network configuration; do not enable general cleartext in a release build.

**Uniswap teammate:** implement your routes in `src/uniswap/routes.ts`. They are mounted at `/uniswap` by `src/app.ts` in the same API; add tests beside your route. Your route code will run in the API process, so do not treat its environment as isolated from ENS database configuration. The health endpoint is scaffolding, not a working quote or execution API. Wallet swaps continue to use the existing app flow until the new route is implemented and validated.

## Issuance gate

The wallet's Primary Passkey signing adapter signs only 32-byte UserOperation hashes; its native ceremony can request a separately supplied challenge. The Android proof handshake, DB claim queue, and worker transaction/reconciliation code have tests and a read-only factory deployment simulation. Actual issuer signing and a live controlled claim remain untested because the owner has not granted `ROLE_REGISTRAR` and has not installed the issuer secret in the private worker. Finish that controlled verification, review the budgets and reserved-label policy, and implement renewal before using issued names as mandatory onboarding identity; see [ENS implementation plan](../docs/plans/ens-onboarding-and-renewal.md).
