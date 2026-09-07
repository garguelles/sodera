# ADR-0005: Base First

**Status:** Superseded for the hackathon by [ADR-0009](0009-ethereum-sepolia-hackathon.md). Extracted from original ADR-005 during the current spec review; production rollout remains unresolved. See [approval provenance](README.md).

The original MVP decision was to target Base before Ethereum mainnet: Base Sepolia for development, Base mainnet for Production V1, and Ethereum Sepolia followed by Ethereum mainnet later. Base was chosen for low transaction costs, a strong ERC-4337 ecosystem, native P-256/RIP-7212-style precompile support at `0x100`, a strong stablecoin ecosystem, and suitability for frequent wallet/launcher interactions.

Ethereum MUST remain an architectural target from day one. The source rationale also cited EIP-7951 standardizing `P256VERIFY` at `0x100` on Ethereum and explicitly targeting P-256 signatures from secure hardware, including Android Keystore.

## Consequences

The historical rollout above is preserved as rationale, not a current delivery instruction. [ADR-0009](0009-ethereum-sepolia-hackathon.md) defers Base and requires Ethereum Sepolia for the testnet-only hackathon; it neither approves mainnet deployment nor selects the eventual production rollout.
