# Pachi — Foundation, Pilot and Production Readiness

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## How to use this checklist

This checklist covers staged gates, not just infrastructure launch. **All engineering, vendor and operating evidence below is NOT RUN unless an actual record is added.** Documentation acceptance is not a test result. Current state: environment configured and documents prepared; no scaffold/implementation.

For each completed item record commit/release, environment, date, operator responsibility, evidence link, result and any expiry/retest condition. `[ ]` means not demonstrated; `[x]` may be used only with evidence. Failed, not-run and not-applicable are distinct; not-applicable needs a reason tied to scope. The project owner may hold multiple responsibilities but must not invent independent staff sign-off.

No exception can waive unauthorized access, private-evidence exposure, unresolved critical security/data-loss defects, missing core marketplace functionality or an untested recovery path. A noncritical exception records affected requirement, mitigation, expiry, owner and release impact; it cannot silently redefine the product.

## Gate summary

| Gate | Required result | Current evidence state |
|---|---|---|
| G0 Specification | Reconciled V2.1 baseline, explicit authority and decisions, stable requirements, no competing canonical versions. | Documentation package prepared; repository replacement/commit still to be performed. |
| G1 Architecture foundation | Running scaffold plus implemented environment/migration/CI/auth/security/logging/backup foundations. | NOT RUN — no implementation. |
| G2 Vertical slice | Verified provider → property/listing/offering/media → moderation/publication → discovery → inquiry/response, with server authorization and analytics. | NOT RUN. |
| G3 Marketplace alpha | Full core mobile/web/staff, organization, viewing/review, offline, reporting/appeal, notification and analytics behavior. | NOT RUN. |
| G4 Private pilot | Real-data/vendor/operations gates, seed inventory, scorecard and rehearsal in Cameroon launch regions. | NOT RUN. |
| G5 Public MVP | Pilot scorecard and reliability/safety requirements pass; release/rollback verified. | NOT RUN. |
| G6 Regional expansion | Sustained supply, moderation capacity and local readiness for each new region. | NOT RUN. |

## G0 — Documentation and repository

- [ ] Replace canonical docs with this package, including roles-and-permissions and all six ADRs; inspect diff and commit a documentation-only change.
- [ ] Remove/mark superseded parallel authorities; preserve archives with explicit noncanonical status.
- [ ] Validate links, decision defaults, entity/lifecycle names and requirement coverage; retain the reconciliation report.
- [ ] Confirm working tree status accurately states no scaffold or passed engineering gate.

## G1 — Foundation

- [ ] Clean clone installs with pinned runtime/package versions and frozen lockfile; API/mobile/web/admin and worker skeleton start/build as applicable.
- [ ] Local PostgreSQL/PostGIS, migration framework, synthetic seeds and environment validation work without production credentials.
- [ ] CI checks type/lint/build, relevant tests, secrets/dependencies, migration and contract consistency.
- [ ] Health/readiness, safe error envelope, request IDs and redacted logs are implemented.
- [ ] Threat/data boundaries cover identity, private evidence, organization scope, location privacy, client trust and external adapters.
- [ ] Auth session registry, phone participation gate, staff MFA/step-up design and permission test harness demonstrated in isolated environments; production mock-auth rejection tested.
- [ ] Current membership/account/session revocation denial tested; database constraints and stale-write/idempotency conventions demonstrated.
- [ ] Backup/restore mechanism demonstrated in nonproduction; environment/secret separation and future deployed restore procedure recorded.

## G2 — Working marketplace slice

- [ ] Individual provider required verification workflow and explicit current property declaration operate with protected synthetic evidence.
- [ ] Property, Listing, Offering/OfferingVersion and revision constraints are implemented; wrong-purpose terms and mismatched authority denied.
- [ ] Image upload/quarantine/processing/approval works; failed/private assets cannot be public.
- [ ] Staff reviews exact listing revision; publication predicate enforced for API/search/detail.
- [ ] Seeker discovers, creates/reuses inquiry/Conversation, messages, receives provider response; cross-user/organization access denied.
- [ ] Domain events and analytics distinguish publication/contact/first response; retries do not duplicate business effects.
- [ ] Recorded end-to-end demonstration and meaningful policy/integration test evidence pass.

## G3 — Core marketplace alpha

- [ ] Owner/agent/manager distinctions; five organization roles, assignments, owner transfer/recovery and final-owner race protection.
- [ ] RENT/SALE/SHORT_LET offerings and versions, three listing state axes, market availability, freshness/expiry and region publishing controls.
- [ ] English/French UI architecture and launch text, accessible navigation/forms/errors, mobile low-bandwidth states and responsive marketplace/staff web.
- [ ] Native saved/offline listings with bounded cache, last-sync/staleness labels, logout purge and honest unsent actions.
- [ ] Core text messaging/native call intent, block/report, assignment revocation and safe history when listing/provider disappears.
- [ ] Viewing request/expiry/scheduling/rescheduling/cancellation, timezones, private instructions and attendance claims/disputes.
- [ ] Bilateral first-completed-viewing eligibility; org-principal uniqueness; 14-day double-blind reveal; edit/withdraw rules and hidden-review aggregate repair.
- [ ] Provider/business/authority verification, risk-based authority requirement, expiry/revocation, appeals and evidence privacy/retention controls.
- [ ] Report/case queues, scoped moderation, immutable actions, sole-operator reconsideration/conflict policy and meaningful audit evidence.
- [ ] Durable inbox, email/SMS/push adapters, preferences/quiet hours/localization, receipt distinctions, retries/DLQ and spend caps.
- [ ] Client/domain analytics schema, dedupe, privacy exclusions, numerator/denominator definitions and operational queue dashboards.
- [ ] No open critical authorization, privacy, data-loss or security defect in core flows.

## External evidence gates

| ID | Evidence required | Responsibility / deadline | Until passed |
|---|---|---|---|
| E01 | Cameroon-appropriate evidence categories, privacy notice, retention/deletion/backup/hold policy and applicant disclosure reviewed; actual approved durations configured. | Project owner in privacy/trust responsibility; before real evidence collection, no later than G4. | Synthetic documents only; real-evidence intake disabled. |
| E02 | Real Cameroon SMS delivery/latency/redemption tests, sender/consent requirements, English/French segmentation, limits and cost; SES DNS/production quota/bounce/complaint and push receipt checks. | Engineering/operations; before real delivery, G4. | Test sinks or allowlisted consenting recipients only. |
| E03 | Hosting/account security, current cost estimate and budget, Cameroon network/region measurements, DNS/TLS, least-privilege deployment and environment separation. | Engineering/operations; before live provisioning/pilot, G4. | Local/synthetic staging work only within approved spend. |
| E04 | Deployed restore and complete regional procedure including identity/media/keys/deletion tombstones; actual RPO/RTO measured and recovery access demonstrated. | Operations; G4 and repeat after relevant changes. | No live pilot/public production. |
| E05 | Metric quality, seed coverage, numeric pilot targets/sample sizes and support/moderation coverage recorded before recruiting pilot. | Product/operations; G4. | No public release based on unmeasured success claims. |
| E06 | Map/geocoder coverage, terms/storage/attribution, privacy, key restrictions and cost. | Engineering/product; before enabling map features. | List/manual structured-location features continue; map feature disabled. |
| E07 | Cognito/social login/linking/revocation, phone changes, staff/owner step-up, recovery, developer credentials and outages demonstrated end to end. | Engineering/security; before real accounts, G4. | Isolated test identities only. |

These are evidence tasks, not permission to substitute a new stack or omit product requirements. Coding agents can implement the settled contracts while the relevant real-data feature remains disabled.

## G4 — Private Cameroon pilot

- [ ] G1–G3 and E01–E05/E07 passed; E06 only if maps are enabled.
- [ ] Southwest and Littoral launch controls work; at least 20 publishable fresh listings and 5 verified responsible providers per enabled pilot region. Other regions remain preregistration-only.
- [ ] Representative mobile/network testing, actual notification paths and accessible English/French user guidance completed.
- [ ] Terms/privacy/contact/appeal routes, verification queue, safety escalation and sole-operator coverage are operating; volume cap set to match capacity.
- [ ] Production-like staging deployment, rollback, migration recovery, backup restore and incident rehearsal recorded.
- [ ] Numeric scorecard below frozen before recruitment; any change recorded with reason before evaluating outcomes.
- [ ] Pilot accounts consent to participation; seed inventory and evidence are authorized, not fabricated as real supply.

## Pilot scorecard and G5

Initial targets below are reconciliation defaults to make the gate executable, not claimed research results. Validate instrument definitions during alpha, then confirm or explicitly amend targets **before** the pilot. Never lower thresholds retroactively simply to declare a pass.

Measurement window: at least 14 consecutive days, with at least 100 successful search sessions, 30 distinct eligible contact interactions and 10 scheduled viewings reaching appointment time. Report aggregate and by region/purpose; small segments are labeled insufficient evidence rather than hidden. A failed technical search is not a zero-inventory result. A repeated retry does not create a new event/interaction.

| Metric / condition | Initial pass target / definition |
|---|---|
| Useful search rate | ≥50% of successful search sessions receive ≥1 eligible result followed by listing/result view within 30 minutes. Report zero-results and technical failures separately. |
| Provider response | ≥80% of first eligible seeker contacts receive first provider reply within 24 hours. Exclude self/test/spam contacts with reason-coded filtering. |
| Viewing acceptance | ≥60% of valid viewing requests whose response deadline passed were accepted before expiry; report cancellations/declines separately. |
| Viewing completion | ≥60% of scheduled viewings whose appointment ended become validated COMPLETED after the 48-hour response window; pending/disputed included as not-yet-completed. |
| Listing freshness | 100% of discoverable listings satisfy expiry/required verification checks; report number/share of intended active listings that expired separately to measure supply loss. |
| Safety | Zero unresolved critical security/privacy/data-loss/authorization findings; no public private evidence or held review contents; incident/appeal paths demonstrated. |
| Reliability | Core availability target 99.5%, indexed-read p95 <800 ms at documented pilot load, crash-free mobile sessions ≥99%; report sample size and planned downtime separately. |
| Recovery | In-region RPO ≤1 hour/RTO ≤8 hours; regional RPO ≤24 hours/RTO ≤24 hours in rehearsed tests including identity and media. |
| Coverage | No unowned critical cases; queue-age alerts and response capacity demonstrated; no false promise of independent reviewers. |

If sample sizes are insufficient, extend the pilot. A 14-day pilot availability measure is interim evidence, not a claim of an observed complete month; keep the monthly target monitored after launch. G5 also requires full core scope, confirmed configuration/retention/vendor evidence, no critical defect and the [launch-day checklist](launch-day-runbook.md). Passing infrastructure checks alone is insufficient.

## G6 — Expansion

- [ ] Launch regions have sustained supply quality, provider responsiveness, safety queue capacity and reliability.
- [ ] Next region has authorized seed providers/inventory, location data, support/moderation coverage and tested delivery/network behavior.
- [ ] Region activation is a permissioned audited configuration change; no client-only enablement.

## Evidence record template

| Gate/item | Commit/release | Environment/date | Evidence link | Result | Responsibility | Retest trigger |
|---|---|---|---|---|---|---|
| NOT RUN | — | — | — | No implementation evidence yet | Project owner | Complete affected work |

Add real records as work is completed. Do not replace NOT RUN with PASS because a document was edited.
