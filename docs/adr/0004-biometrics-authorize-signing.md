# ADR-0004: Biometrics Authorize Signing; They Are Not Keys

**Status:** Accepted; extracted from original ADR-004 during the current spec review. See [approval provenance](README.md).

Fingerprint or face data MUST NOT be treated as cryptographic key material. Biometric authentication authorizes a cryptographic operation with the Keystore-held P-256 key: BiometricPrompt -> authorized key use -> signature, never fingerprint -> private key.

## Consequences

The [current hackathon authorization policy](../hackathon-decisions.md#signing-authorization) prefers strong biometrics and permits device PIN, pattern, or password as a fallback after explicit review and confirmation. Neither authentication route may bypass key-use authorization, export key material, or permit silent background signing; supported device configurations require verification and production authentication policy remains separate.
