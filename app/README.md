# Sodera app

The Expo SDK 57 mobile application and Android home launcher.

## Development

Run commands from this directory:

```bash
pnpm install
pnpm start
```

Use `pnpm android` for a local Android development build. Expo Router routes live in `src/app/`.

## Verification

```bash
pnpm lint
pnpm test --runInBand
pnpm verify:kernel-webauthn
pnpm verify:webauthn-provenance
pnpm verify:webauthn-vectors
```

Copy `.env.example` to the ignored `.env.local` before running verification commands that require Sepolia or ZeroDev configuration.
