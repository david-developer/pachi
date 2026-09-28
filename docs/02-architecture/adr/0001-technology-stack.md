# ADR 0001 — Technology Stack

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Decision and supersession

Accepted for baseline 2.1. Supersedes the earlier Kysely/node-postgres query-layer and Redis/BullMQ job proposals for future implementation. No implemented system or data migration is being replaced: project status is documents/environment only. Product behavior remains defined by [product specification](../../00-product/product-specification.md).

Use TypeScript throughout, pnpm workspaces/Turborepo, Expo/React Native mobile, separate Next.js marketplace and staff applications, NestJS modular monolith and a worker runtime. PostgreSQL/PostGIS is transactional authority; Drizzle plus explicit reviewed SQL is the persistence/migration approach. REST/OpenAPI contracts are generated for clients. Jobs use PostgreSQL outbox + SQS. Infrastructure uses AWS CDK TypeScript.

| Concern | Choice / constraint |
|---|---|
| API/worker | Containers on ECS Fargate, separate service/task scaling, shared domain policies. |
| Database | RDS PostgreSQL/PostGIS, private network, Multi-AZ before public launch; compatibility/version tested before pinning. |
| Media | S3 private origins and CloudFront public approved derivatives, isolated private evidence. |
| Authentication | Cognito User Pools; domain authorization stays in PostgreSQL. |
| Web delivery | Vercel for Next.js; app secrets server-only, region/runtime compatibility tested. |
| Mobile delivery | EAS builds/releases and controlled compatible OTA updates. |
| Search | Indexed PostgreSQL/PostGIS and full-text search, no dedicated cluster initially. |
| Local offline | Mobile SQLite and bounded public media cache. |
| Observability | OpenTelemetry, CloudWatch and Sentry, with privacy filtering. |
| Tests | Jest for backend/unit/integration, Playwright for web/staff end-to-end, Maestro for mobile. |
| CI | GitHub Actions with frozen lockfile, least privilege and AWS OIDC for deployment. |

## Why this design

One language and shared schemas reduce boundary errors. A modular monolith preserves transactions and clear ownership. Managed identity, database and queues reduce custom security/operations work while keeping Pachi's domain model independent. SQL remains available for the constraints/geospatial behavior the product needs; an ORM cannot weaken those requirements.

SQS replaces the initial need to operate Redis/BullMQ. No separate cache service is required until measurements justify it; pilot rate limits use shared atomic PostgreSQL state plus edge protection. This is a chosen baseline, not a claim that another stack is invalid.

## Dependencies and version discipline

At scaffolding, choose a mutually compatible supported Node/pnpm/Expo/Next/Nest/Drizzle/PostgreSQL/PostGIS set from official documentation, pin exact versions/lockfile/container digests where practical and record them in repository configuration. Never use `latest` tags or assume an old example version is current. Dependency updates require build and relevant compatibility checks, not automatic broad rewrites.

Drizzle-generated migrations require human-readable SQL review. No production schema push, no implicit destructive migrations, no exposing database types as public contracts. Backend-only packages must not enter client bundles. Explicit imports/lint boundaries enforce ownership.

## Alternatives and tradeoffs

Kysely and SQL-only migrations remain viable but are not a second active path. Redis/BullMQ is deferred unless a measured use case justifies changing the accepted queue design. Microservices, Kubernetes, event-streaming clusters, multi-region active-active and dedicated search are deferred. Multiple deployed clients do not require multiple business backends.

AWS and Vercel introduce vendor configuration/cost and network boundaries; adapters, IaC, exportable data and recovery rehearsals limit operational lock-in. Costs and Cameroon latency remain evidence gates before provisioning/launch, not fabricated benefits.

## Acceptance evidence

The decision is settled. Implementation passes when a clean clone installs deterministically, each initial app starts/builds, API reaches local PostGIS, a reviewed migration runs, generated contracts compile, CI passes and no production secrets are needed locally. Production deployment evidence is assessed separately in the [readiness checklist](../../03-operations/production-readiness-checklist.md).
