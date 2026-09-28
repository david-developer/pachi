# Pachi — Deployment and Operations Runbook

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Scope and current status

This runbook is the accepted operating procedure for the [architecture](../02-architecture/system-architecture.md). **No scaffold, deployment, backup, CI run or production environment is claimed to exist.** Commands and service identifiers will be added from the actual repository/IaC when implemented; do not invent working commands or resource names from this document.

The project owner holds delivery, incident command, operations and product responsibilities. Staff-role boundaries still apply within the application. No step assumes a separate engineering team or grants a fictitious independent approval. A checkpoint may be a documented self-review unless a genuine conflict requires another authorized reviewer under the moderation policy.

## Environments and data

Local: synthetic fixtures, Docker PostgreSQL/PostGIS, isolated S3/SQS adapters/emulation and test identity issuer. Staging: separate AWS account/resources and Cognito pool; synthetic evidence, allowlisted test recipients and no copied production personal data by default. Production: separate account/resources, real-data gates, least-privilege access and approved budget. Optional preview deployments have separate credentials/callbacks and no production evidence.

Never reuse production secrets, database, queues or evidence buckets for local/staging tests. Production configuration rejects mock OTP/auth issuer, debug trace exposure and permissive CORS. Environment-specific Vercel/EAS settings must not leak server secrets into public build variables or mobile bundles.

## Change and release process

Use short-lived feature branches and reviewed PRs, including self-review for the sole maintainer. Each change explains the product/technical problem, resulting behavior, affected requirements/migrations and relevant validation. Commit only intentional changes; never secrets, local credentials or generated dumps. CI runs install with frozen lockfile, lint/type/build, applicable tests, secret/dependency checks, migration validation and contract compatibility.

Release artifacts are immutable and traceable to commit SHA, image digest, migration set and client version. Build once, promote the same tested artifact. Deployment role uses GitHub OIDC with environment/repository restrictions; runtime role cannot run unrestricted migrations or delete backups.

## Deployment sequence

1. Confirm affected gate/checklist, configuration diff, secret readiness, current incident state and rollback compatibility.
2. Review infrastructure diff; do not combine uncontrolled topology changes with feature rollout. Confirm backup/recovery point for risky data changes.
3. Build/verify immutable API/worker/web/admin/mobile artifacts in CI; record digest/SHA.
4. Deploy staging infrastructure/config and execute one migration job with a lock/checksum. Never migrate on each app startup.
5. Roll out compatible API/worker and clients; run smoke tests and targeted end-to-end scenarios against synthetic data.
6. Record monitoring baseline, migration duration, deployment/rollback observations and outstanding risks.
7. Before production, complete the relevant release checkpoint and announce planned user impact only through approved channels.
8. Apply production migration through the controlled role; stop on errors, do not blindly retry partially applied nontransactional DDL.
9. Roll out API/worker gradually with health checks; then compatible web/admin/mobile release. Watch queue versions and old client compatibility.
10. Run safe production smoke checks, watch gates for at least 60 minutes, record result and keep heightened monitoring for 24 hours.

Production deployment is a separate authorized action. This documentation change authorizes no cloud spend, public launch or external messaging.

## Health and smoke checks

`GET /health/live` checks process liveness without leaking dependencies/secrets; `GET /health/ready` checks ability to serve required database-backed traffic and migration compatibility, returning failure if unsafe. Optional notification/map outages degrade their features and alert separately rather than causing needless restart loops. Worker readiness includes lease/consumer connectivity and backlog visibility.

Smoke checks: browse eligible seeded listing; verify private/hidden content denial; sign-in and phone gate; create idempotent inquiry; provider reply; authorized staff queue access; processed public image; private evidence denial; request correlation in logs; outbox/queue progress. Use designated test accounts/fixtures and remove test public inventory promptly. Avoid sending real notifications to nonconsenting users.

## Migrations and rollback

Each migration records checksum/version and reviewer. Prefer transactional DDL where supported; document nontransactional index work, backfill resume keys, lock duration and rollback/forward fix. Test migrations from a clean database and a realistic previous schema snapshot. Separate expand, resumable backfill, application switch and later contract cleanup. Do not ship destructive migrations while supported clients still need the removed contract.

Application rollback redeploys the last compatible artifact; assess whether new data/queues remain readable. Pause incompatible consumers when necessary. Database rollback is normally a forward corrective migration. Restore only under declared recovery incident with write freeze and reconciliation, because restoring can discard legitimate writes. Never promise that an image rollback undoes database state.

## Backups and recovery

Targets: in-region RPO ≤1 hour/RTO ≤8 hours; regional RPO ≤24 hours/RTO ≤24 hours. Database automated recovery retention 35 days, daily cross-account/region recovery copy retained 35 days, with actual service support and lag demonstrated. Keys, permission/configuration, media, identity mappings and deletion tombstones are part of recovery. Evidence retention and backups obey E01; no indefinite identity-document copy.

Before G1, demonstrate local/nonproduction backup and restore mechanism. Before G4, restore deployed staging into a clean isolated environment and rehearse the production procedure, including authentication recovery and media. During operation, run monthly sample restores and quarterly complete recovery exercises, and after material topology/auth changes. Record restore point, elapsed time, data checks, failures, operator and follow-up.

### Restore procedure

1. Declare incident and freeze unsafe writes/jobs; preserve audit/log evidence.
2. Select verified recovery point and quantify expected data loss against RPO.
3. Restore into a new isolated database/resource set; preserve the failed source for investigation.
4. Recover required keys/secrets/configuration/media; do not enable user access yet.
5. Reapply deletion tombstones, retention/hold changes and post-backup security revocations from protected records where available; otherwise fail closed for affected sensitive access.
6. Reconcile outbox/jobs/provider effects and suppress duplicate notifications/attendance/review operations.
7. Validate counts, constraints, permission boundaries, current membership/claim visibility and latest supported schema; run core synthetic scenarios.
8. Recover identity access using ADR 0003's tested flow; never link new issuer/subject by email alone.
9. Switch endpoints/DNS only after safety checks, gradually enable writes and watch metrics.
10. Record actual RPO/RTO and user impact, communicate the verified facts, then complete corrective actions.

## Monitoring and alert thresholds

| Signal | Initial internal trigger / response |
|---|---|
| Core API failures | 5xx >2% for 5 minutes with ≥100 requests, or 3 consecutive synthetic failures at lower traffic: investigate/pause rollout. |
| Read latency | p95 >800 ms for 15 minutes at documented pilot load: investigate; >2 seconds for 10 minutes during rollout: pause/rollback evaluation. |
| Unauthorized data/permission behavior | Any confirmed incident: immediate feature disablement/containment and SEV-1. |
| Database capacity | Free storage <20% or sustained connection/CPU pressure >80% for 15 minutes: investigate scale/query/connection leak; preserve headroom. |
| Queue | Critical queue oldest age >5 minutes, ordinary notification >15 minutes, any persistent DLQ: inspect, avoid blind replay. |
| Media | Processing backlog >15 minutes or scanner/signature refresh unavailable: quarantine remains closed; investigate. |
| Verification/listing queue | Unassigned/undecided item age >24 hours: alert operator and reduce intake if coverage insufficient. |
| High/critical safety cases | High age >4 hours; critical immediate alert. |
| Backups/deletion | Missed backup, restore failure, evidence deletion overdue or unexplained access: urgent investigation. |
| Provider spend | 50/80/100% of approved daily/monthly budget alerts; application hard cap for SMS, preserve safe notice/fallback. |
| Client stability | Crash-free sessions below 99% with meaningful sample: pause release and assess rollback. |

Thresholds are initial configuration, not measured performance claims. Pair low-volume metrics with synthetic probes. Alerts carry owner, environment, safe context and runbook action; no sensitive payloads. Report planned downtime separately. Correlate traces, request IDs, domain events and provider receipt IDs without logging tokens/OTP/evidence/message text/private addresses.

## Incident response

SEV-1: active privacy/security breach, widespread unavailable core marketplace or data integrity loss. SEV-2: substantial degraded core function or delivery/recovery risk. SEV-3: limited noncritical defect with workaround. Record start/detection time, impact, affected versions and incident owner.

First: contain and preserve evidence; stop harmful jobs/writes; disable affected feature/region if narrower than full shutdown; revoke compromised sessions/credentials and restrict access; verify blast radius; choose rollback/forward fix/recovery. Do not erase logs, mass-delete evidence, rotate every unrelated secret without dependency planning, or claim resolution before verification.

Notify users only with approved factual updates and required privacy/legal handling under the operating policy. Keep internal technical details and private data out of public notices. Record decisions and aftercare. A post-incident review identifies causes, corrective changes, affected gates and owner/due dates; reopen launch readiness when a gate is invalidated.

## Specialized recovery

Queue DLQ: inspect cause/current domain state; fix processor or data; replay bounded batch with event dedupe; monitor; record outcomes. Never replay expired OTP/reminder or a revoked authority publication job.

Media failure: retain quarantine, pause acceptance if capacity exhausted, repair processing/scan dependencies, rerun idempotently and verify no private/public leak. Notification failure: preserve inbox, suppress invalid destinations, reconcile ambiguous provider sends and spend caps before retry.

Compromised credentials: identify issuer/session/role, revoke application sessions, rotate affected keys with staged deployment and verify old credentials denied. Suspected evidence exposure: deny new evidence URLs, preserve access records, assess affected objects and invoke incident/privacy process.

Mobile release defect: halt phased rollout/compatible OTA channel; respect native runtime compatibility and store rollback limits; keep backend compatible with supported installed versions. Never assume a web-style rollback instantly removes a mobile build from devices.

## Retention, access and maintenance

Apply classification-specific retention with deletion tombstones, hold review, orphan checks and restore reconciliation. Audit privileged access and periodically review staff grants/inactive members. Do not use public tracking/analytics for evidence. Record version upgrades, restore results, operational budget and outstanding gate evidence in the repository's normal change/release history.

The [readiness checklist](production-readiness-checklist.md) decides gates; the [launch-day runbook](launch-day-runbook.md) executes the approved launch. Procedures become completed only through recorded evidence.
