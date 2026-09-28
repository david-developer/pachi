# Pachi — Canonical Documentation

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Start here

This is Pachi baseline 2.1, reconciled on 24 September 2026 at the project owner's request. It is the implementation reference for the repository. The original documentation delivery claimed environment setup and documentation only. Current implementation evidence and outstanding work are maintained in the single [engineering handoff](engineering/current-state.md); that operational record cannot amend product policy or certify launch readiness.

The original full product scope remains. Delivery is incremental; an early working slice is not the full MVP. The project owner carries the engineering/product/operations responsibilities; named roles in the documents are permissions and responsibilities, not evidence of a staffed organization.

## Authority and conflict rule

1. A recorded product change updates the canonical product specification and all affected documents in the same change.
2. [Product Specification V2.1](00-product/product-specification.md) defines required behavior and scope.
3. [Domain model](01-domain/domain-model.md) defines entities/invariants; specialized domain documents elaborate permissions, lifecycle, verification, reviews and moderation without overriding the product.
4. [System architecture](02-architecture/system-architecture.md) and its accepted ADRs choose implementation mechanisms.
5. Operations checklists define evidence and execution; database/API/code must conform to the above.

If two current documents disagree, resolve the contradiction in the same change before implementing that affected behavior. Do not silently choose the lower-level document, rely on a conversation alone, or treat an archive as a competing authority. A specialized document can add detail but cannot delete a product requirement.

## Canonical files

| Concern | Read |
|---|---|
| Product scope, requirements, defaults, analytics and gates | [Product specification](00-product/product-specification.md) |
| Entities and database invariants | [Domain model](01-domain/domain-model.md) |
| Roles, assignment and staff boundaries | [Roles and permissions](01-domain/roles-and-permissions.md) |
| Exact state names/transitions | [Lifecycle states](01-domain/lifecycle-states.md) |
| Verification subjects/evidence/publication | [Verification model](01-domain/verification-model.md) |
| Bilateral eligibility/reveal/reputation | [Review system](01-domain/review-system.md) |
| Messaging/viewings/reports/moderation/appeals | [Interaction and moderation rules](01-domain/interaction-and-moderation-rules.md) |
| Components, contracts, local workflow and implementation order | [System architecture](02-architecture/system-architecture.md) |
| Stack and persistence | [ADR 0001](02-architecture/adr/0001-technology-stack.md) |
| Identity and sessions | [ADR 0002](02-architecture/adr/0002-authentication-and-session-strategy.md) |
| Deployment topology/recovery | [ADR 0003](02-architecture/adr/0003-aws-region-and-environment-topology.md) |
| Geography/maps | [ADR 0004](02-architecture/adr/0004-maps-geocoding-and-location-services.md) |
| Uploads/media/evidence | [ADR 0005](02-architecture/adr/0005-media-processing-and-storage-policy.md) |
| Inbox/email/SMS/push | [ADR 0006](02-architecture/adr/0006-notification-email-sms-strategy.md) |
| Deployment/incident/recovery procedures | [Operations runbook](03-operations/deployment-and-operations-runbook.md) |
| G0–G6 and external evidence E01–E07 | [Readiness checklist](03-operations/production-readiness-checklist.md) |
| Launch execution and first 24 hours | [Launch-day runbook](03-operations/launch-day-runbook.md) |
| What changed and why | [Reconciliation record](archive/documentation-migration-record.md) |

## Settled baseline

- Separate User, ProviderProfile/ProviderAccount, Organization/Membership, Property, ProviderPropertyRelationship, Listing, Offering/OfferingVersion, Interaction/Conversation and Viewing.
- Provider types OWNER, INDEPENDENT_AGENT, PROPERTY_MANAGER and ORGANIZATION; organization roles OWNER, ADMIN, LISTING_MANAGER, AGENT, ANALYST. Multiple owners supported; final owner protected.
- Named claim verification. Current property declaration ordinarily suffices; a recorded risk hold can require verified authority. No universal A2 publication gate.
- Separate listing publication, moderation and market axes; revision approval, freshness expiry and region controls enforced server-side.
- Cognito email/password + Google/Apple primary sign-in; separate phone verification required for marketplace participation; optional seeker ID.
- Android/iOS and responsive marketplace web plus separate staff portal in full core scope. Text messaging, offline mobile saves, viewings, bilateral double-blind reviews, moderation/appeals and analytics are core.
- TypeScript/pnpm/Turborepo, Expo, Next.js, NestJS, Drizzle + SQL/PostgreSQL/PostGIS, transactional outbox/SQS, S3/CloudFront, ECS/RDS/Vercel/EAS and CDK.
- Southwest/Littoral initial publishing, other regions preregistration, English/French, XAF default. Maps and advanced features follow documented later gates.

ADRs are accepted for implementation, not “Proposed but somehow authoritative.” Chosen defaults and explicit amendments are recorded in the migration record. Vendor coverage, local evidence/privacy validation, costs and recovery performance remain evidence gates; no document claims those checks were performed.

## Guidance for implementation work

Read this index, the product requirements relevant to the task, and the relevant domain/ADR files before changing code. Preserve requirement IDs and acceptance intent. Do not invent simpler roles, generic status fields, universal verified flags, unvalidated offering blobs or client-only permission checks. Do not introduce omitted product behavior as an accidental implementation decision.

For each slice: identify requirements → implement smallest coherent path → run meaningful validation → update only affected documents → report evidence and remaining gate. Avoid generating another broad document series before coding. Resolve feature-specific contracts as the feature is built, while keeping current domain decisions intact.

Never label a scaffold “architecture ready” or a documentation checklist “production ready.” G1–G6 require actual evidence. Mocks and synthetic data cannot satisfy a live verification/SMS/restore gate. No new cloud provisioning, real evidence collection, deployment, external messaging or public launch is implied by editing these documents.

## Repository integration and next authorized task

This delivery updates documentation only. Replace the matching canonical files under `docs/`, inspect the diff, preserve unrelated repository files and commit a separate documentation change. Existing historical SQL/DOCX remains noncanonical until reconciled; no schema has been executed. Do not keep parallel files named `domain-model(1).md` or “final-v2” as authorities inside the repository.

Next engineering deliverable after the documentation commit is the running local foundation: monorepo/apps, pinned dependencies, local PostGIS, reviewed migration framework, health/readiness, contracts, logging and CI. Then identity/permissions and the verified-provider-to-inquiry vertical slice. Full MVP requires the later core stages and evidence gates.

## Archive policy

[Archive guidance](archive/legacy-docx/README.md) and the source snapshot preserve history only. Do not import archived rules into code unless a recorded product change restores them. Git is the ongoing versioning mechanism; update canonical files in place, with migrations/compatibility notes as implementation begins.
