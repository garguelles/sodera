# Sodera

Sodera is a seedless smart-account wallet and Android home launcher. The repository contains five isolated applications: `app/` is the Expo mobile application, `landing/` is the React landing site and passkey domain host, `agent/` is the keyless Hono service that turns wallet requests into reviewable plans, `ens/` is the local ENS namespace owner tool, and `api/` is one Hono API with ENS and Uniswap routes.

## Design

- `docs/DESIGN.md` is the Platinum Fluid visual specification for the mobile and landing applications; the local ENS owner tool follows the same visual roles. Use its dark surfaces, platinum hierarchy, emerald/cyan status accents, Geist text, and JetBrains Mono data labels.
- The Expo app's executable tokens live in `app/src/constants/theme.ts` (`platinum`); use those for new and updated screens instead of adding inline palettes, font sizes, spacing scales, or another theme file. Preserve real data and existing feature states when adapting Stitch mockups.
- The landing site's CSS variables live in `landing/src/styles.css` and should mirror the same design roles. Update both token sets and `docs/DESIGN.md` together when the brand changes.

## Git

- For a new feature or Linear ticket, fast-forward `main` and create a branch from `main`.
- Branches use `{feat,chore,fix,docs,refactor}/{LINEAR_TICKET_NUMBER}-{short-description}`.
- Commits use `{type}: {LINEAR_TICKET_NUMBER}: {description}`.
- Pull request titles use `{type}: {LINEAR_TICKET_NUMBER}: {description}`, with a lowercase type and description, for example `feat: PRA-128: publish three card local curator`.
- Prefix pull request titles with `[ETHGlobal Tokyo] `, for example `[ETHGlobal Tokyo] feat: PRA-128: publish three card local curator`.
- Ad hoc work that is not tracked in Linear does not require a ticket solely for naming. Use `{feat,chore,fix,docs,refactor}/{short-description}` for the branch and `{type}: {description}` for commits.
- After a pull request is squash-merged, delete its remote feature branch from GitHub.
- Never merge into the `production` branch. Production merges are performed only by the user.

## Linear

- Workspace: PragmaCollective. Project: sodera. Team key: `PRA`.
- Move a ticket to In Progress when work starts.
- Comment with implementation summary, challenges, plan changes, and useful manual testing notes. Ask before moving a ticket to Done.
- Issue and triage guidance lives under `docs/agents/`.

## Plans

- Put all plan Markdown files under `docs/plans/`.
