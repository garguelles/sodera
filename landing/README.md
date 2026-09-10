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

Before deploying the passkey proof, replace `REPLACE_WITH_APK_CERTIFICATE_SHA256` in `public/.well-known/assetlinks.json` with the colon-delimited SHA-256 fingerprint of the certificate that signs the APK installed on the test device.

Use a dedicated development or hackathon signing certificate. Do not commit the keystore or its passwords. To inspect a built APK:

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

Confirm that the response is the JSON file, uses `Content-Type: application/json`, contains `xyz.sodera.app`, and contains the fingerprint of the installed APK. Do not proceed with passkey testing while the placeholder remains.

## Deploy on Railway

1. Create a Railway service from this GitHub repository.
2. Leave the service root directory at the repository root so the Docker build can access the pnpm workspace lockfile.
3. Set the custom Dockerfile path to `landing/Dockerfile` in the service build settings.
4. Deploy the service. Railway supplies `PORT`; the Caddyfile listens on it and disables Caddy-managed TLS because Railway terminates TLS at the edge.
5. Add `sodera.xyz` as the service's custom domain and create the DNS record Railway provides.
6. Check both `/` and `/.well-known/assetlinks.json` over HTTPS after DNS and certificate provisioning complete.

Caddy is sufficient for this deployment. The first `handle` serves the association document without React Router fallback. The second uses `try_files` to serve real static assets and falls back to `index.html` for browser routes.
