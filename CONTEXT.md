# Sodera

Sodera combines an Android launcher with a non-custodial wallet and a human-readable wallet identity. Its hackathon domain model is one phone -> one installation -> one wallet user -> one smart account -> one username.

## Language

**Phone**:
The physical Android device hosting a Sodera installation, not the wallet itself or a permanent identity.
_Avoid_: Wallet, account

**Installation**:
The local Sodera instance on a phone, associated with exactly one wallet user and one wallet in the hackathon model. A fresh installation may create a wallet or recover an existing one; recovery does not create an additional wallet.
_Avoid_: User identity, wallet identity

**Wallet User**:
The user associated with an installation and its single smart account, not a separately verified human identity. This installation-scoped meaning does not assert that a human can own only one wallet globally.
_Avoid_: Verified person, login account

**Smart Account**:
The persistent on-chain wallet holding the user's assets and governing which credentials may authorize operations. Its address remains the same when a primary passkey is replaced through recovery.
_Avoid_: Passkey, installation, user account

**Wallet Identity**:
The persistent identity of the smart account, identified by its address and presented through its Sodera username. It is distinct from the phone, the credentials controlling the wallet, and the authentication authorizing their use.
_Avoid_: Device identity, biometric identity, signing key

**Username**:
The wallet's single human-readable Sodera name, expressed as `<username>.sodera.eth` and owned by the smart account. The hackathon's one-name model excludes in-app username changes and multiple names per wallet without removing on-chain name ownership or transfer rights.
_Avoid_: Login, device name, wallet credential

**Primary Passkey**:
The user-controlled platform WebAuthn credential installed as the smart account's primary Kernel authority. It directly authorizes the smart account through an on-chain WebAuthn validator; it is not a remotely managed wallet key, the wallet identity, or the recovery passkey.
_Avoid_: Wallet, Turnkey wallet, biometric key, recovery passkey

**Recovery Passkey**:
An independently accessible platform WebAuthn credential enrolled as separate recovery authority for the existing smart account. A copy of the primary passkey or a credential accessible only on the lost phone is not an independent recovery passkey.
_Avoid_: Primary-passkey backup, wallet identity

**User Verification**:
The authenticator ceremony that verifies the user through biometrics, PIN, pattern, password, or another supported method before using a passkey. It is not cryptographic key material or proof of a separately verified human identity.
_Avoid_: Biometric key, fingerprint wallet, wallet identity

**Credential Provider**:
The platform facility that creates, stores, discovers, and uses a passkey. It may synchronize passkeys according to its own security model, but it is not permitted to hold a separate wallet-signing key or replace Kernel's on-chain authority.
_Avoid_: Wallet custodian, smart account, validator

**Recovery**:
Restoration of control over the same smart account and username using the independently enrolled recovery passkey, followed by authorization of a replacement primary passkey and revocation of the lost primary passkey. It is not restoration of the old private key, synchronized discovery of the primary passkey alone, or creation of a new wallet.
_Avoid_: Key restoration, new wallet
