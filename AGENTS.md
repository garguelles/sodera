# Sodera

Sodera is a seedless smart-account wallet and Android home launcher. The repository contains two isolated applications: `app/` is the Expo mobile application and `landing/` is the React landing site and passkey domain host.

## Git

- For a new feature or Linear ticket, fast-forward `main` and create a branch from `main`.
- Branches use `{feat,chore,fix,docs,refactor}/{LINEAR_TICKET_NUMBER}-{short-description}`.
- Commits use `{type}: {LINEAR_TICKET_NUMBER}: {description}`.
- Pull request titles use `{type}: {LINEAR_TICKET_NUMBER}: {description}`, with a lowercase type and description, for example `feat: PRA-128: publish three card local curator`.
- Ad hoc work that is not tracked in Linear does not require a ticket solely for naming. Use `{feat,chore,fix,docs,refactor}/{short-description}` for the branch and `{type}: {description}` for commits.
- After a pull request is squash-merged, delete its remote feature branch from GitHub.
- Never merge into the `production` branch. Production merges are performed only by the user.

## Linear

- Workspace: PragmaCollective. Project: sodera. Team key: `PRA`.
- Move a ticket to In Progress when work starts.
- Comment with implementation summary, challenges, plan changes, and useful manual testing notes. Ask before moving a ticket to Done.
- Issue and triage guidance lives under `docs/agents/`.
