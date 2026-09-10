# PRA-185: Android Credential Manager passkey ceremony

Research date: 2026-09-11

## Decision

**PASS for implementing the physical-device proof with AndroidX Credential Manager; FAIL at the current live association boundary and UNKNOWN until the full ceremony is executed on the target device.** Pin both Credential Manager artifacts to stable `1.6.0`, use the existing Expo local-module pattern, require Android 9/API 28 or newer, and use RP ID `sodera.xyz` with Android package `xyz.sodera.app`. The installed debug APK certificate exactly matches the first fingerprint in the live Digital Asset Links file, but the live statement has not yet deployed every relation required by the current Credential Manager prerequisites.

This report distinguishes source-backed requirements from project policy and unexecuted observations:

- **PASS**: established by an official source, repository configuration, or direct retrieval.
- **FAIL**: contradicted by evidence or missing a required prerequisite.
- **UNKNOWN**: needs the installed APK, provider, or physical device.

No source reviewed supports claiming StrongBox, TEE storage, device binding, non-exportability, or a specific provider before collecting device evidence. Credential Manager brokers providers; a passkey may be synced by a provider. Play Integrity is neither part of this ceremony nor an ownership gate.

## Pinned implementation

| Item | Pin | Evidence and status |
| --- | --- | --- |
| Expo | SDK `57`, React Native `0.86`, Android compile/target SDK `36` | **PASS.** The [versioned Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) identifies these versions. The repository pins `expo ~57.0.20` and React Native `0.86.3`. |
| Native harness | Local Expo module plus an Android development build | **PASS.** Expo recommends a [local Expo module](https://docs.expo.dev/modules/get-started/#add-a-new-module-to-an-existing-application) for app-specific native code and requires rebuilding after native-code changes. Expo Go cannot contain this new native bridge; use `pnpm expo run:android --device` or an equivalent signed development build ([development-build guide](https://docs.expo.dev/develop/development-builds/introduction/)). The repository already has the `app/modules/sodera-launcher` local-module pattern. |
| AndroidX | `androidx.credentials:credentials:1.6.0` and `androidx.credentials:credentials-play-services-auth:1.6.0` | **PASS.** AndroidX lists `1.6.0` as the latest stable release and releases both artifacts together ([release notes](https://developer.android.com/jetpack/androidx/releases/credentials#1.6.0)). Do not silently substitute the current `1.7.0-alpha03` documentation sample. The Play services artifact supplies the Google-backed provider path and must use the same version. |
| Minimum passkey OS | Android 9, API 28 | **PASS.** Google's [create-passkey prerequisites](https://developer.android.com/identity/passkeys/create-passkeys#prerequisites) require Android 9/API 28 or newer. Expo itself supports Android 7+, but that broader floor does not make passkeys available below API 28. |
| Target | Nothing A015, Android 16/API 36, Google Play services `26.33.32` | **PASS for installation and platform prerequisites; UNKNOWN for ceremony result.** API 36 satisfies the documented OS floor. The selected provider and screen-lock/UV result remain runtime evidence. |
| RP and app | RP ID `sodera.xyz`; package `xyz.sodera.app` | **PASS.** The package is pinned in `app/app.json`. Google's request format defines `rp.id` as the app domain/subdomain ([create guide](https://developer.android.com/identity/passkeys/create-passkeys#get-options)). |
| Domain association | `https://sodera.xyz/.well-known/assetlinks.json` | **FAIL live; PASS in the repository and rebuilt APK.** Direct retrieval on 2026-09-11 returned HTTP 200 without a redirect, `Content-Type: application/json`, package `xyz.sodera.app`, relation `delegate_permission/common.get_login_creds`, and the installed debug APK's SHA-256 certificate fingerprint. Google's check API reported that one relation as linked, but the current [Credential Manager prerequisites](https://developer.android.com/identity/credential-manager/prerequisites#configure-digital-asset-links) require both `delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds`, plus an app manifest `asset_statements` resource. The repository statement now has both relations, and the rebuilt APK contains the escaped JSON include and manifest metadata; the hosted statement still needs deployment. |

The live DAL fingerprints observed were:

```text
FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
A7:5C:89:C7:74:39:BE:89:3E:5B:BE:25:AE:4B:AE:5A:80:42:3D:E8:82:9B:72:38:37:6D:6E:75:E4:96:81:B0
```

The installed debug APK was verified with Android build tools and has SHA-256 fingerprint `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`, an exact match for the first live entry. Debug, local-development, EAS-development, preview, and production builds can have different certificates; add each intentionally supported certificate as a separate DAL target. A package-name match alone is insufficient.

The app must also declare `<meta-data android:name="asset_statements" android:resource="@string/asset_statements" />`, where the compiled string value is valid JSON including `https://sodera.xyz/.well-known/assetlinks.json`. Android resource source must escape the JSON quotation marks; otherwise AAPT strips them and packages invalid JSON. `app/plugins/with-sodera-passkey.js` owns this generated configuration, and the built APK resource was inspected with `aapt2` rather than inferred from source XML.

### Physical-device association failure

On 2026-09-11, Google Password Manager on the Nothing A015 reached its fingerprint prompt for registration, then Google Play services `ValidateRpIdOperation` failed with `[50152] RP ID cannot be validated`. AndroidX surfaced this as `CreatePublicKeyCredentialDomException` with `TYPE_DATA_ERROR`, and no credential was accepted. This run used the rebuilt APK with valid packaged `asset_statements`, while the live site still exposed only `get_login_creds`. Deploy the two-relation repository statement and repeat the run before changing ceremony code or marking the association PASS.

The canonical Android application ID and root namespace are both `xyz.sodera.app`. Sodera-owned local modules use child namespaces `xyz.sodera.app.launcher` and `xyz.sodera.app.passkey`; `com.pragmacollective.sodera` is not a valid application or module namespace for this repository. The application ID is the value Android, Credential Manager, APK signing checks, and Digital Asset Links bind to. A stale generated `android/` project must be regenerated from `app/app.json`, not trusted over the committed Expo configuration.

## Randomness boundary

Sodera does not generate a wallet private key, passkey private key, seed phrase, or ECDSA signing nonce. Android Credential Manager delegates passkey key generation and every signature to the selected credential provider. Provider entropy quality is outside the app implementation and must not be described as hardware-backed or otherwise stronger than observed evidence.

The app generates only two non-secret registration inputs: a fresh 32-byte challenge and a random 32-byte opaque user handle. Both use `expo-crypto@57.0.2` `getRandomBytesAsync`; no app fallback is permitted. The [Expo SDK 57 API](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/#cryptogetrandombytesasyncbytecount) states that this method uses native random-byte implementations. The pinned Android implementation fills the byte array with `java.security.SecureRandom.nextBytes` ([Expo SDK 57 source](https://github.com/expo/expo/blob/sdk-57/packages/expo-crypto/android/src/main/java/expo/modules/crypto/CryptoModule.kt)). The synchronous `getRandomBytes` API is forbidden here because Expo documents a development-mode `Math.random` fallback when remote debugging; `getRandomBytesAsync` has no such fallback in the pinned source. If native secure randomness is unavailable, registration fails closed.

The authentication challenge is not random. It is the exact 32-byte EntryPoint v0.7 UserOperation hash produced by the existing `createPasskeyChallenge` function, so every operation field, account, EntryPoint, and chain is cryptographically bound to user authorization. Substituting random bytes there would break that binding.

This separation directly addresses the class of failure described in TRM Labs' [Coldcard incident report](https://www.trmlabs.com/resources/blog/the-largest-hardware-wallet-exploit-of-2026-inside-the-usd-116-million-coldcard-hack): a weak software fallback reduced effective secret-generation entropy. Sodera neither generates the signing secret nor permits a weak fallback for its non-secret WebAuthn challenge inputs.

## Native API flow

Instantiate `CredentialManager.create(activityContext)`. Call the suspend APIs from the native module:

1. Registration: construct `CreatePublicKeyCredentialRequest(requestJson)` and call `credentialManager.createCredential(activityContext, request)`.
2. Authentication: construct one `GetPublicKeyCredentialOption(requestJson)`, wrap it in `GetCredentialRequest(listOf(option))`, and call `credentialManager.getCredential(activityContext, request)`.
3. Accept only `CreatePublicKeyCredentialResponse` for registration and `PublicKeyCredential` for authentication. Treat another response type as failure.
4. Return only the standard response JSON and non-sensitive operation metadata across the Expo bridge. Do not implement signing, hold a private key, or export credential-provider material in JavaScript.

These are UI-capable operations. The [`CredentialManager` API](https://developer.android.com/reference/kotlin/androidx/credentials/CredentialManager) requires an activity context so UI launches in the same task stack. Therefore the project policy is stricter than the API surface: start create/get only after an explicit foreground user action and, for an operation assertion, only after Sodera has shown the exact operation and the user has confirmed it. Do not use conditional creation, auto-select, opportunistic/background invocation, or a prepared request as authorization.

The coroutine implementation propagates coroutine cancellation to Android's `CancellationSignal` and ignores callbacks once the continuation is inactive ([AndroidX 1.6.0 `CredentialManager.kt`](https://android.googlesource.com/platform/frameworks/support/+/73c49c625afa14864002e62b7db64050670c0b25/credentials/credentials/src/main/java/androidx/credentials/CredentialManager.kt)). This establishes stale-result rejection in AndroidX, but the official API does not guarantee how quickly every provider dismisses its UI. The bridge additionally assigns an operation ID, cancels on explicit JS cancellation, request supersession, activity destruction, and module destruction, and discards callbacks unless the same operation remains pending. It must not cancel from a generic activity-background or user-leave hook: launching Credential Manager's own provider UI triggers those lifecycle signals. Requests are still initiated only by a foreground user action; leaving and later continuing the provider UI remains the same explicitly initiated ceremony.

## Registration request and response

Use JSON-compatible base64url without padding for binary fields. The minimum selected creation request is:

```json
{
  "challenge": "<fresh registration challenge>",
  "rp": {
    "id": "sodera.xyz",
    "name": "Sodera"
  },
  "user": {
    "id": "<random non-PII stable user handle>",
    "name": "<account label>",
    "displayName": "<display label>"
  },
  "pubKeyCredParams": [
    {
      "type": "public-key",
      "alg": -7
    }
  ],
  "authenticatorSelection": {
    "residentKey": "required",
    "requireResidentKey": true,
    "userVerification": "required"
  },
  "attestation": "none",
  "excludeCredentials": []
}
```

`-7` selects ES256/P-256, which the pinned ZeroDev validator consumes. `residentKey: "required"`, `requireResidentKey: true`, and `userVerification: "required"` follow Google's [creation options](https://developer.android.com/identity/passkeys/create-passkeys#get-options). Leaving `authenticatorAttachment` unspecified is Google's recommendation because it permits the user's preferred passkey device; setting it to `platform` expresses an attachment preference but does not prove device-bound key storage. For this supported-device proof either record the returned `authenticatorAttachment` or explicitly set `platform` and record whether the provider honors it.

On success, `CreatePublicKeyCredentialResponse.registrationResponseJson` represents a WebAuthn registration response containing top-level `id`, `rawId`, `type`, response `clientDataJSON` and `attestationObject`, and applicable authenticator attachment/client-extension fields ([Android create response](https://developer.android.com/identity/passkeys/create-passkeys#handle-response)). Verify and persist the credential ID and P-256 public key needed by the validator path; never persist or log private credential material.

## Assertion request and response

Create the assertion only after operation confirmation. The request must pin exactly the registered Primary Passkey:

```json
{
  "challenge": "<unpadded base64url exact 32-byte UserOperation hash>",
  "rpId": "sodera.xyz",
  "allowCredentials": [
    {
      "type": "public-key",
      "id": "<exact registered credential ID>"
    }
  ],
  "userVerification": "required"
}
```

Do not use an empty `allowCredentials` list for this proof: it permits discoverable-credential selection rather than proving use of the stored Primary Passkey. The fresh challenge must be the exact EntryPoint v0.7 UserOperation hash selected in PRA-184. A changed operation, nonce, gas/paymaster data, EntryPoint, or chain changes that challenge and invalidates an earlier assertion.

For an ordinary Android app, leave `CreateCredentialRequest.origin`, `GetCredentialRequest.origin`, and both `clientDataHash` overrides null. Android automatically sets origin; setting another origin is for privileged callers and on API 34+ requires `CREDENTIAL_MANAGER_SET_ORIGIN` ([get guide](https://developer.android.com/identity/passkeys/sign-in-with-passkeys#create-object), [request API](https://developer.android.com/reference/kotlin/androidx/credentials/GetPublicKeyCredentialOption)).

On success, read `PublicKeyCredential.authenticationResponseJson`. Google's [assertion response schema](https://developer.android.com/identity/passkeys/sign-in-with-passkeys#handle-response) contains top-level `id`, `rawId`, and `type`, plus response fields `clientDataJSON`, `authenticatorData`, `signature`, and `userHandle`; authenticator attachment and extension results may also be present. Before accepting or forwarding it:

- Require returned `id`/`rawId` to decode to the pinned credential ID.
- Decode `clientDataJSON` and require `type == "webauthn.get"` and challenge bytes equal the one pending operation's exact challenge.
- Record and validate the Android native origin. Google specifies `android:apk-key-hash:<unpadded base64url SHA-256 signing-certificate digest>` and says the server must allow-list it ([Android origin derivation](https://developer.android.com/identity/passkeys/create-passkeys#verify)). This value differs from the colon-separated hex fingerprint in DAL.
- Require `authenticatorData` RP ID hash to equal `SHA-256("sodera.xyz")`, and require both UP and UV flag bits. These are relying-party verification steps in [WebAuthn assertion verification](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion).
- Pass the original base64url `authenticatorData`, `clientDataJSON`, and DER `signature` fields to the already pinned `app/src/wallet/kernel-webauthn.ts` bridge. That bridge owns DER parsing, fixed-width `r`/`s`, low-`s` normalization, response-type offset, and the final six-field validator envelope. Do not create a second encoder in the native module.

## Failure mapping

Catch the base `CreateCredentialException` and `GetCredentialException`, map stable subclasses to a small bridge error enum, retain `e.type` and nested DOM error type for redacted diagnostics, and never accept a response from an errored or canceled operation. Android's [troubleshooting table](https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide) and [exception API](https://developer.android.com/reference/kotlin/androidx/credentials/exceptions/package-summary) define the relevant classes.

| Condition | AndroidX class | Bridge result |
| --- | --- | --- |
| User canceled create/get or denied consent | `CreateCredentialCancellationException`, `GetCredentialCancellationException`; some provider paths may surface `*PublicKeyCredentialDomException` with `NotAllowedError` | `canceled`; no retry and no assertion |
| No pinned credential | `NoCredentialException`, or provider-specific public-key DOM error | `noCredential`; no assertion |
| No viable creation/provider option | `CreateCredentialNoCreateOptionException` | `noCreateOption`; no credential |
| Missing provider dependency/configuration | `CreateCredentialProviderConfigurationException`, `GetCredentialProviderConfigurationException` | `providerConfiguration`; no result |
| Device/API unsupported | `CreateCredentialUnsupportedException`, `GetCredentialUnsupportedException` | `unsupported`; no result |
| Retryable interruption | `CreateCredentialInterruptedException`, `GetCredentialInterruptedException` | `interrupted`; no automatic signing retry |
| WebAuthn/DOM failure, including RP/DAL/request problems | `CreatePublicKeyCredentialDomException`, `GetPublicKeyCredentialDomException` and `domError` | `domError`; no result |
| Other provider/platform failure | `CreateCredentialUnknownException`, `GetCredentialUnknownException`, or custom exception | `unknown`; no result |
| Explicitly canceled, activity/module destroyed, operation superseded, or stale callback | Local operation state, possibly without a provider exception | `canceled`/discard; no result |

Do not branch on human-readable messages. AndroidX exposes type strings, but the concrete classes and nested `domError` are safer within the native dependency pin. Examples in AndroidX 1.6.0 include `android.credentials.GetCredentialException.TYPE_NO_CREDENTIAL`, `...TYPE_USER_CANCELED`, and public-key DOM prefixes `androidx.credentials.TYPE_GET_PUBLIC_KEY_CREDENTIAL_DOM_EXCEPTION` / `TYPE_CREATE_PUBLIC_KEY_CREDENTIAL_DOM_EXCEPTION` ([official exception API](https://developer.android.com/reference/kotlin/androidx/credentials/exceptions/package-summary), [pinned AndroidX source](https://android.googlesource.com/platform/frameworks/support/+/73c49c625afa14864002e62b7db64050670c0b25/credentials/credentials/src/main/java/androidx/credentials/exceptions/)).

There is no documented Credential Manager exception dedicated to biometric lockout. Record the actual class, `e.type`, DOM type, provider, message category, and UI outcome on the target device, while mapping every such outcome to no accepted assertion.

## Verification boundary

### Unit and integration tests without a physical authenticator

- Creation/get JSON contains RP ID, ES256, required resident credential, required UV, and exactly one allowed credential for get.
- Challenges and IDs use unpadded base64url and decode to expected bytes.
- Response parser rejects wrong type, challenge, credential ID, RP ID hash, missing UP/UV, malformed base64url, malformed JSON, and absent fields.
- Exception classes map to the bridge enum; unknown subclasses fail closed.
- Explicit cancellation, supersession, destruction, duplicate callbacks, and callbacks with stale operation IDs cannot resolve a successful assertion.
- Existing PRA-184 tests cover DER parsing, fixed-width `r/s`, low-`s`, challenge construction, and final ZeroDev validator encoding. Reuse those fixtures rather than duplicating cryptographic logic.

Mocked tests prove application policy and parsing only. They do not prove provider availability, real UV, credential storage, Android origin construction, DAL acceptance, or that the credential provider generated the signature.

### Required physical-device evidence

Run on the Nothing A015 development build and record, without secrets:

1. Device model, Android/API version, Credential Manager library pin, selected provider/package/version, screen-lock methods offered, app package, installed APK certificate SHA-256, matching DAL entry, RP ID, and timestamp.
2. Registration after explicit consent: returned credential ID hash, public-key coordinates, response type, attachment value if returned, decoded client-data type/challenge/origin, RP ID hash, UP/UV flags, AAGUID, and whether the server/validator registration path accepted it. Do not log raw user handle, account label, biometric data, or any private material.
3. A later explicit operation confirmation followed by assertion using the one-entry `allowCredentials`: response credential ID hash, decoded type/challenge/origin, RP ID hash, flags, sign counter, DER shape, normalized `r/s`, final validator-envelope hash, and released ZeroDev verifier positive result.
4. Negative runs: user cancellation at provider and UV prompts, repeated failed UV/lockout, missing/deleted credential, unavailable/disabled provider, changed challenge/operation, and app backgrounding while the request is pending. Every run must produce no accepted assertion; record exact exception class/type/DOM type and whether provider UI remained visible after cancellation.
5. Repeat a valid assertion through PRA-184's negative vectors where applicable: wrong credential/public key, challenge, account, chain, EntryPoint, nonce/calls, absent UV, malformed signature, and stale/replayed operation.

Evidence may establish that Google Password Manager was the provider and that this device performed UV. It still must not be generalized into StrongBox, TEE, device-bound, or non-exportable claims without separate attestation/provider evidence. Google-free GrapheneOS is deferred; do not infer support from AndroidX's API floor.

## Implementation conclusion

The minimal implementation is one Android-only Expo local module that owns Credential Manager calls, activity/foreground/cancellation state, exception mapping, and raw response transfer. JavaScript owns explicit operation confirmation and supplies fresh request JSON; the existing Kernel WebAuthn bridge owns all assertion validation and validator-envelope construction. No Turnkey API, remotely managed signer, Android Keystore signing API, private-key export, backend signer, or Play Integrity decision belongs in this path.

PRA-185 remains **FAIL** at the live association boundary and **UNKNOWN** as a ceremony proof until the corrected statement is deployed and the physical-device matrix is captured. The installed development certificate matches the hosted DAL fingerprint, but the earlier Google check established only the single relation queried and did not establish the complete Credential Manager prerequisite set.
