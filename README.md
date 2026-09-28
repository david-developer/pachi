# Pachi — Reconciled Documentation Package

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

This repository contains the revised canonical documentation and the local implementation foundation. It does not claim production readiness, cloud deployment, authentication, marketplace behavior, or executed production migrations.

Start with [docs/README.md](docs/README.md). Replace the corresponding files in your repository's `docs/` directory, inspect the diff, preserve unrelated files and make a separate documentation commit. This package README is delivery guidance; merge any useful notes into the existing repository README rather than overwriting unrelated project instructions.

See [reconciliation record](docs/archive/documentation-migration-record.md) for deliberate changes, resolved questions and remaining launch evidence. Historical source material is archived and is not a second implementation specification.

## Local foundation

Prerequisites: Node.js 24.21.0, pnpm 12.0.0, and Docker Compose. In a
fresh WSL terminal with `nvm` installed, activate the pinned toolchain before
running repository commands:

```bash
nvm install 24.21.0
nvm use 24.21.0
corepack enable
corepack install --global pnpm@12.0.0
node --version
pnpm --version
```

The repository repeats these pins in `.nvmrc`, `package.json`, and the
lockfile; do not rely on a globally selected Node or pnpm version.

```bash
cp .env.example .env
set -a
source .env
set +a
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The API is available at `http://localhost:3001/v1/health/live` and
`http://localhost:3001/v1/health/ready`. The marketplace shell runs on
port 3000, the separate staff shell on port 3002, and Expo starts the
mobile development shell with `pnpm --filter @pachi/mobile start`.

The identity foundation exposes `POST /v1/auth/bootstrap`,
`GET /v1/account/me`, `GET /v1/account/sessions`,
`POST /v1/account/logout`, and `POST /v1/account/logout-all`. These
endpoints accept Cognito access tokens only when Cognito settings are
configured; local tests use a separate synthetic signed issuer and never
enable that issuer in production. The response contract is in
`packages/contracts` and the API description is in `apps/api/openapi.yaml`.

Run the foundation checks with `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm build`. These checks do not replace the documented
G1-G6 evidence gates.
