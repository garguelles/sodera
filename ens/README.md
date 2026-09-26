# ENS namespace owner tool

Standalone local Vite app for reviewing the `sodera.eth` ENSv2 Sepolia namespace setup in MetaMask. This tool is separate from the Expo wallet (`app/`) and public passkey landing site (`landing/`). It does not hold or request a private key and does not submit transactions on connection.

## Run locally

From `ens/`:

```bash
pnpm install
cp .env.example .env.local
pnpm verify:namespace
pnpm dev
```

Open the local URL shown by Vite (normally `http://127.0.0.1:5173/`) in a browser with the MetaMask extension. Select Ethereum Sepolia and the owner account `0x7Ed08e45067d7Bb1c064055eC99aCD6586453915`. The [registry setup transactions](../docs/research/ensv2-sepolia-namespace-check.md#mounted-child-registry) and issuer grant are complete; the page displays all four as verified. It does not issue user names.

`pnpm verify:namespace` checks current parent ownership, expiry and namespace state without writing. `pnpm prepare:registry` was the pre-deployment preflight; it now intentionally refuses to generate deployment calldata because the child is already mounted. Scripts load `SEPOLIA_RPC_URL` from `.env.local`; the browser uses the Sepolia RPC selected in MetaMask.

## Dedicated issuer account

The owner designated `0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0` as the second Sepolia issuer account. Its **public address** is in `.env.example`; the signing key is not in this repo. Run `pnpm verify:issuer` to check the pinned child and parent, roles, account type and balance. After funding it with 0.1 Sepolia ETH, the owner [granted only `ROLE_REGISTRAR`](https://eth-sepolia.blockscout.com/tx/0x433cf5ee9a88d4d30f023e5057ba9a6cb4b27c29eaf06a6625ccf0ec057c37e6); root issuer roles read as `0x1`. A separate [controlled Android claim](../docs/research/ensv2-sepolia-namespace-check.md#controlled-user-claim) has since confirmed a user-owned subname and resolver on Sepolia.

The `agent/` service is deliberately keyless and must remain so. The combined public `api/` process also must not hold the issuer key: ENS registration uses a **private issuer-signing worker** with its own environment/secret storage and bounded claim policy, even if it shares Railway infrastructure. Do not place that key in `app/`, `landing/`, `ens/`, the public API or agent environments, git, or chat. The issuer holds only root `ROLE_REGISTRAR`; a wider production budget requires separate review.

`pnpm prepare:issuer-grant` was the **read-only** owner preflight used before that grant. It requires issuer roles to be zero, so it intentionally refuses to propose a duplicate grant on the current namespace. ENSv2 Sepolia is an evolving beta deployment; continue to check roles with `pnpm verify:issuer`.

The local MetaMask owner page shows this as the **fourth** transaction after the three namespace steps. It rechecks the official implementation, current roles and child mount, and now displays the grant as verified. `pnpm verify:issuer` confirms `rootRoles: 0x1` and `registrarGranted: true`.

This app is intended to run on localhost, not as the production `sodera.xyz` landing site. Its Vite dev server binds to `127.0.0.1` by default. Registry deployment does not issue user names or enable renewal. The complete owner sequence and gates are in [the namespace check](../docs/research/ensv2-sepolia-namespace-check.md#reviewed-owner-setup).
