# Pachi — System Architecture

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and accepted design

Implements [product specification](../00-product/product-specification.md) and [domain model](../01-domain/domain-model.md). ADRs 0001–0006 are accepted implementation decisions in this revision. Acceptance is distinct from measured readiness; the [readiness checklist](../03-operations/production-readiness-checklist.md) records unperformed evidence.

Pachi is a TypeScript modular monolith with separate client applications and a worker runtime. PostgreSQL owns domain state and authorization. External identity, storage, maps and delivery providers implement capabilities behind application-owned interfaces. They do not decide listing eligibility, roles, attendance or review outcomes.

## Repository and deployables

| Path | Responsibility |
|---|---|
| apps/api | NestJS REST/OpenAPI domain API; health/readiness; authorization and business operations. |
| apps/worker | Outbox publisher and idempotent jobs for media, notifications, expiry, review reveal, retention and projection repair. Shares domain modules, not duplicated business rules. |
| apps/mobile | Expo/React Native/Expo Router marketplace; SQLite public saved-listing cache; secure token storage. |
| apps/web | Next.js responsive public/authenticated marketplace and OIDC BFF. |
| apps/admin | Separate Next.js staff portal/BFF, separate Cognito app client, MFA/step-up, no public signup granting staff rights. |
| packages/contracts | Versioned API/event schemas and generated public types; no secrets or database internals. |
| packages/api-client | OpenAPI-generated client and shared error/idempotency conventions. |
| packages/database | Drizzle models, reviewed SQL migrations, seed fixtures and database utilities; server-only. |
| packages/domain | Server-only domain services/policies usable by API and worker; no frontend import. |
| packages/ui-tokens | Shared design tokens/localization contracts; native/web components may differ. |
| packages/eslint-config / typescript-config | Shared lint/build settings. |
| infrastructure/aws | AWS CDK TypeScript environment stacks and deployment configuration. |
| docs | Canonical documents in this package. |

No repository/application files above are claimed to exist yet. Scaffold only the packages needed for a running foundation; worker skeleton is included, feature jobs follow their domain slice. pnpm workspaces and Turborepo orchestrate the graph. Runtime/package versions are pinned with one lockfile after a compatibility check at scaffold time.

## Modules and ownership

Identity/sessions; users/contacts; provider accounts; organizations/memberships/assignments; geography; properties/relationships; listings/revisions; offerings/versions; media; discovery/saves; interactions/conversations/messages; viewings/attendance/disputes; reviews/eligibility/aggregates; verification; reports/moderation/appeals; notifications; analytics; audit; staff access.

One module owns each aggregate's writes. Cross-module work uses application services and explicit events, not unrestricted direct writes into another module's tables. One database and explicit transactions are preferred over premature distributed transactions. Every business endpoint enforces permissions even if called from a trusted BFF or worker.

## HTTP and contract conventions

REST under `/v1`; OpenAPI generated and checked in CI. Requests validate structure, limits and domain references. Responses use stable IDs, ISO timestamps, currency-aware amounts, cursor pagination and explicit safe projections. Error envelope contains stable code, safe message, request_id and optional field errors. Never expose stack traces, SQL errors, private object keys or internal risk reasons.

Mutation commands require idempotency keys where retries would duplicate business effects; scope key by authenticated principal and operation, retain request hash/result for at least 24 hours, reject key reuse with a different body. Expected version protects updates; domain transitions cannot be generic `PATCH state`. API and mobile compatibility use additive fields first and explicit deprecation; no destructive schema change in the same release that introduces its replacement.

Public, self, provider, organization and staff DTOs are separate schemas. An ORM entity is never returned directly. Public query eligibility includes all current publication/trust/region/freshness checks. Staff APIs are also protected on the backend, not only by an admin hostname.

## Data and migrations

PostgreSQL/PostGIS; Drizzle for typed access and reviewed SQL migrations. SQL is permitted for PostGIS, partial indexes, checks, range constraints, full-text search and transactional locking. Use `numeric`/minor-unit integer money without JavaScript float round trips. Foreign keys and unique/check constraints enforce the domain model, including principal XOR, offering validity, membership uniqueness, final-owner transaction locking and review uniqueness.

SQL migrations are forward versioned, immutable after application, checksummed and run by one migration role before compatible application rollout. Never run automatic schema push or app-start migrations in production. Review destructive changes separately; use expand/backfill/switch/contract. A database restore is a disaster recovery operation, not a routine application rollback.

PostgreSQL full-text/indexed filtering serves initial discovery. No dedicated search cluster. PostGIS stores Pachi-confirmed geography; private coordinates are excluded from public response/query inference. Cache optional public projections only, with explicit invalidation and a freshness/eligibility guard; no cache may keep revoked content accessible. No Redis requirement at this stage; rate limits use atomic shared PostgreSQL state at pilot scale plus edge controls, with limits/load tested.

## Authentication and authorization

[ADR 0002](adr/0002-authentication-and-session-strategy.md) defines Cognito email/password and Google/Apple sign-in, secure sessions and separate phone verification. PostgreSQL owns immutable Pachi user IDs, identity mappings, session registry, account state, roles, assignment and named verification claims.

Authorization pipeline is shared by API/worker: session/account → permission → principal scope → verification/authority → lifecycle/hold/block → step-up. All authenticated requests check the registered session and current account state; sensitive resource operations also check current memberships/claims directly. Revocation cannot wait for JWT expiry or stale client caches.

## Publication and first marketplace path

Create provider principal and verify required identity/business claim; declare matching property relationship; create Property, Listing and Offering; upload/process images; submit exact listing revision; staff review; guarded publication; public discovery; eligible seeker creates/reuses Interaction/Conversation; provider responds. This is G2. Verification and listing moderation are prerequisites within this path, not modules postponed until after reviews.

All publication predicates live in one policy service reused by search/detail/commands. Current declared authority suffices unless a recorded risk hold requires a verified claim. Required claim loss suppresses immediately. Three listing axes preserve publication, market and moderation distinctions. Material changes create OfferingVersion/ListingRevision and require re-review.

## Async work and failure semantics

Domain mutation, AuditEvent where required and OutboxEvent commit in one PostgreSQL transaction. Publisher reads outbox under lease/lock, sends to SQS, then marks published; a crash between send and mark may duplicate delivery. Consumers use unique consumer/event receipts, recheck aggregate version/state and commit their database effect before acknowledging. Never claim exactly-once end-to-end external delivery.

Separate queues for notifications, media, and domain maintenance with DLQs. Retry transient errors with bounded exponential backoff/jitter; permanent validation errors go to failure/case state. Visibility timeout exceeds expected job time and workers extend it with a bounded heartbeat. Consumer deletes only after durable success. Provider idempotency keys are used where available; ambiguous provider sends are reconciled before blindly replaying.

Expiry/review windows/reminders use persisted ScheduledAction rows with due_at and a leasing scheduler; do not rely on process timers or long queue delays. Cancellation/rescheduling invalidates old schedule-version work. Dead-letter replay requires root-cause resolution, current authorization/state checks, bounded rate and an audit record.

External outage does not roll back a committed core message or review. In-app notification intent persists before external delivery. Stale projection repair uses source-of-truth events and no private payload in generic queues.

## Media and geospatial boundaries

[ADR 0005](adr/0005-media-processing-and-storage-policy.md) separates quarantined originals, public derivatives and private evidence. Signed upload authorization never proves content ownership or approval. Processing checks true file type, size/pixel limits, decoding, malware policy, metadata stripping and safe derivatives; public attachment requires READY plus domain approval.

[ADR 0004](adr/0004-maps-geocoding-and-location-services.md) keeps canonical region/city/neighborhood independent of external maps. List discovery is core; map results/autocomplete/distance are early-release features after coverage/privacy/licensing evidence. Do not make a third-party geocoder necessary to publish a manually confirmed structured address.

## Offline and mobile behavior

SQLite caches only allowed public saved-listing fields and optimized media, maximum 100 listings/200 MiB media. Show last-sync time and stale price/availability warning. Clear account-scoped cache on logout/switch; remove expired/hidden/removed entries on next sync, with controlled unavailable placeholder. Offline devices cannot receive instantaneous revocation, so private fields/evidence are never cached here. Network-dependent actions remain unsent/pending until server confirmation and are reauthorized when retried.

Server saved-listing set is canonical; idempotent sync handles saves/removals with client operation IDs and server versions. Web need not duplicate the native offline store to satisfy the mobile offline requirement. Native security credentials use secure platform storage, never SQLite or ordinary logs.

## Notifications and analytics

[ADR 0006](adr/0006-notification-email-sms-strategy.md) owns email/SMS/push provider contracts, preferences, durable inbox, retries, delivery state and cost controls. Sensitive payloads are excluded from lock-screen text.

Domain funnel events are emitted from the transactional outbox; client discovery events enter a validated ingestion endpoint with event_id dedupe, receive time, schema version, environment and safe fields. Source events remain queryable in application-owned storage; a warehouse/dashboard adapter can follow without changing the taxonomy. Staff analytics expose aggregates; no identity evidence, exact addresses or message bodies in telemetry. G2 instruments its funnel, G3 verifies all core event contracts, G4 freezes numeric pilot thresholds, G5 evaluates them.

## Environments, security and operations

Local uses Docker PostgreSQL/PostGIS and isolated S3/SQS emulation or test adapters; no production credentials. Staging/prod use separate AWS accounts, databases, buckets, queues, Cognito pools, secrets and callback URLs. Optional preview apps use synthetic data and isolated credentials. Private RDS, private API/worker subnets, least-privilege IAM, encrypted transport/storage, restricted egress and OIDC CI federation apply to deployed environments.

OpenTelemetry request/trace IDs, structured redacted logs, Sentry client/server errors and CloudWatch metrics cover API, database, queue age, media, auth, external delivery and domain queues. Alerts must lead to an owned action. Secrets, message bodies, evidence and private address never enter logs/traces. Restore and incident procedures are in the operations runbook.

## Implementation order and evidence gates

1. Reconciled documentation baseline and repository inspection.
2. Local monorepo/client/API/worker skeleton, pinned dependencies, environment validation, health/readiness, PostgreSQL/PostGIS and migration framework.
3. CI build/type/lint, meaningful policy/integration test harness, request/logging conventions and generated API contracts.
4. Identity/session integration and server permissions; synthetic fixtures until real-data gates pass.
5. G1 foundation controls: threat/data boundaries, environment isolation, migration evidence, authorization strategy, secrets/logging and backup/restore mechanism demonstrated in a nonproduction environment.
6. G2 first marketplace path including verification, media, offerings, listing moderation and inquiry/response.
7. G3 complete core marketplace: organization flows, viewings, bilateral reviews, reports/appeals, saves/offline, notifications, responsive marketplace web and staff workflows with analytics.
8. G4 private Cameroon pilot readiness; G5 public MVP; G6 regional expansion.

Starting a scaffold is not passing G1. Real vendor provisioning, evidence collection and public release require their specific checks. Deferred features remain in the full roadmap, with no scope reduction attributed to the size of the development team.
