# Sodera API

Two isolated service entrypoints in one Hono project. Deploy them as **separate Railway services** using this directory and the same Dockerfile, with distinct environment variables and credentials:

| `API_SERVICE` | Purpose | Current endpoints |
| --- | --- | --- |
| `ens` | ENS namespace reads; future bounded name issuance | `GET /healthz`, `GET /ens/availability/:label` |
| `uniswap` | Teammate-owned Uniswap API | `GET /healthz`, `GET /uniswap/healthz` |

`agent/` remains the separate, keyless AI planning service. The Uniswap entrypoint imports no ENS module and must never receive the issuer wallet's signing key. When registration is implemented, **only the ENS deployment** will receive its private signer configuration. Do not put secrets in `EXPO_PUBLIC_*`, the local `ens/` owner tool, git, or the `agent/` planner environment.

The designated issuer **public address** is `0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0`. It now holds 0.1 Sepolia ETH but has no registrar grant. Its private key is not needed for the current read-only API and must not be placed in this project's `.env` until a separately deployed ENS signer process and claim policy are ready.

## Development

From `api/`:

```bash
pnpm install
cp .env.example .env
pnpm dev:ens
```

In another terminal, set `PORT=8081` and run `pnpm dev:uniswap` from `api/`. `pnpm typecheck`, `pnpm test`, and `pnpm build` verify both services. For a production deployment, set `API_SERVICE=ens` or `API_SERVICE=uniswap`, `PORT` from Railway, and use `pnpm start` (or the Dockerfile). Only the ENS service needs `SEPOLIA_RPC_URL`.

The ENS availability endpoint applies the app's canonical username policy, distinguishes product-reserved from chain-reserved/registered labels, verifies the current ENSv2 hierarchy and implementation on Sepolia, and reports whether the parent has at least one year left. It returns `503` when the hierarchy/RPC cannot be verified. It does not mint names, hold a signer, or expose a claim endpoint yet.

**Uniswap teammate:** implement your routes in `src/uniswap/routes.ts`. They are mounted at `/uniswap` by `src/uniswap/app.ts`; add tests beside your route and keep chain/RPC/API credentials in the Uniswap deployment only. The health endpoint is scaffolding, not a working quote or execution API. Wallet swaps continue to use the existing app flow until the new API is implemented and validated.

## Issuance gate

The mobile wallet's current Primary Passkey signing adapter signs only 32-byte UserOperation hashes; its native ceremony can request a separately supplied challenge. `src/ens/kernel-proof.ts` and `src/ens/webauthn-proof.ts` now verify a deployed Kernel's pinned implementation/root validator and a user-verified WebAuthn assertion against its on-chain P-256 key, Sodera RP ID, approved Android origins, and an exact 32-byte challenge. These helpers have cryptographic tests and a live validator-key read against an existing Sodera Kernel; they are **not** yet a public authentication flow.

The future ENS claim API must issue short-lived, single-use challenges bound to chain/account/label, durably consume them, and prove the requesting installation controls the same Kernel. After that, issuance still requires durable idempotency, one-name-per-Kernel product policy, abuse limits and a global budget, per-Kernel resolver provisioning, safe retries, and independent on-chain ownership/resolution checks. Granting `ROLE_REGISTRAR` to a service key happens **after** these gates; see [ENS implementation plan](../docs/plans/ens-onboarding-and-renewal.md).
