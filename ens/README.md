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

Open the local URL shown by Vite (normally `http://127.0.0.1:5173/`) in a browser with the MetaMask extension. Select Ethereum Sepolia and the owner account `0x7Ed08e45067d7Bb1c064055eC99aCD6586453915`. The [registry setup transactions](../docs/research/ensv2-sepolia-namespace-check.md#mounted-child-registry) are already complete; the page now displays all three as verified. It does not issue user names.

`pnpm verify:namespace` checks current parent ownership, expiry and namespace state without writing. `pnpm prepare:registry` was the pre-deployment preflight; it now intentionally refuses to generate deployment calldata because the child is already mounted. Scripts load `SEPOLIA_RPC_URL` from `.env.local`; the browser uses the Sepolia RPC selected in MetaMask.

## Dedicated issuer account

The owner designated `0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0` as the second Sepolia issuer account. Its **public address** is in `.env.example`; the signing key is not in this repo. Run `pnpm verify:issuer` to check the pinned child and parent, roles, account type and balance. After an initial zero-balance check, the owner funded it with 0.1 Sepolia ETH; no registrar role was granted. This does not prove possession of the issuer's private key.

The new `agent/` service is deliberately keyless and must remain so. The combined public `api/` process also must not hold the issuer key: ENS registration will call a **private issuer-signing worker** with its own environment/secret storage and bounded claim policy, even if it shares Railway infrastructure. Do not place that key in `app/`, `landing/`, `ens/`, the public API or agent environments, git, or chat. We will not grant `ROLE_REGISTRAR` until the isolated issuer worker and its authorization, budget, retry and audit checks are implemented and verified.

`pnpm prepare:issuer-grant` is a **read-only** owner preflight. It checks the mounted registry, current owner and issuer roles, and simulates granting only root `ROLE_REGISTRAR` from the owner wallet. Its calldata is not a transaction submission; review the Railway hackathon worker mode and separate signing environment before signing anything in MetaMask. Re-run it immediately before any owner authorization because ENSv2 Sepolia is an evolving beta deployment.

This app is intended to run on localhost, not as the production `sodera.xyz` landing site. Its Vite dev server binds to `127.0.0.1` by default. Registry deployment does not issue user names or enable renewal. The complete owner sequence and gates are in [the namespace check](../docs/research/ensv2-sepolia-namespace-check.md#reviewed-owner-setup).
