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
The persistent on-chain wallet holding the user's assets and governing who may authorize operations. Its address remains the same when a device signer is replaced through recovery.
_Avoid_: Device signer, installation, user account

**Wallet Identity**:
The persistent identity of the smart account, identified by its address and presented through its Sodera username. It is distinct from the phone, the credentials controlling the wallet, and the authentication authorizing their use.
_Avoid_: Device identity, biometric identity, signing key

**Username**:
The wallet's single human-readable Sodera name, expressed as `<username>.sodera.eth` and owned by the smart account. The hackathon's one-name model excludes in-app username changes and multiple names per wallet without removing on-chain name ownership or transfer rights.
_Avoid_: Login, device name, wallet credential

**Device Signer**:
The replaceable, device-bound cryptographic credential authorized to control the smart account from a phone. It is not the wallet identity and is distinct from a recovery credential.
_Avoid_: Wallet, biometric key, recovery credential

**Recovery Credential**:
An independently accessible credential enrolled to restore control of the existing smart account when the original device signer is lost. A credential accessible only on the lost phone is not an independent recovery credential.
_Avoid_: Backup of the device key, wallet identity

**Biometric Authorization**:
The user's fingerprint or face authentication authorizing use of the device signer, not cryptographic key material or proof of a separately verified human identity.
_Avoid_: Biometric key, fingerprint wallet, wallet identity

**Device Credential Authorization**:
Authentication using the phone's PIN, pattern, or password to authorize device-signer use as an alternative to biometrics. It is not a wallet password or a recovery credential.
_Avoid_: Wallet password, recovery credential

**Recovery**:
Restoration of control over the same smart account and username by authorizing a replacement device signer and revoking the lost signer's authority. It is not reconstruction of the old private key or creation of a new wallet.
_Avoid_: Key restoration, new wallet
