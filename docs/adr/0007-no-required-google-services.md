# ADR-0007: Core Wallet Cannot Require Google Services

**Status:** Deferred for the hackathon by [ADR-0010](0010-direct-kernel-passkey.md); retained as a post-hackathon goal. See [approval provenance](README.md).

The core launcher and wallet MUST work without Google Play Services, Play Integrity, Google Password Manager, Firebase Authentication, or Google Sign-In because GrapheneOS is a first-class development and personal-use target. Google services MAY support optional functionality when available, but MUST NOT enter the wallet ownership or signing trust path.

## Consequences

The hackathon's selected released passkey path may require Google Play services on Android, so Google-free GrapheneOS acceptance is deferred. Play Integrity still cannot gate wallet ownership or asset access, and the longer-term Google-free goal is unchanged. Third-party credential-provider compatibility requires separate verification.
