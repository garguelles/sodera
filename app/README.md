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

### Local ENS passkey proof

Start the API and PostgreSQL with `make start` from `api/`. For a connected Android debug build, forward the API over USB with `adb reverse tcp:8082 tcp:8082` (and Metro with `adb reverse tcp:8081 tcp:8081`). **Restart** any existing Metro process so it picks up the ENS URL, then run from `app/`:

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:8082 pnpm exec expo start --dev-client
```

In another terminal, open the diagnostic route:

```bash
adb shell am start -a android.intent.action.VIEW -d sodera://passkey-proof xyz.sodera.app
```

On the Passkey Proof screen, reopen a deployed wallet, enter an available Sodera label, and choose **Verify passkey with ENS service**. The server must verify the one-time assertion; the screen explicitly says that no name was issued. Loopback HTTP is allowed only in development; outside a local debug build the API URL must be HTTPS. This proof does not authorize a registration or change the wallet.

`EXPO_PUBLIC_ENS_CLAIMS_ENABLED=0` keeps the separate **Request ENS name** diagnostic hidden. Only set it to `1` for a reviewed test after the public API's claim gate, private issuer worker and owner's registrar grant are active. A queued claim is not a verified name; the diagnostic can refresh its status but does not replace the existing mock onboarding profile.

For a Railway-backed hackathon build, set `EXPO_PUBLIC_API_URL` to the deployed API's HTTPS domain and enable `EXPO_PUBLIC_ENS_CLAIMS_ENABLED=1` only after the Railway private issuer worker, Postgres and registrar grant are verified. The phone then talks directly to Railway; USB forwarding is only needed when testing the local API.

For a **new disposable testnet wallet on the next demo**, stop the Sodera app and clear its local app data with `adb shell pm clear xyz.sodera.app`, then reopen it. This clears Wallet Identity metadata, the mock onboarding profile and local settings; it does **not** delete Android passkeys, undo Kernel transactions, transfer ENS tokens, free an existing label or reset the API's claim ledger. The previous wallet may become inaccessible in Sodera without its persisted credential metadata and a recovery flow, so use only a demo wallet with no assets or names you need to manage later. Choose a fresh username and passkey on each live run. `adb reverse` port mappings may need to be restored after reconnecting the USB cable.

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
