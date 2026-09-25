# Pachi — Launch-Day Runbook

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Scope and prerequisites

Execute only for an authorized pilot/public release after the relevant [readiness gate](production-readiness-checklist.md) passes. This is a procedure, not evidence that Pachi is built. The [operations runbook](deployment-and-operations-runbook.md) governs deployment, migrations, rollback, recovery and incidents.

Project owner is launch coordinator, engineering operator and decision owner unless additional people are actually appointed. Application privilege roles remain separate. Do not list imagined stakeholders or send messages without an approved recipient/channel and launch authorization.

## Release record

Before execution fill in: release ID, commit SHA/artifact digests, API/worker/web/admin/mobile versions, migration IDs, environments/regions, launch type, start time/timezone, owner, relevant G4/G5 evidence, feature flags/region limits, budget caps, previous compatible artifacts, backup point and rollback decision deadline. Empty required fields mean NO-GO.

## T−48 to T−24 hours

- [ ] Confirm intended core scope and supported clients; no unreviewed scope/stack switch.
- [ ] Review gate evidence and unresolved defects; all critical blockers closed with evidence.
- [ ] Confirm real-evidence/privacy/retention, SMS/email/push, auth/MFA/recovery and cost gates remain valid.
- [ ] Verify fresh seed inventory, required verification, authority policy and regional publishing controls.
- [ ] Rehearse release and rollback in staging, including migration compatibility and queued old-version jobs.
- [ ] Confirm backup/restore evidence, accessible recovery credentials and identity/media recovery plan.
- [ ] Confirm English/French onboarding/help/privacy/appeal flows and moderation/safety coverage.
- [ ] Prepare factual user/support update drafts if required; identify actual channels/recipients.

## T−2 hours

- [ ] Freeze unrelated changes; review final diff/config/flags and artifact identifiers.
- [ ] Check provider service status, credentials/certificates, DNS/callbacks, quotas and daily spend limits.
- [ ] Check synthetic probes, dashboards, alerts, logging redaction and request/trace correlation.
- [ ] Confirm database headroom, current recovery point, queue/DLQ/scan state and absence of unresolved incidents.
- [ ] Verify no test/mocked issuer/OTP, synthetic public listing or unsafe debug configuration is enabled in production.
- [ ] Confirm previous compatible deployment is available and migration rollback limitations are understood.
- [ ] Record explicit GO/NO-GO with evidence. For public MVP, evaluate G5 pilot scorecard; for private pilot, apply G4 constraints.

## Launch sequence

1. Record start and operator; enter maintenance/limited-write mode only if required by the reviewed migration.
2. Run the controlled migration once and verify checksums/completion. Stop if unexpected locks, data loss or compatibility errors occur.
3. Roll out API/worker to the reviewed topology using health/readiness and limited exposure.
4. Verify server authorization, public/private projections, outbox and queue processing before enabling broad user access.
5. Deploy compatible marketplace web/staff portal; release mobile through the approved channel/phased rollout, respecting installed-client compatibility.
6. Run safe production smoke scenarios using designated accounts: eligible listing discovery, contact/reply, scoped staff queue, phone participation gate, media isolation, held review denial and protected evidence denial.
7. Enable the approved regions/features/cohort gradually. Verify actual inventory, notifications and moderation capacity.
8. Record observed metrics at +5, +15, +30 and +60 minutes. Broaden only while gates remain satisfied.
9. Communicate verified availability/known issues through authorized channels if requested; no unsupported claims of completed transactions, independent verification or guaranteed safety.

## Live monitoring and stop conditions

Watch error rate/latency, auth/OTP redemption, session denial anomalies, publication/verification state, inquiry/provider reply, viewing/review events, queue age/DLQ, media quarantine, private access logs, crash reports, notification receipts/spend, database health and safety queue age.

Immediate stop/containment: any private evidence or hidden address exposure; cross-account/org access; held review exposure; unauthorized publish; missing audit for privileged action; data corruption/loss; severe billing abuse; inability to investigate a critical safety case. Disable the smallest affected capability that safely contains impact; use broader maintenance when needed.

Pause/rollback evaluation: 5xx >2% for 5 minutes with ≥100 requests (or 3 failed synthetic probes at low traffic); p95 >2 seconds for 10 minutes at the agreed load; critical queue age >5 minutes; persistent login/OTP failure materially blocking access; scanner failure with upload backlog; crash regression. Evaluate the cause and state before choosing rollback; metrics do not justify reverting into a known unsafe version.

## Rollback sequence

1. Announce internal rollback decision in the release record; stop widening access and freeze harmful jobs/writes.
2. Confirm last known-good version is compatible with current schema/data/events.
3. Roll back compatible API/worker/web/admin artifacts or disable affected feature; pause incompatible consumers.
4. For mobile, halt rollout/OTA as appropriate; preserve backend compatibility for already installed clients. Store rollback is not instantaneous.
5. Do not restore the database as routine rollback. If restore is necessary, declare recovery incident and use the full restore procedure with write reconciliation.
6. Repeat critical smoke/authorization/privacy checks and monitor recovery. Account for duplicate external delivery and stale queued work.
7. Record impact, duration, affected users/data and next decision. Public updates report verified status without exposing private incident details.

## First 24 hours

| Window | Actions |
|---|---|
| 0–1 hour | Continuous monitoring, release smoke evidence, verification/publication/contact paths, stop-condition checks. |
| 1–4 hours | Check representative mobile/web experiences, provider responses, pending OTP/delivery, queue/scan lag, safety reports and cost. |
| 4–12 hours | Review regional inventory freshness and zero-result searches; inspect failed viewings/review jobs and support issues; confirm coverage handoff or explicitly bounded cohort. |
| 12–24 hours | Confirm backup jobs, deletion/retention jobs, notification suppression/preferences, crashes, provider responsiveness and remaining incidents. Record next-day fixes and whether rollout stays limited. |

A sole operator cannot claim continuous human monitoring while unavailable. Use alerts and a genuinely available escalation arrangement, or limit intake/exposure to supported hours and pause expansion when coverage is insufficient. Automation assists monitoring but is not an independent accountable reviewer.

## Completion and communication

Close launch only after the monitored window and evidence review. Record GO maintained/limited/rolled back, metrics/sample sizes, incidents, unresolved noncritical issues, next owner/action and retest requirements. Update gates invalidated by any incident. Do not mark a failed/insufficient pilot successful because infrastructure stayed online.

Prepared external messages should state what is available, affected region/cohort, known user impact, safe help/appeal route and next update time. They require actual authorized recipients/channels before sending; this runbook itself sends nothing.
