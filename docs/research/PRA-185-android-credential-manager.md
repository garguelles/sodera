# PRA-185: Android Credential Manager passkey ceremony

Research date: 2026-09-11

## Decision

**PASS for the scoped physical-device proof with AndroidX Credential Manager and the released ZeroDev validator.** Both Credential Manager artifacts are pinned to stable `1.6.0`, the native bridge follows the existing Expo local-module pattern, and the passkey path requires Android 9/API 28 or newer. On the Nothing A015, RP ID `sodera.xyz` and Android package `xyz.sodera.app` completed registration and credential-pinned authentication through Google Password Manager. The genuine assertion passed local P-256 verification and the released Sepolia validator; the same envelope was rejected for a changed operation hash.

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
| Target | Nothing A015, Android 16/API 36, Google Play services `26.33.32` | **PASS for the scoped ceremony.** Google Password Manager supplied the credential and the device performed fingerprint UV. This does not establish behavior on other devices or providers. |
| RP and app | RP ID `sodera.xyz`; package `xyz.sodera.app` | **PASS.** The package is pinned in `app/app.json`. Google's request format defines `rp.id` as the app domain/subdomain ([create guide](https://developer.android.com/identity/passkeys/create-passkeys#get-options)). |
| Domain association | `https://sodera.xyz/.well-known/assetlinks.json` | **PASS.** Direct retrieval on 2026-09-11 returned HTTP 200 without a redirect, `Content-Type: application/json`, package `xyz.sodera.app`, both `delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds`, and both expected certificate fingerprints. The rebuilt APK contains the escaped `asset_statements` JSON include and manifest metadata. Google's check API reported `get_login_creds` linked; its earlier negative `handle_all_urls` response remained cached, but the subsequent physical registration demonstrates that Google Password Manager accepted the deployed association. |

The live DAL fingerprints observed were:

```text
FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
A7:5C:89:C7:74:39:BE:89:3E:5B:BE:25:AE:4B:AE:5A:80:42:3D:E8:82:9B:72:38:37:6D:6E:75:E4:96:81:B0
```

The installed debug APK was verified with Android build tools and has SHA-256 fingerprint `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`, an exact match for the first live entry. Debug, local-development, EAS-development, preview, and production builds can have different certificates; add each intentionally supported certificate as a separate DAL target. A package-name match alone is insufficient.

The app must also declare `<meta-data android:name="asset_statements" android:resource="@string/asset_statements" />`, where the compiled string value is valid JSON including `https://sodera.xyz/.well-known/assetlinks.json`. Android resource source must escape the JSON quotation marks; otherwise AAPT strips them and packages invalid JSON. `app/plugins/with-sodera-passkey.js` owns this generated configuration, and the built APK resource was inspected with `aapt2` rather than inferred from source XML.

### Physical-device association history

Before the corrected live statement deployed on 2026-09-11, Google Password Manager on the Nothing A015 reached its fingerprint prompt for registration, then Google Play services `ValidateRpIdOperation` failed with `[50152] RP ID cannot be validated`. AndroidX surfaced this as `CreatePublicKeyCredentialDomException` with `TYPE_DATA_ERROR`, and no credential was accepted. This run used the rebuilt APK with valid packaged `asset_statements`, while the live site still exposed only `get_login_creds`.

After the live statement deployed both relations, the same build and device completed registration. This isolates the earlier failure to the live association boundary rather than the ceremony parser or native bridge.

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

### Executed physical-device evidence

The scoped proof was executed on 2026-09-11 on device serial `00112346F007222`, a Nothing A015 running Android 16/API 36 with Google Password Manager supplied by `com.google.android.gms` / Google Play services `26.33.32`. The installed package was `xyz.sodera.app`; its debug signer SHA-256 was `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`, matching the deployed DAL statement. The provider offered fingerprint with PIN fallback.

Registration succeeded after explicit user action and fingerprint verification. The accepted public response had:

- Credential ID SHA-256: `0x21893d9e6a725628a7424a6e9e8c6c4a09bcd2aac759ea58767f340551c68703`
- P-256 X: `0xdbda6f9f38d804cc5548751802b855990e8985295d995f8011dd9428a6967137`
- P-256 Y: `0xb06ab2703eaa2ac958127ab3d22d8327a278910c8702eaa968f622b92f0463f5`
- AAGUID: `0xea9b8d664d011d213ce4b6b48cb575d4`
- Origin: `android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w`
- Authenticator attachment: `platform`
- Valid RP ID hash, UP, UV, AT, ES256 COSE key, SPKI binding, and credential-ID binding as checked by `passkey-ceremony.ts`

After displaying and explicitly confirming the proof operation, authentication succeeded through a one-entry `allowCredentials` list. The returned credential hash matched registration. The decoded response had type `webauthn.get`, the exact UserOperation hash `0xbab293cced41f18673c7b5becfdaef2e71eec57d73af9388e3a241d5fb007509`, the expected Android signer origin and RP ID hash, UP and UV set, and sign count `0`. Local P-256 verification passed. The normalized ZeroDev envelope hash was `0x8223b879eb675eceed188868d862f45553203dad28a730bf636e10f8c54dde30`; no private key material crossed the provider boundary.

`pnpm verify:device-webauthn /tmp/opencode/pra185-device-evidence.json` submitted the genuine public assertion envelope to released Sepolia validator `0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69` with only its public-key storage supplied by an `eth_call` state override. The exact operation returned `validationData = 0`; changing the final nibble of the operation hash while reusing the assertion returned `validationData = 1`. This consumes the genuine provider signature through the released verifier without deploying an account or moving assets.

The physical negative matrix produced no newly accepted assertion:

| Scenario | Observed result |
| --- | --- |
| User cancellation at UV | Canceling the Google Password Manager fingerprint prompt produced `android.credentials.GetCredentialException.TYPE_USER_CANCELED`. System biometrics logged `Fingerprint operation canceled`, error code `5`. |
| Failed UV and lockout | Repeated non-matching fingerprints produced a 30-second HAL temporary lockout: `FINGERPRINT_ERROR_LOCKOUT`, biometric error code `7`, and `Too many attempts. Use screen lock instead.` Android required PIN recovery. The app received `TYPE_USER_CANCELED`; no assertion replaced prior evidence. Normal access was restored with the device PIN. |
| Missing/deleted credential | After deleting the disposable passkey, the exact one-entry allow-list produced `ListPasskeyCredentialsOperation Result size: 0`. Credential Manager showed only `Sign in another way`; dismissing it produced `TYPE_USER_CANCELED`. No assertion was returned. A replacement disposable credential was then registered. |
| Local provider disabled | Setting the preferred password/passkey service to `None` removed Google Password Manager's local `PasswordAndPasskeyService` from the request. Credential Manager exposed only its remote `Sign in another way` path; dismissal returned no assertion. Google was reselected and a positive fingerprint assertion succeeded afterward. |
| Changed operation/challenge | The released validator rejected the genuine envelope against the changed UserOperation hash with `validationData = 1`. |
| App backgrounded while pending | Pressing Home at the fingerprint prompt stopped the provider activities. Returning to Sodera reset explicit confirmation and retained only prior evidence. Leaving the proof route canceled the pending session; no new assertion was accepted. Provider UI backgrounding caused by Credential Manager itself remains allowed because it is part of the explicitly initiated ceremony. |

## Implementation conclusion

The minimal implementation is one Android-only Expo local module that owns Credential Manager calls, activity/foreground/cancellation state, exception mapping, and raw response transfer. JavaScript owns explicit operation confirmation and supplies fresh request JSON; the existing Kernel WebAuthn bridge owns all assertion validation and validator-envelope construction. No Turnkey API, remotely managed signer, Android Keystore signing API, private-key export, backend signer, or Play Integrity decision belongs in this path.

PRA-185 is **PASS** for its scoped Nothing A015 proof: the live association, native registration, explicit credential-pinned operation assertion, local verification, released-validator consumption, and target-device negative matrix were executed. This does not claim transaction submission, asset movement, account deployment, provider portability, StrongBox, TEE storage, device binding, or private-key non-exportability.
