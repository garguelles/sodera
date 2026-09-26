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

This app is intended to run on localhost, not as the production `sodera.xyz` landing site. Its Vite dev server binds to `127.0.0.1` by default. Registry deployment does not issue user names or enable renewal. The complete owner sequence and gates are in [the namespace check](../docs/research/ensv2-sepolia-namespace-check.md#reviewed-owner-setup).
