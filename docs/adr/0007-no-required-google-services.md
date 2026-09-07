# ADR-0007: Core Wallet Cannot Require Google Services

**Status:** Accepted; extracted from original ADR-007 during the current spec review. See [approval provenance](README.md).

The core launcher and wallet MUST work without Google Play Services, Play Integrity, Google Password Manager, Firebase Authentication, or Google Sign-In because GrapheneOS is a first-class development and personal-use target. Google services MAY support optional functionality when available, but MUST NOT enter the wallet ownership or signing trust path.

## Consequences

The [required hackathon recovery flow](../hackathon-decisions.md#onboarding-and-recovery) must also work without Google services and after loss of the original phone. Third-party recovery-provider compatibility still requires verification; this decision is not evidence that it already works.
