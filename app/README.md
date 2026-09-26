# Sodera app

The Expo SDK 57 mobile application and Android home launcher.

## Development

Run commands from this directory:

```bash
pnpm install
pnpm start
```

Use `pnpm android` for a local Android development build. Expo Router routes live in `src/app/`.

For a standalone Android APK to share with testers, run `pnpm build:android`. This uses the EAS `preview` profile and prints an EAS-hosted install link. Confirm the EAS build environment contains the public Sepolia RPC and ZeroDev bundler URLs before building. Validate the APK on a device before putting its link on the landing page.

## Wallet agent

The sparkle button in the launcher header opens Dera, the assistant: a chat that sends each sentence to the agent service in [`../agent/`](../agent/) and shows the plan it returns. The phone re-runs the same safety rules before anything is signed. Set these in `.env.local` to enable it; without the first two the button is hidden.

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_AGENT_BASE_URL` | The agent service URL. For a local agent, this Mac's Wi-Fi address, for example `http://192.168.1.20:8080`, with the phone on the same network |
| `EXPO_PUBLIC_AGENT_APP_TOKEN` | The service's `AGENT_APP_TOKEN` |
| `EXPO_PUBLIC_AGENT_CONTACTS` | Placeholder contacts, `alice=0x…,bob=0x…`, until an address book or ENS lands |

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
pnpm verify:multibaas
```

Copy `.env.example` to the ignored `.env.local` before running verification commands that require Sepolia, ZeroDev, or MultiBaas configuration.

## MultiBaas

The Transactions screen reads USDC transfers and smart account operations from a Curvegrid MultiBaas deployment on Ethereum Sepolia. Set these variables in `.env.local`:

| Variable | Used by | Value |
| --- | --- | --- |
| `MULTIBAAS_BASE_URL` | `pnpm verify:multibaas` | Deployment domain, without a trailing slash or `/api/v0` |
| `MULTIBAAS_API_KEY` | `pnpm verify:multibaas` | DApp User API key |
| `EXPO_PUBLIC_MULTIBAAS_BASE_URL` | App | Same domain as above |
| `EXPO_PUBLIC_MULTIBAAS_API_KEY` | App | Same DApp User key; it is embedded in the app and is public |

`pnpm verify:multibaas` checks the deployment against the pinned Sepolia contracts and prints the response shapes the app depends on. Set `VERIFY_ACCOUNT` to check a specific account balance.
