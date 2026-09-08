# ADR-0006: ZeroDev Is the Primary Account-Abstraction Provider

**Status:** Accepted with hackathon infrastructure scope clarified during the current spec review; extracted from original ADR-006. See [approval provenance](README.md).

Use ZeroDev for Kernel smart accounts, the ERC-4337 account/client SDK, Bundler infrastructure, Paymaster infrastructure, and the released WebAuthn validator integration. The platform passkey directly authorizes Kernel; Turnkey or another remotely managed wallet key MUST NOT become the wallet signer. Retain internal interfaces around Bundler and Paymaster access so another ERC-4337 provider can be added without restructuring the application; the original alternatives, Pimlico or self-hosted infrastructure, were possibilities for later rather than MVP requirements.

## Consequences

Under the [current hackathon decisions](../hackathon-decisions.md#delivery-scope) and [ADR-0009](0009-ethereum-sepolia-hackathon.md), ZeroDev-hosted Bundler and Paymaster infrastructure are the required Ethereum Sepolia target, pending feasibility verification. Missing support is not permission to silently substitute a provider or network.

Arc remains optional stretch. Preserve the source's infrastructure-only exception: prefer ZeroDev-hosted infrastructure if available on Arc; otherwise an Arc-compatible ERC-4337 Bundler/Paymaster may be used while retaining ZeroDev Kernel, the ZeroDev SDK, and the Primary Passkey authority. Do not replace Kernel or introduce another ownership model to satisfy Arc; this exception does not relax the required Sepolia provider target.
