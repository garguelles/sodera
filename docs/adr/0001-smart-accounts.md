# ADR-0001: Smart Accounts Instead of EOAs

**Status:** Accepted; extracted from original ADR-001 during the current spec review. See [approval provenance](README.md).

The primary wallet MUST be a ZeroDev Kernel smart contract account using ERC-4337, rather than a traditional secp256k1 externally owned account (EOA). This enables P-256 validation, signer rotation, recovery without seed phrases, multiple authorized devices, future permission/session keys, batched transactions, gas sponsorship, and custom security policies.

## Consequences

These capabilities explain the architecture, not the hackathon feature list: [current scope](../hackathon-decisions.md) requires passkey recovery, leaves a second Android recovery device as stretch, and does not require every future account capability.
