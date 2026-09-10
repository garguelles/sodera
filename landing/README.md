# Sodera landing page

Vite, React, and React Router power the landing page. Caddy serves the production build and keeps client-side routes working while serving Android's Digital Asset Links document directly.

## Local development

From the repository root:

```bash
pnpm install
pnpm --filter @sodera/landing dev
```

Create a production build with:

```bash
pnpm --filter @sodera/landing build
```

## Configure Android association

`public/.well-known/assetlinks.json` currently trusts two public certificate fingerprints for `xyz.sodera.app`:

- The local debug certificate used by `expo run:android` during physical-device development.
- The EAS-managed Android certificate used by internal EAS builds and as the Google Play upload key.

Certificate fingerprints are public identifiers required by Digital Asset Links. Never commit the corresponding keystore or its passwords. To inspect a built APK:

```bash
apksigner verify --print-certs path/to/sodera.apk
```

The deployed document must return HTTP 200 directly from:

```text
https://sodera.xyz/.well-known/assetlinks.json
```

Verify the response after deployment:

```bash
curl --fail --include https://sodera.xyz/.well-known/assetlinks.json
```

Confirm that the response is the JSON file, uses `Content-Type: application/json`, contains `xyz.sodera.app`, and contains the fingerprint of the installed APK. After the first internal-testing AAB upload, add the Google Play App Signing fingerprint used for Play-installed builds. Remove the local debug fingerprint before a broader production release.

## Deploy on Railway

1. Create a Railway service from this GitHub repository.
2. Leave the service root directory at the repository root so the Docker build can access the pnpm workspace lockfile.
3. Set the custom Dockerfile path to `landing/Dockerfile` in the service build settings.
4. Deploy the service. Railway supplies `PORT`; the Caddyfile listens on it and disables Caddy-managed TLS because Railway terminates TLS at the edge.
5. Add `sodera.xyz` as the service's custom domain and create the DNS record Railway provides.
6. Check both `/` and `/.well-known/assetlinks.json` over HTTPS after DNS and certificate provisioning complete.

Caddy is sufficient for this deployment. The first `handle` serves the association document without React Router fallback. The second uses `try_files` to serve real static assets and falls back to `index.html` for browser routes.
