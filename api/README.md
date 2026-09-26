# Sodera API

Two isolated service entrypoints in one Hono project. Deploy them as **separate Railway services** using this directory and the same Dockerfile, with distinct environment variables and credentials:

| `API_SERVICE` | Purpose | Current endpoints |
| --- | --- | --- |
| `ens` | ENS namespace reads; future bounded name issuance | `GET /healthz`, `GET /ens/availability/:label` |
| `uniswap` | Teammate-owned Uniswap API | `GET /healthz`, `GET /uniswap/healthz` |

`agent/` remains the separate, keyless AI planning service. The Uniswap entrypoint imports no ENS module and must never receive the issuer wallet's signing key. When registration is implemented, **only the ENS deployment** will receive its private signer configuration. Do not put secrets in `EXPO_PUBLIC_*`, the local `ens/` owner tool, git, or the `agent/` planner environment.

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

The mobile wallet's current Primary Passkey adapter signs only 32-byte UserOperation hashes. The future ENS claim API must prove the requester controls the deployed Kernel without trusting a supplied address or the public `agent/` bearer token. A compatible challenge/response proof (for example a WebAuthn assertion verified against the Kernel's on-chain validator key, RP and origin) must be implemented and tested first. After that, issuance still requires durable idempotency, one-name-per-Kernel product policy, abuse limits and a global budget, per-Kernel resolver provisioning, safe retries, and independent on-chain ownership/resolution checks. Granting `ROLE_REGISTRAR` to a service key happens **after** these gates; see [ENS implementation plan](../docs/plans/ens-onboarding-and-renewal.md).
