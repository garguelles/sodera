# ADR-0003: Raw Android Keystore P-256 as Primary Signer

**Status:** Accepted with the hackathon scope clarification below; extracted from original ADR-003 during the current spec review. See [approval provenance](README.md).

The primary wallet signer MUST be a device-bound, non-exportable P-256 / secp256r1 private key created through Android Keystore. The original policy preferred StrongBox, then hardware-backed TEE / KeyMint, with software-backed Keystore as a policy-dependent fallback: hardware backing SHOULD be used whenever available, while software-backed keys MAY be allowed for development and potentially unsupported devices, provided production UI clearly distinguishes reduced-security devices.

## Consequences

The [current spec review's hardware-only hackathon requirement](../hackathon-decisions.md#signing-authorization) explicitly supersedes that historical software-fallback permission for the hackathon wallet: require hardware-backed Keystore, prefer StrongBox, and fall back only to hardware-backed TEE. Software-only devices receive an incompatibility message noting possible future support; do not create a software-backed signer. This scoped decision does not resolve the eventual production policy for unsupported devices.
