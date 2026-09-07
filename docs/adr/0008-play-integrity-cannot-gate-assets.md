# ADR-0008: Play Integrity Is Never Required to Access Assets

**Status:** Accepted; extracted from original ADR-008 during the current spec review. See [approval provenance](README.md).

Play Integrity MUST NOT gate wallet creation, wallet access, transaction signing, recovery, signer rotation, or viewing the smart-account address. A failed or unavailable result MUST NOT make user funds inaccessible; Play Integrity MAY later be one optional anti-abuse signal for services such as free gas sponsorship, separating service eligibility from asset access.

## Consequences

The [hackathon sponsorship policy](../hackathon-decisions.md#gas-sponsorship-rules) likewise separates sponsorship eligibility from wallet ownership and access. Unavailable sponsorship preserves wallet access and offers self-funded gas where supported; changed fees require renewed review and confirmation.
