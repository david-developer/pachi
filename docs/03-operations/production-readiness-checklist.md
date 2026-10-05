# Pachi — Foundation, Pilot and Production Readiness

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## How to use this checklist

This checklist covers staged gates, not just infrastructure launch. An item without explicit recorded evidence remains NOT RUN; document acceptance alone is not a test result. Current implementation and dated evidence are recorded in the single [engineering handoff](../engineering/current-state.md); gate completion requires every applicable item, not an authentication milestone. G0, G1 and G2 are recorded complete below; G3–G6 remain incomplete. G2 is the recorded individual-provider synthetic/local TEST slice, not real-account, pilot or production acceptance.

For each completed item record commit/release, environment, date, operator responsibility, evidence link, result and any expiry/retest condition. `[ ]` means not demonstrated; `[x]` may be used only with evidence. Failed, not-run and not-applicable are distinct; not-applicable needs a reason tied to scope. The project owner may hold multiple responsibilities but must not invent independent staff sign-off.

No exception can waive unauthorized access, private-evidence exposure, unresolved critical security/data-loss defects, missing core marketplace functionality or an untested recovery path. A noncritical exception records affected requirement, mitigation, expiry, owner and release impact; it cannot silently redefine the product.

### Temporary dependency-audit exceptions

The dependency audit remains configured at the `low` threshold. A temporary exception is not a remediation and is permitted only when the exact GHSA is named, no released compatible fix exists, dependency provenance and runtime/build exposure are assessed, compensating controls are recorded, and an owner, review-by date, and removal trigger are explicit. Every other advisory remains blocking at the configured threshold. Wildcards, registry-error suppression, reduced severity, and ignore-unfixable behavior are not permitted.

Current temporary exceptions (verified 2026-10-05):

- **Advisory:** `GHSA-86w9-cpqp-85rv`.
- **CVE:** `CVE-2026-85393`; HIGH severity (CVSS 8.7).
- **Package:** `node-forge@1.4.0`; no patched release is currently published. Upstream fix PR [digitalbazaar/forge#1152](https://github.com/digitalbazaar/forge/pull/1152) is open and targets the unreleased 1.4.1 changelog entry.
- **Provenance:** lock graph places the package in `apps/mobile` through `expo@55.0.0` → `@expo/cli@55.0.11` → `node-forge` and `@expo/code-signing-certificates@0.0.6` → `node-forge`; Expo Router adds equivalent paths. It is not a direct Pachi dependency.
- **Runtime/build exposure:** the production dependency listing for `@pachi/mobile` includes this Expo tooling/signing path. The API, marketplace web, admin and worker production dependency graphs do not include `node-forge`. No direct Pachi source import was found. The mobile bundle's reachability of this code has not been established; the dependency is not claimed harmless.
- **Reason:** the registry's patched-version status is unknown, npm's latest release remains 1.4.0, and the current compatible Expo SDK 55 CLI/signing dependency ranges do not remove the vulnerable release.
- **Compensating controls:** audit severity stays `low`; the guard enforces exactly the two approved GHSAs and requires a separate complete record for each; every other advisory continues to fail the dependency check. No unaudited fork or unreleased node-forge commit is used.
- **Owner:** Project owner / repository maintainer.
- **Review by:** 2026-10-16.
- **Removal trigger:** remove the exception when a patched node-forge release becomes available through compatible Expo tooling, or when a compatible Expo update removes the vulnerable dependency. Re-run the unfiltered audit and the full CI pipeline after removal.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES.

Second temporary acceptance, necessitated by an advisory surfaced after PR #23's branch CI; exact-main Checks 37236836981 failed at dependency audit:

- **Advisory:** `GHSA-vfj7-8cjw-p6xm` ([GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
- **CVE:** `CVE-2026-93687`; HIGH severity, CVSS v4 8.7 (v3.1 7.5), verified from GitHub's advisory API on 2026-10-05. Deeply nested brace patterns can exhaust the stack and terminate a Node.js process.
- **Package:** `braces@3.0.3`; affected versions `<=3.0.3`, no patched version, [npm latest](https://registry.npmjs.org/braces/latest) remains 3.0.3. Upstream fix PRs [micromatch/braces#72](https://github.com/micromatch/braces/pull/72) and [#75](https://github.com/micromatch/braces/pull/75) remain open/unmerged/unreleased.
- **Provenance:** `pnpm why braces`, recursive production queries and the lockfile establish three families: mobile Babel/Jest (`react-native@0.83.0` → `babel-jest@29.7.0` → `@jest/transform@29.7.0` → `jest-haste-map@29.7.0` → `micromatch@4.0.8` → `braces@3.0.3`, also direct transform/message-util paths); mobile Metro/Expo (`react-native@0.83.0` → `@react-native/community-cli-plugin@0.83.0` → `metro@0.83.8` → `metro-file-map@0.83.8` → `micromatch@4.0.8` → `braces@3.0.3`, plus `expo@55.0.0` → `@expo/cli@55.0.11` → `@expo/metro@54.2.0` → `metro-file-map@0.83.3` → `micromatch@4.0.8` → `braces@3.0.3`); root/shared lint tooling (`@typescript-eslint/parser@8.44.0` → `@typescript-eslint/typescript-estree@8.44.0` → `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces@3.0.3`). pnpm audit reports 100 representative/deduplicated paths, not an exhaustive count.
- **Runtime/build exposure:** mobile's installed production dependency graph includes the React Native/Expo Babel/Jest and Metro tooling families. API, marketplace web, admin and worker production graphs have no braces path, but all use shared development lint tooling. No direct Pachi source import exists. Shipped runtime reachability and attacker-controlled pattern reachability are not established; lack of a direct import does not make the vulnerability harmless. Production bundle inspection is recorded separately in the engineering handoff.
- **Reason:** no released compatible remediation eliminating all vulnerable paths was found. [Latest micromatch 4.0.8](https://registry.npmjs.org/micromatch/latest) still declares `braces ^3.0.3`; compatible React Native 0.83.10 retains Babel/Jest 29.7 and Metro file-map 0.83.8 retains micromatch. Expo SDK 55.0.31 / CLI 55.0.36 does not eliminate those paths. Newer Jest/ESLint releases remove some individual paths, but do not remove all current mobile tooling paths. No application dependency or lockfile is changed.
- **Compensating controls:** strict audit threshold remains `low`; the guard enforces exactly two approved GHSAs, per-record metadata and short review windows. All other advisories and registry errors remain blocking. No wildcard, package-name suppression, ignore-unfixable option, unreviewed fork or unreleased commit is used. Maintain existing bounded inputs and review any future glob/pattern integration; no claim that current controls fix stack exhaustion.
- **Owner:** Project owner / repository maintainer.
- **Review by:** 2026-10-16.
- **Removal trigger:** remove this exception on a patched braces release or compatible upstream dependency update eliminating all vulnerable paths. Re-run the unfiltered audit, mobile exports and full CI pipeline; node-forge's separate deadline remains unchanged.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES.

## Gate summary

| Gate | Required result | Current evidence state |
|---|---|---|
| G0 Specification | Reconciled V2.1 baseline, explicit authority and decisions, stable requirements, no competing canonical versions. | COMPLETE — canonical package is present and committed; the factual implementation-status wording has been reconciled. |
| G1 Architecture foundation | Running scaffold plus implemented environment/migration/CI/auth/security/logging/backup foundations. | COMPLETE — foundation evidence and real mapped-ungranted staff denial verified. See [acceptance evidence and separate operational limitations](../engineering/current-state.md#real-mapped-ungranted-acceptance-passed-g1-evidence-complete--2026-09-28). |
| G2 Vertical slice | Verified provider → property/listing/offering/media → moderation/publication → discovery → inquiry/response, with server authorization and analytics. | COMPLETE — recorded synthetic/local individual-provider acceptance, merged PR #27 and exact merge-main Checks 37305379014. See [closure evidence and limitations](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05). |
| G3 Marketplace alpha | Full core mobile/web/staff, organization, viewing/review, offline, reporting/appeal, notification and analytics behavior. | NOT RUN. |
| G4 Private pilot | Real-data/vendor/operations gates, seed inventory, scorecard and rehearsal in Cameroon launch regions. | NOT RUN. |
| G5 Public MVP | Pilot scorecard and reliability/safety requirements pass; release/rollback verified. | NOT RUN. |
| G6 Regional expansion | Sustained supply, moderation capacity and local readiness for each new region. | NOT RUN. |

## G0 — Documentation and repository

- [x] Replace canonical docs with this package, including roles-and-permissions and all six ADRs; inspect diff and commit a documentation-only change. Evidence: canonical package on main and the [mainline integration record](../engineering/current-state.md#integration-completed-on-main--2026-09-28).
- [x] Remove/mark superseded parallel authorities; preserve archives with explicit noncanonical status. Evidence: [authority and archive policy](../README.md#authority-and-conflict-rule).
- [x] Validate links, decision defaults, entity/lifecycle names and requirement coverage; retain the reconciliation record. Evidence: [documentation migration record](../archive/documentation-migration-record.md) and this 2026-09-30 status reconciliation.
- [x] Confirm repository and handoff describe the implemented foundation and G1 accurately without claiming production readiness. Evidence: [current engineering handoff](../engineering/current-state.md).

## G1 — Foundation

- [x] Clean clone installs with pinned runtime/package versions and frozen lockfile; API/mobile/web/admin and worker skeleton start/build as applicable. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] Local PostgreSQL/PostGIS, migration framework, synthetic seeds and environment validation work without production credentials. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] CI checks type/lint/build, relevant tests, secrets/dependencies, migration and contract consistency. Evidence: [exact 26f0b4b CI and check design](../engineering/current-state.md#current-g1-closure-status).
- [x] Health/readiness, safe error envelope, request IDs and redacted logs are implemented. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] Threat/data boundaries cover identity, private evidence, organization scope, location privacy, client trust and external adapters. Evidence: [bounded implementation review and findings](../engineering/current-state.md#threat-boundary-review-of-implemented-foundation).
- [x] Auth session registry, phone participation gate, staff MFA/step-up design and permission test harness demonstrated in isolated environments; production mock-auth rejection tested. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] Current membership/account/session revocation denial tested; database constraints and stale-write/idempotency conventions demonstrated. Evidence: [current G1 work](../engineering/current-state.md#g1-closure-work-in-progress--2026-09-28), actual module/guard HTTP harness with isolated memberships; no organization product endpoint is exposed.
- [x] Backup/restore mechanism demonstrated in nonproduction; environment/secret separation and future deployed restore procedure recorded. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).

## G2 — Working marketplace slice

- [x] Individual provider required verification workflow and explicit current property declaration operate with protected synthetic evidence. Evidence: PR #27 fixed-sample intake, encrypted persistence, scoped staff review/current VERIFIED claim and DECLARED property in the [recorded TEST acceptance](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05); real intake remains E01-gated.
- [x] Property, Listing, Offering/OfferingVersion and revision constraints are implemented; wrong-purpose terms and mismatched authority denied. Evidence: PR #27 real commands/current CLEAR authority and wrong-purpose denial, plus preserved mismatch/stale-version [component evidence](../engineering/current-state.md#canonical-status-reconciliation-and-g2-evidence-matrix--2026-09-30).
- [x] Image upload/quarantine/processing/approval works; failed/private assets cannot be public. Evidence: PR #27 local pipeline, READY then separate APPROVED decision, anonymous denial before publication, plus preserved failure/privacy [component evidence](../engineering/current-state.md#canonical-status-reconciliation-and-g2-evidence-matrix--2026-09-30).
- [x] Staff reviews exact listing revision; publication predicate enforced for API/search/detail. Evidence: PR #27 exact submitted snapshot, scoped signed staff publication/replay and anonymous search/detail/media in the [recorded acceptance](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05).
- [x] Seeker discovers, creates/reuses inquiry/Conversation, messages, receives provider response; cross-user/organization access denied. Evidence: PR #27 coherent inquiry/message/reply/replay and unrelated/historical-participant denials; organization fail-closed denial remains preserved [component evidence](../engineering/current-state.md#canonical-status-reconciliation-and-g2-evidence-matrix--2026-09-30), not positive organization messaging acceptance.
- [x] Domain events and analytics distinguish publication/contact/first response; retries do not duplicate business effects. Evidence: PR #27 exact five events/five JobReceipts, second drain 0/0, unchanged source flags, TEST privacy and mature response metric in the [recorded acceptance](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05).
- [x] Recorded end-to-end demonstration and meaningful policy/integration test evidence pass. Evidence: [PR #27](https://github.com/david-developer/pachi/pull/27) merged unchanged; [exact merge-main Checks 37305379014](https://github.com/david-developer/pachi/actions/runs/37305379014) PASS, all 27 stages, DB44/API13/web21/admin7 including the coherent G2 journey. See [closure and external limits](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05).

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
| NOT RUN | — | — | — | Evidence not recorded for this item | Project owner | Complete affected work |

Add real records as work is completed. Do not replace NOT RUN with PASS because a document was edited.
