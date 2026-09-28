# Pachi implementation rules

## Current repo baseline

This repository is at the documentation + local foundation stage, not at full MVP delivery. As of 2026-09-25, the canonical guidance in [docs/README.md](../docs/README.md) and [README.md](../README.md) states that the repo is establishing the monorepo, pinned toolchain, local Postgres foundation, database migration workflow, health endpoints, contracts, logging, and CI evidence before identity/permissions and the marketplace vertical slice.

Do not treat this as production-ready or claim deployment, real auth, cloud provisioning, SMS, or marketplace behavior unless the task explicitly covers that approved slice and the relevant documents authorize it.

## Required reading order

- Start with [docs/README.md](../docs/README.md), the canonical authority map.
- Read the relevant product requirement section in [docs/00-product/product-specification.md](../docs/00-product/product-specification.md) and the related domain rules before changing behavior.
- Then read the relevant accepted ADRs in [docs/02-architecture/adr](../docs/02-architecture/adr) when implementation choices depend on architecture.
- Preserve the approved stack and invariants: TypeScript, pnpm, Turborepo, Expo, Next.js, NestJS, Drizzle, PostgreSQL/PostGIS.

## Repository conventions

- Follow the monorepo layout: apps for admin/web/api/mobile/worker, packages for shared contracts and database tooling.
- Keep changes narrow and coherent; do not invent product rules or silently replace approved domain behavior.
- Prefer the smallest implementation that satisfies the current requirement slice and update only the files affected by that work.
- Do not add new business tables, auth flows, marketplace behavior, cloud infrastructure, or deployment logic unless the relevant product and domain documents have been read and the task explicitly authorizes that slice.

## Local setup and verification

For local work, use the pinned toolchain and environment flow described in [README.md](../README.md):

- Node 24.21.0
- pnpm 12.0.0
- Docker Compose for local Postgres

Typical local baseline:

```bash
nvm install 24.21.0
nvm use 24.21.0
corepack enable
corepack install --global pnpm@12.0.0
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
```

When validating work, use the repository commands that fit the change:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If the task touches the database schema or migrations, also run the migration flow and verify the generated SQL matches the intended behavior.

## Guardrails

- Keep secrets, credentials, tokens, private evidence, message content, and sensitive addresses out of source control, logs, and traces.
- Use synthetic local configuration for non-production development.
- Never treat a scaffold or documentation checklist as production readiness.
- Do not assume real SMS, Cognito, Google/Apple federation, cloud resources, or live deployment are configured unless the task explicitly covers that environment and the repo documents authorize it.
- Report blockers honestly and distinguish between implemented evidence and required gates that are still pending.

## Task focus for this stage

The current priority is foundation work: repo health, dependency setup, local database, health/readiness, contracts, logging, CI, and the first approved identity/permission slices. Do not broaden into later marketplace or launch-stage behavior without explicit approval.

## Product context reminder

Pachi is a Cameroon housing marketplace whose core journey is property discovery, listing/provider trust, inquiry, and viewing. The approved product scope governs behavior; use [docs/README.md](../docs/README.md), the [product specification](../docs/00-product/product-specification.md), [domain model](../docs/01-domain/domain-model.md), [permissions](../docs/01-domain/roles-and-permissions.md), and accepted architecture ADRs as authority. Sahibinden is a discovery-experience reference only, not a replacement specification. Preserve mobile, marketplace web, provider/organization capabilities, and separate staff administration while implementing only the explicitly authorized slice.
