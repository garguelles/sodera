# Hackathon Android distribution plan

**Deadline:** Sunday, September 27, 2026 at 09:00 JST (September 27 at 00:00 UTC).

## Goal and release route

Give judges and other testers a standalone, installable Android build of Sodera before the submission deadline. Use the existing EAS `preview` profile in `app/eas.json` to produce an internally distributed APK, then share its install link/QR code on `sodera.xyz` and in the submission. This route does not depend on Play review or a running Metro server. The app is an Android home launcher with a native Android passkey module, so Expo Go and an iOS build are not substitutes for testing the core experience.

Google Play internal testing is an optional second channel if the Play Console app and tester list are ready; it must not block the APK. A public Play release can follow the hackathon.

## Preparation

1. From `app/`, confirm the Expo account has access to the linked EAS project (`extra.eas.projectId` in `app/app.json`) and that the `preview` profile builds a standalone Android APK. Keep `development` for Metro-connected development builds; do not distribute one as the judge build.
2. Configure the build's `EXPO_PUBLIC_SEPOLIA_RPC_URL` and `EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC` in the EAS environment used by the preview build. Verify their values before building. These variables are embedded in the app and must be treated as public; a local `.env.local` does not configure a cloud build. Check that any required ZeroDev sponsorship/testnet services are available and bounded for public onboarding.
3. Confirm `https://sodera.xyz/.well-known/assetlinks.json` is live, returns the association JSON directly, lists `xyz.sodera.app`, and grants both `handle_all_urls` and `get_login_creds`. The existing file lists the EAS-managed signing fingerprint; verify it against the actual APK before trusting passkey onboarding.

## Build and validate

1. From `app/`, run `npx eas-cli@latest build --platform android --profile preview`. Record the build URL, APK download URL, version, and build ID. Do not use the `production` profile for the direct APK: its default Android artifact is intended for Play submission.
2. Download the APK and compare `apksigner verify --print-certs path/to/sodera.apk` with the fingerprint served by `https://sodera.xyz/.well-known/assetlinks.json`. If they differ, update `landing/public/.well-known/assetlinks.json`, deploy the landing site, and verify the HTTPS response before testing passkeys.
3. Install that exact release APK on a clean physical Android phone, without Metro. Test launch, fresh wallet/passkey onboarding, wallet home, a Sepolia balance, a passkey-authorized transaction if funded, launcher registration and return to the previous home app. Test the link and installation instructions on a second device if available. Record any incomplete flows honestly in the submission.
4. Put an **Install Android app** link to the verified EAS artifact on the landing page and in the hackathon submission; include a QR code if useful. Say that Android may ask users to allow installation from the browser and that the wallet uses Sepolia testnet assets. Keep a copy of the validated APK and link so a later rebuild cannot silently replace the submitted artifact.

## Optional Play internal testing

If Play Console is already configured, create the app with package `xyz.sodera.app`, upload a production-profile AAB to the internal testing track, and add testers. Retrieve the **Google Play app-signing certificate** fingerprint (not just the EAS upload-key fingerprint), add it to the hosted Digital Asset Links document, then install from Play and repeat the passkey smoke test. Share the tester opt-in link only after confirming it works; retain the direct APK as the deadline-safe fallback.

## Submission gate

Finish the build, HTTPS association check, and clean-device smoke test before 09:00 JST on September 27. Submit the install link, device/Android requirements, a short testnet walkthrough, and a fallback demo video or screenshots in case a judge cannot sideload the APK. If the final build fails validation, share the last validated APK rather than an untested replacement.
