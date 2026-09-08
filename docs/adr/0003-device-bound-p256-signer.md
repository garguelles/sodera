# ADR-0003: Raw Android Keystore P-256 as Primary Signer

**Status:** Superseded for the hackathon by [ADR-0010](0010-direct-kernel-passkey.md); retained as historical context. See [approval provenance](README.md).

The primary wallet signer MUST be a device-bound, non-exportable P-256 / secp256r1 private key created through Android Keystore. The original policy preferred StrongBox, then hardware-backed TEE / KeyMint, with software-backed Keystore as a policy-dependent fallback: hardware backing SHOULD be used whenever available, while software-backed keys MAY be allowed for development and potentially unsupported devices, provided production UI clearly distinguishes reduced-security devices.

## Consequences

The raw-P256 Kernel investigation found no path that was simultaneously current, released, audited, SDK-supported, and provenance-backed on Sepolia. The hackathon therefore uses the released ZeroDev WebAuthn validator and a platform passkey instead of a directly managed Android Keystore key. Device-bound StrongBox/TEE signing remains a possible post-hackathon architecture, not a current compatibility claim.
