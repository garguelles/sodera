# ADR-0010: Platform Passkey Directly Authorizes Kernel

**Status:** Accepted for the hackathon after the rejected raw-P256 investigation. Verification of the selected released WebAuthn path remains in progress under PRA-184.

The hackathon wallet MUST use a user-controlled platform WebAuthn passkey as the primary authority through ZeroDev's released Kernel WebAuthn validator. This replaces the raw Android Keystore P-256 root because no candidate was simultaneously current, released, audited, SDK-supported, and provenance-backed on Sepolia; it also avoids the unacceptable alternative in which a passkey merely authenticates to Turnkey or another remotely managed wallet signer.

## Consequences

The exact released SDK, WebAuthn key package, Kernel, EntryPoint, factory, validator version/address, WebAuthn envelope, RP configuration, and Sepolia deployment MUST be pinned and proven before integrated execution. Source and deployed bytecode/configuration provenance must be verified rather than inferred from SDK defaults or support lists. The platform credential provider controls key storage, synchronization, and user-verification behavior, so Sodera does not claim StrongBox, hardware-backed TEE, device binding, or non-exportability without separate evidence. Google-free GrapheneOS support is deferred for the hackathon, while Play Integrity remains prohibited from gating wallet ownership or asset access.

The primary passkey and recovery passkey remain separate authorities. Recovery uses an independently accessible enrolled passkey to authorize a replacement primary passkey and revoke the lost one on the same smart account. Synchronized rediscovery of the primary passkey may restore access but is not evidence that this independent recovery flow works.
