# Sodera app

The Expo SDK 57 mobile application and Android home launcher.

## Development

Run commands from this directory:

```bash
pnpm install
pnpm start
```

Use `pnpm android` for a local Android development build. Expo Router routes live in `src/app/`.

## Android passkey proof

Passkeys require the native development build; Expo Go does not include the local Credential Manager module. Start Metro, then build for and install on the selected device:

```bash
pnpm exec expo start --dev-client
pnpm exec expo prebuild --platform android
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> shell am start -a android.intent.action.VIEW -d sodera://passkey-proof xyz.sodera.app
```

Use `x86_64` instead of `arm64-v8a` for the Google Play emulator. Before accepting evidence, verify the APK signer matches `https://sodera.xyz/.well-known/assetlinks.json`, the hosted statement grants both `handle_all_urls` and `get_login_creds`, and the APK contains the `asset_statements` manifest resource. The complete security boundary, request format, and device evidence checklist are in [`../docs/research/PRA-185-android-credential-manager.md`](../docs/research/PRA-185-android-credential-manager.md).

## Verification

```bash
pnpm lint
pnpm test --runInBand
pnpm verify:kernel-webauthn
pnpm verify:webauthn-provenance
pnpm verify:webauthn-vectors
```

Copy `.env.example` to the ignored `.env.local` before running verification commands that require Sepolia or ZeroDev configuration.
