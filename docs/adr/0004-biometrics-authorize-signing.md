# ADR-0004: Biometrics Authorize Signing; They Are Not Keys

**Status:** Superseded for the hackathon by [ADR-0010](0010-direct-kernel-passkey.md); the principle that biometrics are not keys remains accepted. See [approval provenance](README.md).

Fingerprint or face data MUST NOT be treated as cryptographic key material. Biometric authentication authorizes a cryptographic operation with the Keystore-held P-256 key: BiometricPrompt -> authorized key use -> signature, never fingerprint -> private key.

## Consequences

The current hackathon authorization policy requires WebAuthn user verification after explicit operation review and confirmation. The credential provider controls its supported biometric or device-credential methods. Neither authentication route may permit silent background signing; supported platform configurations require verification and production authentication policy remains separate.
