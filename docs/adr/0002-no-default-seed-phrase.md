# ADR-0002: No Seed Phrase in the Default Wallet Architecture

**Status:** Accepted; extracted from original ADR-002 during the current spec review. See [approval provenance](README.md).

Normal wallet creation MUST NOT generate or display a BIP-39 mnemonic. Recovery changes authorized smart-account passkeys rather than reconstructing an EOA private key, allowing loss of a phone without loss of the wallet when an independent recovery passkey has been configured.

## Consequences

Recovery is not automatic: the [current hackathon policy](../hackathon-decisions.md#onboarding-and-recovery) requires an implemented passkey recovery feature but permits skipping enrollment. Users must be warned that losing the device without configured recovery can permanently lose wallet access.
