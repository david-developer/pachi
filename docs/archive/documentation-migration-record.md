# Pachi — Documentation Reconciliation Record

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Request and scope

On 24 September 2026, the project owner asked to modify the documents and settle specification/architecture discrepancies before implementation because coding agents will use them as their foundation. This record describes that authorized reconciliation. It does not invent historical approvals, claim independent reviews, or assert any engineering work has been completed.

Sources: original V2 product specification and domain model; uploaded standalone Markdown files; consolidated pre-scaffolding ZIP. Some ZIP files already fixed references and bilateral-review wording that remained stale in standalone uploads. Both versions are preserved in [source snapshot](pre-reconciliation-sources.zip); the canonical files now present one rule set.

## Decisions resolved

| ID | Issue | Baseline 2.1 decision / rationale | Canonical owner |
|---|---|---|---|
| REC-01 | Property/listing/offering distinction lost | Restore ProviderAccount, ProviderPropertyRelationship, Offering/OfferingVersion and ListingRevision; retain commercial validation/history. | Product §§3,7–9; domain model |
| REC-02 | Universal verified authority gate added | Current declaration sufficient ordinarily; risk hold/adverse claim requires verified authority/remediation. Preserves supply onboarding and explicit trust meanings without pretending every property has verified title. | Product §§6,7,20; verification |
| REC-03 | Provider types/organization roles narrowed | Restore OWNER/INDEPENDENT_AGENT/PROPERTY_MANAGER and organization principal; five membership roles including LISTING_MANAGER/ANALYST. | Product §§3–5; permissions |
| REC-04 | Single owner and vague delegation | Multiple owners supported; protect final owner transactionally. Only OWNER appoints owners/admins; AGENT handles assigned drafts/interactions, cannot submit/publish. | Permissions |
| REC-05 | Listing states conflated | Restore separate publication/moderation/market axes and exact enums; material changes re-reviewed; publishability shared by all public endpoints. | Product §8; lifecycle |
| REC-06 | Cameroon/offline/freshness details omitted | Restore Southwest/Littoral activation, XAF, English/French, mobile offline saved listings and configurable purpose-specific expiry. | Product §§1,10,16,20 |
| REC-07 | Interaction and viewing collapsed | Interaction holds business context and Conversation; Viewing is a child appointment with schedule/attendance history. | Product §§11–12; domain model |
| REC-08 | Unilateral completion ambiguous | Both confirm or one confirmed claim plus 48-hour uncontested notice window; no silent completion without a claim. No-show separate/disputable. | Interaction rules |
| REC-09 | Reviews reopened as optional/immediate | Bilateral provider-principal/seeker reviews, 14-day double-blind, org target, first completed viewing per interaction, whole stars, optional text. | Review system |
| REC-10 | Review edit/aggregate behavior unspecified | Held-only edits, published content locked, withdrawal consumes slot, public aggregates at ≥3 published eligible reviews, disputed/hidden reviews excluded. | Review system |
| REC-11 | Appeals conditional | Core linked verification/moderation appeals within 30 days, immutable original actions, honest sole-operator reconsideration and personal-conflict limits. | Verification / interaction rules |
| REC-12 | Authentication changed without explicit product amendment | Retain managed Cognito email/password + Google/Apple; separate phone ownership remains mandatory for participation. This intentionally replaces phone-first primary login; internal user IDs and domain claims stay application-owned. | Product §§2,18,20; ADR 0002 |
| REC-13 | Public web scope unclear | Retain later public/authenticated marketplace web requirement alongside mobile, with separate staff Next.js application. Core MVP includes responsive web; it is built iteratively after the first slice. | Product scope; architecture |
| REC-14 | Competing stack proposals | Retain Drizzle + reviewed SQL, SQS/outbox, AWS managed services/CDK, Vercel/EAS; explicitly supersede Kysely/Redis/BullMQ implementation proposals. No implemented code is being migrated. | ADR 0001 / architecture |
| REC-15 | Maps pulled into foundation as dependency | Canonical structured geography/PostGIS core; manual entry works without vendor. External maps/autocomplete/distance gated early-release integration; Google candidate requires evidence. | Product §10; ADR 0004 |
| REC-16 | Infrastructure assumptions overtake implementation | Set clear local/staging/prod topology and recovery targets; no live provisioning implied. Identify identity recovery separately from database backups. | ADR 0003 / operations |
| REC-17 | Analytics/gates reduced to generic statements | Restore V2 requirement IDs/event taxonomy and G0–G6; add exact inclusion rules, initial pilot targets/sample sizes and explicit evidence requirements. | Product §§17–19; readiness |
| REC-18 | Proposed ADRs treated as settled | All six ADRs and canonical design docs now Accepted implementation baseline. Evidence checklists remain NOT RUN. | Documentation index and all headers |
| REC-19 | Broken paths/parallel authorities | Canonical tree uses only existing files; normalize terminology/status/date and archive prior variants. | Documentation index / validation report |
| REC-20 | Operational/security choices left to agent guesswork | Specify media limits/quarantine/scanning, private access, notification defaults/retries, session lifetimes/step-up, OTP limits, account/owner recovery and gate-specific validation. | ADRs 0002/0005/0006; domain/operations |

## Newly selected defaults, not historical facts

This reconciliation selects configuration values to make implementation actionable: freshness RENT 30/SALE 60/SHORT_LET 14 days; request expiry 48 hours; attendance response 48 hours; review window 14 days; appeal window 30 days; minimum aggregate 3 reviews; invitation expiry 7 days; offline cache 100 listings/200 MiB; ID/business/authority review validity up to 12 months; OTP TTL 5 minutes/5 attempts; staff idle 30 minutes/absolute 8 hours/step-up 15 minutes; marketplace session maximum 30 days/idle 7 days. Detailed owners remain the corresponding canonical documents.

Initial pilot targets and media/notification limits are engineering/operational defaults, not research claims. They must be versioned and evaluated with real evidence. Changes before pilot are recorded explicitly; no retroactive manipulation of the scorecard. Previously opened review/attendance windows retain their stored policy version.

## What was preserved

All original V2 normative requirement IDs remain in the canonical product specification. The full core covers user/provider/organization models, three commercial purposes, verification, publication/moderation, discovery, saves/offline, messaging/call intent, viewings, bilateral reviews, reports/blocking/appeals, notifications, admin operations, analytics, localization/accessibility and evidence-based gates. Deferred roadmap capabilities remain explicit: maps, compare, voice/attachments, advanced alerts/promotions, deeper analytics, payments/booking, automated identity, recommendations, VoIP and later transaction workflows.

Security detail retained includes backend authorization, case-scoped private evidence, immutable audit/action history, session revocation, secrets/environment isolation, constrained uploads/scan/metadata stripping, outbox/idempotency/DLQ, recovery/deletion reconciliation, cost controls and safe incident rollback. Redundant prose and unresolved alternative lists were consolidated into operative decisions.

## Remaining evidence, with fixed gates

E01 privacy/evidence/retention; E02 Cameroon SMS/email/push; E03 current cost/region/account security; E04 full restore including identity; E05 scorecard/inventory/operating coverage; E06 gated map feature; E07 real authentication/recovery. These require actual external facts or implementation tests and are deliberately not marked resolved by writing. The architecture/contracts and disabled-until-passed behavior are settled, so a coding agent need not invent a fallback policy.

## Repository and delivery status

Canonical files were revised in this deliverable; no user's local Git repository was modified, no documentation commit/push was made, no scaffold was created and no migrations were executed. Replace matching files under `docs/`, inspect the diff and make a separate documentation commit. Preserve unrelated repository content and use Git for subsequent versions.

See [validation report](validation-report.md) for the actual document checks run on this package. Passing document validation is not passing G1, G4 or G5.
