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

The table defines the target architecture, not a claim that every listed deployable or package is implemented. The repository contains a partial local foundation; the engineering handoff records the implemented paths and their evidence. Keep the remaining target components in the approved delivery sequence. pnpm workspaces and Turborepo orchestrate the graph. Runtime and package versions are pinned in the repository lockfile.

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

[ADR 0005](adr/0005-media-processing-and-starage-policy.md) separates quarantined originals, public derivatives and private evidence. Signed upload authorization never proves content ownership or approval. Processing checks true file type, size/pixel limits, decoding, malware policy, metadata stripping and safe derivatives; public attachment requires READY plus domain approval.

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

### Local G2 analytics projection and response measurement

The worker's `AnalyticsStore.processAnalyticsOnce` consumes committed
`LISTING_PUBLISHED`, `interaction_created`, `message_sent` and
`provider_first_response` from the three existing outboxes. Additive migration
0027 persists normalized schema-v1 `analytics_events` and generic `job_receipts`.
Unique source-stream/event identity and consumer/stream/event receipts, source row
`FOR UPDATE SKIP LOCKED` and atomic projection/receipt transactions deduplicate
retries and concurrent workers. Analytics never changes source `delivered_at`,
`published_at` or `attempt_count`; those belong to the future publisher/SQS path.
Unmaterialized contact dependencies defer communication without acknowledging it.
Bucket mismatch or malformed context rolls back that stream's batch and emits
only a reason-free worker failure event; correction/retry is needed, not silent
acceptance. There is no new notification transport or client ingestion endpoint.

Publication/contact producers snapshot allowlisted region, purpose, provider
**types** (a profile can declare more than one), and named PROVIDER_IDENTITY claim
status in the business transaction. Communication inherits the contact projection.
Legacy snapshots remain unknown with `INCOMPLETE_SOURCE_CONTEXT`; ingestion never
reconstructs past mutable dimensions from present profile/location/claim values.
City, addresses and coordinates are absent. Local/staging/CI and synthetic-claim
traffic is TEST, including synthetic claims in a production-shaped environment.
Only production environment + production runtime + nonsynthetic context yields
PRODUCTION. The reporting default selects production/PRODUCTION. Snapshots use
`ANALYTICS_ENVIRONMENT` (default development, or NODE_ENV test/production).

`ANALYTICS_PSEUDONYM_SECRET` is an explicit server-only keyed HMAC secret of at
least 32 characters. The worker enables local consumption when it is configured;
otherwise it logs the disabled reason and preserves existing media behavior.
Never overwrite existing environment files to enable it. Actors, where useful,
are HMAC-SHA256 over domain-prefixed application user IDs; raw subjects/contact
identities are absent, and publication has no actor correlation. Secret rotation
changes actor correlation and requires a separately reviewed migration strategy.
No marketplace API exposes analytics or pseudonyms. SQL columns allow only IDs,
timestamps, enums, public region and approved provider-type arrays; no arbitrary
payload or private content is stored.

The internal `providerResponseSummary` uses UTC timestamps (up to PostgreSQL's
six fractional digits), a half-open contact window `[window_start, window_end)`
and explicit `as_of`. Its default is the rolling seven days ending at `as_of`.
Denominator D is eligible source contacts in that window and selected
classification/environment/segments, with no incomplete-context exclusion and
`contact_at + 24h <= as_of`. Numerator N is those mature contacts whose one first
provider response is `<= contact_at + 24h` and observed by `as_of`. Rate is N/D,
null when D=0; unanswered mature demand is D-N. Late replies are separately counted
and never rewrite the at-24h outcome. Immature contacts are excluded, even if
already answered. Exact deadline and exact maturity are inclusive.

Median is `percentile_cont(0.5)` of exact persisted response timestamp minus contact
timestamp in milliseconds **only among these N within-24h mature responders**;
bucket labels are independently validated classification, never median inputs.
The report exposes D and N, median sample N, overall sample D, version,
classification/environment, applied filters and reason-coded exclusion counts.
`provider-response-v1` excludes other classification/environment, incomplete
legacy context and immature contacts. Exclusion counts may overlap (legacy context
also has unknown environment/TEST classification). Self-contact is structurally
rejected by inquiry creation. Spam exclusion awaits an approved durable signal;
this version does not invent a classifier. Unknown dimensions do not match a
specific segment. Provider-type filters use membership in the snapshotted array.

The approved pilot minimum is 30 distinct contacts over at least 14 days. It is
returned as pilot metadata; the rolling operational/individual-segment threshold
is NOT_YET_FROZEN, with nullable insufficient-sample status (true for an empty
cohort, unknown for nonempty cohorts). This is no pilot pass/fail judgment. Reports
are projections of consumed events, not completeness watermarks: drain/validate
sources before recording acceptance numbers; a failed or delayed batch can leave
an incomplete projection. Event corrections, spam signals, city suppression,
client discovery events, dashboards and external analytics adapters remain later
scope. Synthetic integration metrics do not establish marketplace performance or
complete G2 acceptance.

### Listing lifecycle scheduling and region control (G3-E candidate)

The additive 0032 lifecycle tables hold immutable command results/actions/outbox and freshness episodes with versioned listing references. API commands reload current authority before receipt replay, check optimistic version plus exact revision/OfferingVersion, and produce state/audit/outbox atomically. Shared current visibility covers expiry, central region enablement, approval snapshots, media, provider verification and authority risk; public search/detail/media and private lifecycle responses are no-store.

The local worker invokes bounded expiry materialization and reminder-intent preparation. PostgreSQL locks and persisted state own correctness; the existing polling timer only invokes work. Expiry uses deterministic deadline/id ordering and SKIP LOCKED. Reminder preparation locks region, listing and schedule in that order, skips locked parents, emits at most one future eligibility intent per episode/deadline and skips late/ineligible schedules. There is no external queue or real notification delivery. A future notification consumer must lease/recheck intent timing, current episode and all eligibility before delivery; this candidate does not implement that consumer.

Region configuration is an internal store method with current registered MFA staff session/security version/recent step-up and an explicit current `configuration:manage` grant for that exact region. No broad admin or worker HTTP endpoint exists. Region changes exclusively lock the central control; submission/publication/renewal/new inquiry retain its shared lock across their transaction. Existing historical inquiries use their current private participation boundary rather than region permission. Lifecycle analytics consumes only freshness-confirmed/expired outbox categories with the existing generic consumer receipt; G2 cohort/response definitions and original source flags are unchanged.
