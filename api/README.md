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

1. `POST /ens/challenges` with `{ "account": "0x…", "label": "gargs" }` checks live name availability and a deployed Kernel, then returns a 32-byte base64url `challenge`, UUID `id`, name, chain ID, and a five-minute expiry. The database serializes issuance and caps requests at 5/account, 30/IP hash, and 500 total per hour.
2. The mobile app invokes the pinned Primary Passkey with that challenge. `POST /ens/challenges/{id}/verify` takes `{ "account": "0x…", "label": "gargs", "proof": { "authenticatorData": "…", "clientDataJSON": "…", "signature": "…" } }`. The server **atomically consumes** the stored challenge bound to chain, registry, account and label before checking the signed assertion against the Kernel's current on-chain validator key. A valid result returns a ten-minute opaque `claimToken`; the database stores only its hash. A failed or replayed assertion cannot reuse the challenge.

There is **no registration route** or claim-token redemption yet. The token must not be logged or displayed; its future consumer must atomically redeem the stored hash after rechecking chain state. The optional manual diagnostic in `app/src/components/passkey-proof-screen.tsx` requires `EXPO_PUBLIC_API_URL` set to the API's **HTTPS** URL (or loopback HTTP in a debug build), a deployed Kernel, and a supported Android Primary Passkey. It reports verification only, never an issued name. A controlled live backend check used the explicitly synthetic public test key from [PRA-184](../docs/research/PRA-184-kernel-webauthn-validator.md); that is not a physical Android proof or a claim-eligibility credential for public onboarding.

### USB Android proof test without Railway

With a connected Android **debug** build and the Podman stack running, forward the API to the device with `adb reverse tcp:8082 tcp:8082`. Start the app's Metro server with `EXPO_PUBLIC_API_URL=http://127.0.0.1:8082` (the client allows cleartext only for loopback in development). The app's existing `sodera://passkey-proof` diagnostic offers an ENS proof action once the Kernel has deployed. Choose an available test label and confirm the screen says the passkey was verified **without issuing a name**. Restart Metro after changing the Expo environment variable. See the [app's device steps](../app/README.md#local-ens-passkey-proof). If Android's installed debug build blocks loopback cleartext, rebuild that development client with a debug-only network configuration; do not enable general cleartext in a release build.

**Uniswap teammate:** implement your routes in `src/uniswap/routes.ts`. They are mounted at `/uniswap` by `src/app.ts` in the same API; add tests beside your route. Your route code will run in the API process, so do not treat its environment as isolated from ENS database configuration. The health endpoint is scaffolding, not a working quote or execution API. Wallet swaps continue to use the existing app flow until the new route is implemented and validated.

## Issuance gate

The wallet's Primary Passkey signing adapter signs only 32-byte UserOperation hashes; its native ceremony can request a separately supplied challenge. The server verifier and durable one-time handshake are implemented. Before it can authorize **registration**, prove the complete flow on a physical supported Android device, bind the future claim-token consumer to the same account and label, and implement durable one-name-per-Kernel state, registration and sponsorship budgets, per-Kernel resolver provisioning, safe retries, and independent on-chain ownership/resolution checks. Keep synthetic publicly known test credentials out of real public issuance. Grant `ROLE_REGISTRAR` to the issuer key **after** these gates; see [ENS implementation plan](../docs/plans/ens-onboarding-and-renewal.md).
