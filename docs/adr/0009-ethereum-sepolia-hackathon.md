# ADR-0009: Ethereum Sepolia Is the Single Required Hackathon Testnet

**Status:** Accepted for the hackathon during the current spec review, as recorded in [hackathon decisions](../hackathon-decisions.md#delivery-scope); technical feasibility remains to be verified. Supersedes [ADR-0005](0005-base-first.md) for hackathon scope only.

For the 10-day, testnet-only hackathon build, Ethereum Sepolia is the single required network for all required flows, replacing the original Base-first sequence. Concentrating the required launcher-wallet and sponsor integrations on one testnet bounds delivery scope: Base is deferred and Arc payments remain stretch, not prerequisites for the required demonstration.

## Consequences

Verify the raw P-256/Kernel execution path, ZeroDev-hosted infrastructure and sponsorship, ENSv2 deployment compatibility, executable Uniswap swaps and testnet liquidity, Morpho deployment and a compatible USDC vault, and live Graph coverage before treating dependent specs as ready. Exact versions and validator selection remain open pending these checks; an agreed target is not a claim that every integration is available or working.

Do not silently switch required flows to Base, Arc, another provider, or mainnet when feasibility checks fail; bring failures back to spec review. [ADR-0006](0006-zerodev-account-abstraction.md) retains the optional Arc infrastructure exception without changing the account framework or signer. This decision neither makes the build production-ready nor resolves production network selection or rollout order.
