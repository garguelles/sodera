# Sodera

Sodera is a seedless smart-account wallet and Android home launcher. This repository contains two independently installable applications.

## Applications

| Directory | Purpose |
| --- | --- |
| [`app/`](app/) | Expo SDK 57 mobile application and Android home launcher |
| [`landing/`](landing/) | React landing site and passkey domain host for `sodera.xyz` |

Each application owns its package manifest, lockfile, dependencies, commands, and deployment configuration. There is no repository-root JavaScript workspace or install command.

## Development

Install and run the mobile application from `app/`:

```bash
cd app
pnpm install
pnpm start
```

Install and run the landing site from `landing/`:

```bash
cd landing
pnpm install
pnpm dev
```

See the application READMEs for verification, native development, Digital Asset Links, and deployment instructions.

## Project Documentation

- [`CONTEXT.md`](CONTEXT.md) defines the shared domain language.
- [`docs/adr/`](docs/adr/) records architecture decisions.
- [`docs/hackathon-specs.md`](docs/hackathon-specs.md) indexes the hackathon specifications.
- [`docs/hackathon-decisions.md`](docs/hackathon-decisions.md) records the current hackathon decisions.
- [`docs/agents/`](docs/agents/) configures issue tracking, triage labels, and domain-document conventions for engineering agents.
