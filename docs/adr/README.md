# Architecture Decision Records

Records 0001-0008 extract the original embedded ADR-001 through ADR-008 from [sodera.md section 2](../sodera.md#2-locked-architecture-decisions), preserving their numbering correspondence and historical rationale. The source called these decisions locked but supplied no approval dates; extraction and current scope clarifications were approved during the current spec review, as recorded in [hackathon decisions](../hackathon-decisions.md), not on an inferred historical date. ADR-0010 records the later passkey pivot after PRA-184 found no supportable released raw-P256 Kernel path.

The [hackathon decisions](../hackathon-decisions.md) and [hackathon specs index](../hackathon-specs.md) take precedence over conflicting v0.5 source requirements for the hackathon. Acceptance here records a decision, not verified implementation or production readiness.

| Original ID | Standalone Record | Status / Scope |
| --- | --- | --- |
| ADR-001 | [ADR-0001: Smart accounts instead of EOAs](0001-smart-accounts.md) | Retained |
| ADR-002 | [ADR-0002: No default seed phrase](0002-no-default-seed-phrase.md) | Retained |
| ADR-003 | [ADR-0003: Device-bound P-256 signer](0003-device-bound-p256-signer.md) | Superseded for hackathon by ADR-0010 |
| ADR-004 | [ADR-0004: Biometrics authorize signing](0004-biometrics-authorize-signing.md) | Keystore flow superseded for hackathon; biometrics-are-not-keys principle retained |
| ADR-005 | [ADR-0005: Base first](0005-base-first.md) | Superseded for hackathon by ADR-0009; production rollout unresolved |
| ADR-006 | [ADR-0006: ZeroDev account abstraction](0006-zerodev-account-abstraction.md) | Retained; Sepolia requirement and optional Arc infrastructure exception clarified |
| ADR-007 | [ADR-0007: No required Google services](0007-no-required-google-services.md) | Deferred for hackathon; retained as post-hackathon goal |
| ADR-008 | [ADR-0008: Play Integrity cannot gate assets](0008-play-integrity-cannot-gate-assets.md) | Retained |
| New during spec review | [ADR-0009: Ethereum Sepolia as the single required hackathon testnet](0009-ethereum-sepolia-hackathon.md) | Accepted for hackathon; feasibility checks pending |
| Post-investigation pivot | [ADR-0010: Platform passkey directly authorizes Kernel](0010-direct-kernel-passkey.md) | Accepted for hackathon; selected path verification remains in progress |
