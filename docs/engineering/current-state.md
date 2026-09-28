# Engineering handoff

## Test-factor activation authorized and verified — 2026-09-28

- Started clean on feat/staff-auth-permissions at
  624906e700a06770ce7356e7936305774bc21941; its exact CI run 36410123701
  completed SUCCESS. Comparison base unchanged; completed G1 evidence reused.
- User explicitly superseded the earlier leave-MFA-unchanged decision and
  authorized activating the existing factor for the ungranted fixture. Verified
  source STS account451475820431 / IAM user pachi-david-dev; exact AdminGetUser
  username and returned sub both f2a534d4-f011-70c9-e6b8-643b3289c687,
  Enabled=true, CONFIRMED, MFA list/preference absent before mutation.
- Executed ONE AdminSetUserMFAPreference through pachi-dev-source at
  2026-09-28T10:34:57.322259Z: dedicated pool eu-west-1_7uju5eCyw, exact fixture
  above, SoftwareTokenMfaSettings Enabled=true, PreferredMfa=true. SUCCESS.
  No password reset, reassociation, pool/client policy change or grant write.
- Independent pachi-staff-runtime readback: matching sub, UserMFASettingList
  [SOFTWARE_TOKEN_MFA], PreferredMfaSetting SOFTWARE_TOKEN_MFA. Existing admin SDK
  diagnostic resolves PachiStaffRuntimeReadOnly; all nineteen pool/client checks
  PASS and existing attestRequiredTotp for this exact subject PASS. This proves
  current configuration, not completion of the real-browser acceptance or step-up.
- Existing admin listener PID514185 retained; no service restart needed for fresh
  uncached policy reads. Marketplace services/data and all environment files/secrets
  preserved. No application/schema changes or local application-suite reruns;
  focused live readback/validator and documentation whitespace check performed.
- Next user action: close previous private windows, open a fresh private window
  at http://localhost:3002, select staff sign-in, use the separate ungranted test
  account and its current password/authenticator code directly in Cognito. Report
  return to Pachi without sending credentials. Then inspect the newest callback
  for matching signed issuer/sub, freshness, pool/user MFA PASS and denial at
  staff registration specifically because this mapped identity has no eligible
  grant; independently recheck mapping/zero grants. Generic failure page alone
  does not count. No grant will be added or changed.
- G1 remains INCOMPLETE pending that browser evidence. Existing privileged grant
  remains untouched (recorded expiry 2026-09-28T19:35:57.049Z); unexplained web
  hang remains a separate unresolved root-cause item. This checkpoint's exact CI
  is separate from the verified 624906e pass; report its status without repeated
  polling while waiting for browser participation.

## Bounded ungranted-case diagnosis — 2026-09-28

- Started clean at 72fa84f4bbe551d4129434a6a82df39ed67963c3 on
  feat/staff-auth-permissions; comparison base unchanged. Reused its passing
  exact-commit Checks run 36408131447 and completed G1 evidence; no application,
  environment, service, migration, membership or grant changes. Only this handoff
  changed. Root/apps/web/apps/admin environment files and secrets preserved.
- Read-only runtime AdminGetUser again matches exact dedicated username/sub
  f2a534d4-f011-70c9-e6b8-643b3289c687: Enabled=true, CONFIRMED, both
  UserMFASettingList and PreferredMfaSetting absent. LastModified is
  2026-09-28T03:48:16.125Z; that generic timestamp does not prove MFA enrollment.
- New evidence: after verifying source STS as
  arn:aws:iam::451475820431:user/pachi-david-dev, read-only
  AdminGetUserAuthFactors for that exact pool/username returned
  ConfiguredUserAuthFactors=[PASSWORD,EMAIL_OTP,SOFTWARE_TOKEN], with both MFA
  preference/list fields absent. Runtime permissions were not expanded. A software
  token is reported as configured, but no MFA method is activated. EMAIL_OTP in
  available factors is not evidence of enabled email MFA or a changed pool policy.
- Enrollment completion remains only partially established: configured-factor
  state persists, but neither this response nor CONFIRMED proves the historical
  VerifySoftwareToken SUCCESS result or why activation was not persisted. A bounded
  CloudTrail LookupEvents for VerifySoftwareToken at 03:30–04:10Z was denied with
  AccessDeniedException. No permissions added; no raw event bodies exposed. An
  already-authorized account administrator could inspect that enrollment window
  for this exact subject and return only operation/time/result/target-match, if
  such events are available. Absence of accessible audit evidence is not proof
  that enrollment failed.
- Existing callback c2eb8ada-1b14-4c44-92df-8eabef06f3ec at 03:58:03.010Z
  established the signed identity/freshness but stopped at expired AWS credentials;
  it did not record Cognito's enrollment result. Current readback still fails the
  unchanged provider.ts requirement for UserMFASettingList=SOFTWARE_TOKEN_MFA
  (MFA_UNPROVEN), before grant checks. Known mapping/zero-grant evidence preserved.
- **Blocked on explicit user decision:** this acceptance cannot proceed with MFA
  left in its present state. The smallest proposed next operation, only if newly
  authorized, is activating the existing software-token factor for this exact test
  subject (AdminSetUserMFAPreference, SoftwareTokenMfaSettings Enabled=true,
  PreferredMfa=true), with readback; stop if Cognito rejects the registered factor.
  This is a real configuration change, not read-only proof or completed acceptance.
  No such operation was executed; no reset/reassociation, browser retry, policy
  change or grant mutation requested/performed. If activation is declined, keep
  the case blocked; investigate historical enrollment through an authorized
  administrator if desired. Any subsequent enrollment recovery needs a separate
  decision, with all codes/passwords browser-only.
- G1 remains INCOMPLETE. No authenticated mapped-but-ungranted grant denial yet.
  Marketplace web hang remains a separate unresolved root-cause issue; prior
  recovery/browser confirmation is preserved. No application tests rerun for this
  documentation-only checkpoint; git diff --check is the focused check. Its new
  exact-commit CI must be reported separately from the reused 72fa84f pass.
- Official semantics consulted: [factor inspection](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUserAuthFactors.html),
  [software-token verification](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_VerifySoftwareToken.html),
  [MFA activation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminSetUserMFAPreference.html).

## AWS access restored; test-user MFA remains blocked — 2026-09-28

- Arrival on feat/staff-auth-permissions at a7d793cfaed6fcb1ebf707a21cef3ae6b3d4902b;
  its exact Checks run 36401298840 PASSED. Existing uncommitted operational notes
  below were preserved. No application changes or migrations in this follow-up.
- User completed AWS CLI local browser callback and reported credentials saved.
  Independently verified STS: source profile pachi-dev-source is account451475820431,
  arn:aws:iam::451475820431:user/pachi-david-dev; runtime CLI and admin SDK both
  resolve arn:aws:sts::451475820431:assumed-role/PachiStaffRuntimeReadOnly/ sessions.
  Stopped only task-owned redirect helper PID648985; CLI exited normally. No
  marketplace/admin/API/worker process stopped, no environment secret changed.
- All nineteen inspected pool/client policy checks PASS through runtime: required
  TOTP-only MFA, local/admin-created identities, password12, managed login2,
  confidential client equality, code flow, exact callback/logout, pachi/staff,
  revocation, rotation/grace10, SRP-only, access5m; refresh lifetime480minutes.
- Exact test username/sub f2a534d4-f011-70c9-e6b8-643b3289c687: SDK and independent
  CLI AdminGetUser agree Enabled=true, UserStatus=CONFIRMED, UserMFASettingList
  absent/null, PreferredMfaSetting absent/null. Existing attestRequiredTotp fails
  at mfa_policy_validation with MFA_UNPROVEN. Not an SDK parsing difference,
  wrong-user read or AWS credential failure. No MFA setting changed.
- Rechecked dedicated issuer/sub mapping to 0a855b6b-31bc-4b8a-ac79-b8a311e5c7df;
  zero StaffGrants. Original user's exact SUPER_ADMIN/platform pachi/only
  admin:permissions_manage grant unchanged, not revoked, expiry
  2026-09-28T19:35:57.049Z. No privileges written or renewed.
- User explicitly chose **Leave MFA unchanged** after the targeted recovery was
  proposed. No AdminSetUserMFAPreference, reset, reassociation or preference update
  was executed. Do not infer permission for this fixture from the earlier original-
  subject recovery. No further browser retry requested because current policy
  validation fails before grant checks. Any future enrollment/configuration change
  requires a new explicit user decision; preserve this boundary while blocked.
- G1 remains INCOMPLETE: real mapped-but-ungranted browser grant-denial proof not
  obtained. Prior callback stopped at expired AWS credentials; current MFA-policy
  failure cannot be relabeled grant denial. No browser retry requested yet.
  Existing real original-staff evidence, current-schema isolated restore and
  marketplace recovery preserved; web hang root cause remains unresolved.


## G1 closure work in progress — 2026-09-28

Historical work record: the AWS-restored/MFA-blocked section above is current.

- Started clean on feat/staff-auth-permissions, HEAD 6b39452610993598b10a406d9435897578c3a410; comparison base unchanged. Exact CI eb3fb7bf4a78c11cf45dc14d6e93a246928e0811 / run 36348972375 and 6b39452610993598b10a406d9435897578c3a410 / run 36349003275 both PASSED. Prior real staff authentication/logout/reauth/revocation and restore evidence preserved below.
- In-progress edits: failing CI security and OpenAPI/shared-type/route checks, patched dependencies, organization settings authorization foundation and isolated HTTP test. No organization product routes or mutation workflows added. Migration 0015 applied ONLY to localhost:5433/pachi_test; development baseline remains 0014. Local lint/typecheck/unit, database integration (8/8), API HTTP integration (5/5), contract drift negative tests and mobile exports pass; both implementation checkpoints passed exact-commit CI as recorded below.
- Dependency audit initially found high/moderate/low advisories; patched direct packages and scoped transitive overrides produce zero known advisories. Mobile build exposed image-size v2 filename API incompatibility in older Metro; compatible Metro 0.83.8 patch now passes Android/iOS/web export. No advisory suppressions.
- Secret scan full history found exactly two synthetic fixtures (fixed nonfunctional test secret and idempotency key); exact historical fingerprints only are documented in .gitleaksignore. Scanner canary fails on an ephemeral generated private key; normal scan passes. Contract check caught/fixed 3 missing route declarations and DTO enum/required-field drift; negative mutation tests added.
- New owner-authorized ungranted Cognito fixture created using verified source IAM identity arn:aws:iam::451475820431:user/pachi-david-dev; invitation delivery SUPPRESSED. Dedicated issuer unchanged; new subject f2a534d4-f011-70c9-e6b8-643b3289c687 mapped through audited operator command to application user 0a855b6b-31bc-4b8a-ac79-b8a311e5c7df. Verified mapping, SUCCESS staff:identity audit, ZERO grants. Private mode-0600 input/temporary-password files outside Git under ~/.local/share/pachi/g1-ungranted; no email/credentials included here.
- User reports password/TOTP browser completion. Latest callback c2eb8ada-1b14-4c44-92df-8eabef06f3ec at 2026-09-28T03:58:03.010Z matched signed issuer/subject fingerprint 6775da8d1ed3aeea52f5631c4af1bcbec72664f5a0b3bf5fd3f82aa8bee0f927, passed freshness, FAILED aws_credential_resolution. Prior 03:50:13 attempt same stage. Independent runtime CLI confirms expired source login. Pool/user MFA and grant checks NOT REACHED. Not an ungranted-denial pass. User authorized browser-based AWS login renewal; CLI started and remains waiting for the browser authorization response through a private local FIFO. No policy or MFA changes.
- Existing active grant unchanged: SUPER_ADMIN/platform pachi/only admin:permissions_manage, expires 2026-09-28T19:35:57.049Z, not revoked. No renewal.
- Marketplace hang cause remains UNRESOLVED. Orphaned Next parent and blocked listener were observed; restart restored responsiveness and user confirmed all workspace content. No evidence proves why it hung. Keep distinct from successful recovery.
- Remaining acceptance action: complete the already-started AWS browser renewal using the private instructions file, then verify runtime readback and one fresh test-identity login. Latest attempt failed before MFA policy and grant checks; do not retry the browser until credentials/policy reads work. If the CLI reports expiration, start a new authorized remote login and replace only its private instruction/FIFO files.
- Root .env, apps/web/.env, apps/admin/.env secrets preserved. No marketplace accounts/memberships modified; admin remains runtime-profile configured. G1 INCOMPLETE pending current work and real mapped-ungranted evidence.


### Current G1 closure status

- Saved response was submitted privately, but CLI reported authorization-request
  mismatch (not expiry). Source/runtime credentials remain expired. To remove
  manual-copy/stale-link errors, started the already-authorized AWS login with
  local callback port8400 and a no-log loopback redirect at http://localhost:8401.
  User completes the browser flow as pachi-david-dev; no code/file editing needed.
  Helper PID648985 and CLI PID648841 are task-owned and must be cleaned up after
  completion. No application service, Cognito setting or grant changed.

- Follow-up: user reported pasting a new AWS authorization code, but the exact
  private authorization-code.txt on disk remains zero bytes, unchanged since
  2026-09-28T08:58:16Z; no response was consumed. The bounded watcher timed out.
  Source and runtime STS still report expired credentials; SDK validation cannot
  proceed. Next action: save the editor buffer to that exact private file and
  notify the agent; never paste the code into chat. User then reported editor access difficulty. Verified files/directories owned by david, mode0600/0700, no lock. Prepared fresh authorized renewal with ignored repository-local .local-dev/aws-login-instructions.txt and .local-dev/aws-authorization-code.txt; user instructed to open actual VS Code editor via Ctrl+O and save via Ctrl+S. Old identified waiting login process stopped; no service, MFA or grant changes made.

- Checkpoint **26f0b4b20598ac7e7b3e488e4b8fb24cb576806e** exact CI
  [36376252388](https://github.com/david-developer/pachi/actions/runs/36376252388)
  PASSED, including new fail-closed secret/dependency/contract checks, test
  migration, 8 database integrations, 5 API HTTP integrations, lint/typecheck/unit,
  full API/mobile/web/admin/worker build and both Playwright browser suites.
- Follow-up strengthens schema equality to reject unexpected optional fields;
  four negative contract mutations and current contract check PASS locally.
  Exact follow-up **49a21e2ff8ff5a463b3a3bc892f3f45ff05d245d** CI
  [36376512323](https://github.com/david-developer/pachi/actions/runs/36376512323)
  PASSED all steps, including both browser suites. Final documentation-only
  handoff commit is tested separately; inspect Checks for its exact HEAD rather
  than substituting either earlier run. Documentation checkpoint **5f7098e9ebde839250ce3c0c27de007d2f869046**
  [36376739482](https://github.com/david-developer/pachi/actions/runs/36376739482)
  also PASSED all steps. Operational checkpoint **8d685200a68611b9503c43ed187db4a67f3345b1**
  [36400923672](https://github.com/david-developer/pachi/actions/runs/36400923672)
  PASSED all steps too. The final restore-evidence documentation commit is
  verified against its own exact HEAD; see final response/Checks run.
- All eight canonical foundation criteria now have supporting implementation/test
  evidence (retaining the prior restore result); the separately requested real
  mapped-but-ungranted staff browser acceptance remains BLOCKED, so G1 is still
  held INCOMPLETE. No new product routes or G2 work started.
- AWS renewal was authorized and initiated with `aws login --profile
  pachi-dev-source --region eu-west-1 --remote`; private instructions/input FIFO
  under ~/.local/share/pachi/aws-renewal, no credential values in Git/log output.
  Waiting for user's browser completion. Next: verify source and assumed role,
  read this exact new subject's MFA settings through runtime, validate pool/client,
  then one controlled private-window login. Do not count prior credential failure
  as ungranted denial or change MFA preferences to conceal it.
- First renewal authorization response was supplied via a private local file and
  submitted without output; AWS rejected it as expired. Started a fresh already-
  authorized renewal; watching separate private authorization-code.txt and
  submitting/clearing it automatically. Never share authorization codes in chat.
- Current-schema restore rerun justified by migration0015: source remains isolated
  localhost:5433/pachi_test; offline target pachi-g1-restore-1790586119/pachi_restore.
  PASS: 29 public table counts/full-row hashes, extensions and constraints match,
  zero invalid indexes, source unchanged. 40.58 seconds; SHA256
  4585f5b0c4f6af510df7731fdf745a6481690727677627349043921bdb9ba43a.
  Private dump/evidence retained outside Git; only disposable target removed.
  Prior 27-table evidence preserved; no deployed RPO/RTO or E04 claim.
- Current service probes web3000/admin3002/API3001 readiness all 200. Admin PID
  514185 still has pachi-staff-runtime; web PID595940 test issuer disabled.
  Historical web.log contains 12 ECONNREFUSED and 4 fetch-failed strings, no OOM
  or EPIPE evidence; recovery log contains none. No timestamps/stack establish
  causality with orphaned listener's hang. Root cause remains UNRESOLVED, separate
  from recovered service/current browser pass. No restart in this closure work.
- Development DB retained at migration0014; new0015 exercised only on pachi_test.
  Environment locations, account/provider data and secrets unchanged. Current
  grant expiry remains **2026-09-28T19:35:57.049Z**, no renewal or broadening.

### Threat-boundary review of implemented foundation

Review scope: accepted product PERM-001–004/ORG-003, roles-and-permissions,
ADRs 0002/0004/0005; current routes, stores, media worker and browser/session
boundaries. This is an implementation review, not independent penetration testing
or certification of unimplemented G2+ features.

| Boundary / abuse attempt | Implementation and evidence | Finding / disposition |
|---|---|---|
| Identity: forged/wrong-client/ID token, email takeover, revoked family reuse, stale staff grant | token-verifier + IdentityStore issuer/subject uniqueness/session tombstones; StaffStore live grants; token-verifier, identity integration, staff HTTP tests and preserved real Cognito evidence | Existing checks pass; no email linking introduced. Real separate mapped-ungranted test currently blocked at expired AWS credentials, not mistaken for grant denial. |
| Private evidence/media: other owner reads/uploads, public original/storage-key exposure, failed scan treated as approval | PropertyController authenticated private routes; ListingMediaStore provider joins on reads/mutations; private no-store derivative responses; media tests include cross-owner/scan outage/EXIF/checksum; submission hard blocks missing approvals | No evidence-review/public-delivery route exists. Unimplemented evidence/approval remains unavailable. This passes foundation separation, not E01 or a future evidence ACL. |
| Organization: stale membership in valid JWT, forged client role, cross-org settings access | OrganizationSettingsGuard exported from real AuthModule + OrganizationAccessStore live SQL; new signed-token HTTP harness uses test-only protected route and actual DI/authentication | Closed missing foundation boundary. Same registered session: active ADMIN 200, revoked/suspended/invited/expired/declined 403, cross-org/AGENT/ANALYST 403, restricted account/org 403, revoked session 401. No public org workflow or assignment grant exposed. Future final-owner/assignment/mutation audits remain product-slice requirements before those routes exist. |
| Location privacy and SQL input | Current property projection is owner-only and exposes neighborhood/landmark, no public exact-location endpoint; media re-encoding strips metadata | FOUND geography custom type interpolating arbitrary input into sql.raw (unused today). FIXED bound EWKT parameter; injection-shaped input regression asserts payload never enters SQL text. Future public precision rules remain required before public discovery. |
| Client trust: forged ownership/role/state, CSRF/cookies, stale revisions | AuthGuard establishes principal from verified token; ownership stores ignore caller principal claims; web/admin origin+CSRF checks; server-encrypted sessions; version/idempotency tests; failed readiness submission 422 | No business outcome can be authorized by client display state. Contract drift found and corrected; CI route/schema negative mutations added. Deferred phone/federation/recovery launch evidence not relabeled as passed. |
| External adapters: malicious media, scanner outage, mock provider in production, dependency compromise | Media limits/signature/scan/re-encode; fail-closed scanner; API production config rejects local SMS/test issuer; staff AWS policy reads fail closed; runtime IAM remains separate; CI security checks | Dependency advisories fixed with pinned patches/overrides. Secret history checked with two exact synthetic false-positive exceptions; no broad allowlist. SDK credential expiry observed as denial (no bypass). Local development adapters do not certify deployed cloud isolation. |

No remaining exploitable G1 defect was found in this bounded review after the
SQL and organization/security-check fixes. Unimplemented business flows stay
unavailable; their acceptance tests are not claimed. Implementation exact-commit CI PASSED;
real mapped-ungranted browser proof remains pending. Marketplace hang remains an
unresolved operational finding, despite successful restart and browser recovery.

## G1 evidence reconciliation — 2026-09-27

Historical checkpoint: the 2026-09-28 closure section above supersedes outstanding
work/status here; the completed authentication/restore evidence remains valid.

- Acceptance/restore checkpoint: eb3fb7b (pushed, no merge). Follow-up records
  the user-confirmed marketplace recovery. Exact checkpoint CI
  [36348972375](https://github.com/david-developer/pachi/actions/runs/36348972375)
  is IN PROGRESS at handoff, not yet a pass; do not substitute the earlier
  8a8b07f result. Next action: inspect that result and the follow-up documentation
  commit CI; address the three canonical G1 gaps only in separately authorized work.

- Arrival clean on feat/staff-auth-permissions at
  8a8b07f641053c4cd8e4f2be682de6142f1e4020; base remains
  6d8f8899498d52010e45646c6ebe16901b9cf291. Exact CI
  [36347024098](https://github.com/david-developer/pachi/actions/runs/36347024098)
  PASSED; inspected its individual steps, not another commit's result.
  Existing real login/TOTP/logout/replacement/provider-revocation evidence below
  remains valid. No repeat of completed browser checks or active-grant mutation.
- Operator: repository agent acting under the project owner's explicit acceptance
  instruction; environment local development plus isolated synthetic database/CI.
  This reconciliation records current results, not independent security sign-off.

### Staff acceptance evidence

| Case | Result and evidence kind | Remaining action |
|---|---|---|
| Real dedicated password/TOTP login and exact role/scope | PASSED, prior real browser + signed claims + DB/audits | Retest on material auth changes or resource changes. |
| Logout/local denial/cookie clearing; TOTP reauth/session replacement; provider revocation | PASSED, prior browser observations + direct server checks + real pre/post refresh rejection; browser HTTP status was not independently recorded | Preserve limitations: fixed revoke helper was verified directly with actual tokens, not a repeated browser logout. |
| Valid authenticated mapped staff identity with no grant | PASSED, isolated signed-token verifier + actual StaffStore registration rejects RESOURCE_SCOPE_DENIED; extended apps/api/src/staff.http.integration.test.ts makes mapping/valid claims explicit | Real-provider/browser mapped-but-ungranted case NOT RUN; requires a separate nonprivileged test identity and its own browser entry. Do not repurpose current user's grant. Earlier real denial was absent mapping only. |
| Expired/revoked/insufficient grants | PASSED, existing actual Nest HTTP controller returns 403 for isolated fixtures; targeted suite rerun passes | Synthetic signed tokens, not modified live grants. |
| Marketplace credentials rejected by staff endpoints | PASSED, REAL unexpired existing Cognito marketplace bearer: /v1/account/provider 200 then /v1/staff/session 401 with the same token; no token output/refresh/persistence | Server HTTP evidence, not a browser interception. Existing synthetic wrong issuer/client/scope/ID-token/cookie tests also pass. |
| Continued marketplace/provider operation | API PASSED (real provider bearer 200); user confirmed browser spinning, matching 25-second HTTP timeouts. Recovered web / 200 (5.94s initial compile), /api/session 200 (0.51s) after targeted restart; user then confirmed existing workspace, drafts, photos and readiness all display correctly | PASSED current real-browser regression by user observation after recovery; no provider-data mutation performed. |

- Current grant independently read: SUPER_ADMIN/platform pachi with ONLY
  admin:permissions_manage, not revoked, expires **2026-09-28T19:35:57.049Z**.
  Active at this inspection; no renewal. After that time eligible-grant denial is
  authorization expiry, not evidence that Cognito password/TOTP authentication broke.
- Admin/API probes 200; web recovered as above. Environment files remain root .env,
  apps/web/.env, apps/admin/.env; values/secrets unchanged. Current staff identity,
  provider accounts and records preserved. Web parent 379452 was orphaned under PID 1; listener 379506 blocked in anon_pipe_read. Required inherited web settings matched intended files. Sent SIGTERM only to those identified web PIDs, then detached `pnpm dev web` with persistent private log output (launcher parent 595670, new listener 595940). Underlying hang cause is unproven. Admin PID 514185 unchanged; API watcher automatically reloaded shared-package build output during the established launcher, no API launcher stopped.

### Canonical G1 requirements (each whole requirement)

| Canonical requirement | Status | Evidence / exact remaining work |
|---|---|---|
| Clean checkout, pinned install, app/worker start/build | PASSED | Exact CI above: fresh checkout, Node .nvmrc 24.21.0, pnpm 12.0.0, frozen lockfile, full API/mobile/web/admin/worker build. This build evidence does not erase current web runtime timeout. |
| Local PostgreSQL/PostGIS, migrations, synthetic seeds, environment validation | PASSED | CI isolated localhost:5433/pachi_test migration and fixture suites; startup isolation tests; local test container and successful restore/hash check. Development migration baseline 0014 unchanged. |
| CI type/lint/build/tests, secrets/dependencies, migration/contract consistency | FAILED (coverage gap) | Type/lint/build/test/migrations/browser steps PASS. .github/workflows/checks.yml has no secret scan, dependency vulnerability check, or explicit OpenAPI/contracts consistency check. Next add/review those missing checks and demonstrate exact-commit results; do not equate typecheck with contract parity. |
| Health/readiness, safe error envelope, request IDs, redacted logs | PASSED for implemented foundation | API readiness 200; unauthenticated staff 401 and unknown route 404 use safe error/message/statusCode envelope and x-request-id. requestIdMiddleware logs path without query; redaction unit test passes in CI; safe staff logs preserved. Audited admin/web log files show zero callback-query request entries. |
| Threat/data boundaries for identity, private evidence, organization scope, location privacy, client trust, external adapters | NOT RUN as a complete boundary review | Canonical architecture/ADRs/roles document designs; isolated ownership/staff tests cover implemented surfaces. No complete recorded adversarial review mapping all six named boundaries to implementation/evidence was found. Next perform that bounded review and record gaps; do not implement deferred business features merely to declare it passed. |
| Session registry, phone participation gate, staff MFA/step-up design/permission harness in isolation; production mock rejection | PASSED for G1 foundation | Exact CI config.test rejects production test issuer/local SMS, phone/identity/store guards pass; real staff MFA/reauth + actual permission guard and simulated 15-minute boundary evidence below. Full E07/social/owner recovery remains a later separate gate. |
| Current membership/account/session revocation, constraints, stale-write/idempotency | NOT RUN in full | Account/session/grant denial and concurrency/idempotency/version tests pass. Organization membership/revocation coverage is not present in current implementation/tests; next identify/implement the authorized membership foundation and demonstrate its revocation boundary in isolation. Do not start it as part of this auth acceptance task. |
| Nonproduction backup/restore mechanism, environment/secret separation, future deployed procedure | PASSED for local G1 mechanism | Approved operations runbook Restore procedure; successful isolated synthetic restore below; existing launcher separation tests/ignored secrets. Deployed RDS/media/identity/key/regional recovery E04 NOT RUN, not claimed by local success. |

Thus G1 is INCOMPLETE: three whole requirements above remain failed/not-run.
The post-recovery marketplace browser check PASSED by explicit user confirmation. No provider verification/media approval/publication
work is authorized. Native-device acceptance and later E04/E07 cases are not silently
added as new G1 requirements.

### Isolated backup/restore evidence

- Approved procedure: docs/03-operations/deployment-and-operation-runbook.md,
  Backups and recovery / Restore procedure. Corrected docs index's broken plural
  filename link. Added reproducible `python3 scripts/check-local-restore.py` and
  README usage. Source guard accepts only existing pachi-postgres-test-1 with
  localhost:5433/pachi_test; never development pachi_local.
- Source dump from synthetic test DB restored into new container
  pachi-g1-restore-1790541146, database pachi_restore created from template0;
  same locally available PostGIS image, network none, no published port, PostgreSQL
  UNIX socket only. No app/worker attached: no jobs, notifications or user access.
- Initial trials FAILED only in disposable target: temporary initialization server
  readiness race, then pre-created tiger schema collision. Final procedure waits
  for PID 1 postgres and creates a clean template0 database; final run PASSED.
  Source unchanged throughout; no development restore or service stop.
- Successful run 28.87 seconds. All 27 public table row counts AND deterministic
  full-row hashes match; extensions and constraint counts/validation status match,
  invalid indexes 0. Source before/after manifest identical (no intervening data
  changes, zero observed loss for this synthetic snapshot). Not a deployed RPO/RTO
  claim. Removed only the newly created restore container and anonymous volumes.
- Private dump and sanitized result JSON retained outside Git, mode 0600 under
  ~/.local/share/pachi/g1-restore (0700). Successful dump SHA256
  0c2512aba1cfaf095698fc8764ec0a4555c8a791f05418e2a43bc0d521d71242.
  No production/development personal data included. E04 needs actual deployed
  isolated infrastructure and authorized recovery resources; not provisioned here.
- Affected checks: targeted signed-token staff HTTP integration PASS on guarded
  localhost:5433/pachi_test; API typecheck/lint PASS; restore script syntax check
  PASS and actual execution above; git diff --check PASS. Reused valid exact CI
  evidence for unchanged full suite rather than repeating it. No migrations run.

## Provider revocation fixed and real refresh denial verified — 2026-09-27

- Arrival clean on feat/staff-auth-permissions at
  bcd826294439859aeff0a1336a1f17b2cd587df8; comparison base unchanged. Exact CI
  https://github.com/david-developer/pachi/actions/runs/36346342132 passed.
  Earlier real login/logout/TOTP replacement evidence is preserved below.
- Reproduced old revocation using a retained refresh token from an already locally
  revoked session, decrypted in process memory only. Actual configured staff
  /oauth2/revoke HTTPS POST returned HTTP 401 invalid_client. Request diagnostics
  showed Basic auth absent, client_secret in form body. openid-client defaults to
  ClientSecretPost; Cognito confidential revocation requires Basic. This is a
  rejected request, not a network or empty-body response defect. No IAM changes.
- New revocation-only Configuration uses exact staff issuer/domain/client with
  ClientSecretBasic, form refresh token and 10-second timeout. Code-exchange and
  refresh configurations unchanged. Empty 200 handled by library without JSON
  parsing. Sanitized failure status/allowlisted reason and correlation timestamp/ID
  retained; success logged as response_accepted, not proof of token invalidity.
- Ordering verified: callback registers new session, then passes saved previous
  session ID to revoke. Local UPDATE commits revoked_at and returns that row's
  encrypted refresh token; row locking serializes with refresh rotation's locked
  transaction. Provider receives old session's latest token, not replacement's.
  Provider failure is caught after local denial and does not prevent logout cookie
  destruction or replacement-cookie save. No tokens/headers/raw exceptions logged.
- Controlled REAL verification completed without browser action for BOTH historical
  locally revoked target-user session families (signed times 19:39:40 and 19:54:48).
  Each old token successfully refreshed BEFORE fixed revocation; returned access
  identity was validated. Rotated refresh stayed in memory and was revoked through
  the new implementation: Basic auth, HTTP 200, empty body. After 11 seconds
  (beyond 10-second rotation grace), BOTH original and rotated refresh tokens were
  rejected with HTTP 400 invalid_grant for each family. This proves loss of refresh
  capability beyond ambiguous 200 responses. No tokens persisted or printed.
- Current replacement session remains authorized with the exact single grant;
  old baseline remains AUTH_REQUIRED. No active-session token was refreshed or
  revoked, no global sign-out, settings/account/data reset or marketplace changes.
- Validation: admin tests 10/10; admin/database typecheck and lint pass. Isolated
  localhost:5433/pachi_test staff integration passes, including old-token retrieval,
  old-session denial and replacement-session/token preservation. Unit regressions
  exercise actual library Basic/form request, empty 200, safe 401 diagnosis and
  continued local denial on provider failure. No development DB test/migration.
  Dev bundle contains corrected helper; unauthenticated /api/session returns 401.
  No service restart required. Full browser logout with the new helper was not
  repeated; previous real local cookie/logout evidence remains separately recorded.
- Next/remaining: no browser action needed for this provider defect. Real mapped
  identity without grant and real marketplace-token rejection remain distinct
  outstanding browser cases versus existing automated coverage. Sensitive business
  endpoints not implemented; G1 still requires broader security/environment and
  backup/restore evidence. Do not claim G1 or production readiness.
- Official endpoint contract:
  https://docs.aws.amazon.com/cognito/latest/developerguide/revocation-endpoint.html

## Real TOTP reauthentication and server freshness verified — 2026-09-27

- User reports Reauthenticate with TOTP requested email/password and authenticator
  code, then returned to signed-in page. Callback
  c407a5db-dbec-4b95-af6e-7434e1050003 records login_complete.
- Server evidence: FRESH_REQUIRED_TOTP/SUCCESS login audit at
  2026-09-27T19:57:18.474024Z; new signed authenticated_at 19:57:17Z replaces
  prior 19:54:48Z. Expected dedicated issuer/sub/client/application user and exact
  original single grant unchanged. New session passes StaffStore.read; old saved
  reauth-baseline session revoked at 19:57:18.482Z and now rejects AUTH_REQUIRED.
  Prior logged-out session remains revoked. Absolute expiry is eight hours from
  new signed authentication; fresh idle bound is 30 minutes. No raw credentials.
- Actual server requireStaffPermission evaluated against live stored session/grant
  at real current time accepts admin:permissions_manage/platform pachi. Separate
  deterministic clock checks (no writes/time changes) accept 15 minutes minus
  1 ms, reject exact 15 minutes and future authentication with STEP_UP_REQUIRED.
  These boundary checks are synthetic-time evaluations, not 15-minute browser
  observations. No sensitive business endpoint is implemented/exercised here.
  Thus real reauthentication/session replacement and backend freshness guard are
  demonstrated; displayed deadline alone was not used as proof.
- provider_revoke_failed recurred immediately before this login_complete in the
  process log. Local old-session invalidation passes, but Cognito refresh-token
  revocation remains unresolved/unverified. Existing revoke helper logs only a
  fixed event and reuses USER_LOGOUT audit reason for reauthentication replacement;
  do not misclassify the replacement as a separate user logout action.
- Browser logout/cookie observations and direct revocation evidence remain in
  earlier sections. Mapped-but-ungranted real-browser denial and real marketplace
  token rejection remain unverified separately from automated tests. G1 also
  requires remaining foundation/backup-restore/environment/security evidence;
  this staff workflow does not complete that gate or production readiness.
- No code/cloud/identity/grant/service changes. Shared handoff only. Exact prior
  checkpoint 7d63e0801c5fbec1a1b468c7ae79541032c46c8f CI passed:
  https://github.com/david-developer/pachi/actions/runs/36346011349.
  Next bounded follow-up: diagnose provider revocation failure with safe reason
  diagnostics; preserve local fail-closed checks and existing authenticator.

## Fresh login baseline for reauthentication — 2026-09-27

- User reports signed in after verified logout. Callback
  8fd47b05-4015-4c76-90b5-4270eadd235b is login_complete; SUCCESS
  FRESH_REQUIRED_TOTP audit at 2026-09-27T19:54:49.595601Z. New signed
  authenticated_at 19:54:48Z; expected issuer/sub/application user and exact single
  grant match. New session passes StaffStore.read; prior logged-out session still
  fails AUTH_REQUIRED. New baseline identifier saved outside Git mode 0600 for
  subsequent replacement/revocation comparison; no session credential exposed.
- Log inspection also found provider_revoke_failed before this successful login.
  This limits earlier logout evidence: local server revocation/cookie removal
  remain verified, but Cognito refresh-token revocation was not proven. That event
  lacks timestamp/request ID; do not claim precise correlation or provider logout
  completion. Preserve this limitation for follow-up; no bypass/settings changes.
- Next user action: while signed in click Reauthenticate with TOTP, complete fresh
  password and authenticator prompts in Cognito, report actual prompts/outcome.
  Then verify new signed authentication time, same identity/grant, replacement
  session, previous-session revocation and server freshness enforcement. No
  sensitive business mutation is authorized; G1 remains incomplete.
- This is an uncommitted evidence-only handoff update; no application/service or
  Cognito changes. Real step-up acceptance remains pending this interaction.

## Real logout verified — 2026-09-27

- Browser observations supplied by user: clicked Sign out; same-browser
  /api/session returned {"error":"AUTH_REQUIRED"}; pachi_staff_session absent
  from storage; remains signed out. User did not record HTTP status, so do not
  claim a browser-observed 401. No browser Back/cache observation supplied.
- Independent server evidence: original session (authenticated_at 19:39:40Z)
  revoked_at 2026-09-27T19:47:07.283Z; staff:logout/USER_LOGOUT/SUCCESS audit at
  2026-09-27T19:47:07.290243Z for expected application user. Exact saved baseline
  session passed before logout and now StaffStore.read(id,false) rejects with
  AUTH_REQUIRED. No session credentials printed or browser cookie replayed.
  Grant remains active and unchanged; denial is revoked-session enforcement.
- Logout verification passes on combined user browser and direct server evidence.
  A cached page alone cannot authorize a server request. Next ask only for fresh
  login, then inspect new session before separately directing Reauthenticate with
  TOTP. Compare signed authentication time, old/new session revocation and actual
  permission freshness enforcement; displayed deadline alone is insufficient.
- No application changes, settings changes, service restarts or tests needed.
  Code checkpoint 126dc1a exact CI passed (link below). This documentation checkpoint
  records access/logout evidence; recent step-up and G1 remain incomplete.

## Post-grant browser access verified; logout/reauthentication pending — 2026-09-27

- HEAD 126dc1a518e6936625b4d71629b33f843e044238; exact CI
  https://github.com/david-developer/pachi/actions/runs/36345004900 passed.
  User reports fresh private-window password/TOTP login shows Signed in, Pachi
  development staff, SUPER_ADMIN/platform pachi/admin:permissions_manage.
- Latest successful callback e6573bb4-ca71-4d3b-bc5a-5988853be793; successful
  FRESH_REQUIRED_TOTP audit at 2026-09-27T19:39:41.68017Z. One staff session,
  signed authenticated_at 19:39:40Z, dedicated issuer/sub/client match, application
  user fe485557-df32-4ae5-935f-732beeac5059. StaffStore.read(id,false) passes
  current DB session/account/identity/grant checks. Exact single active grant
  73dcd4f8-ca2c-4476-8ef8-3229a71bca67 matches authorized scope and expiry.
  Absolute deadline 2026-09-28T03:39:40Z; no raw session/token/cookie output.
- Baseline session identifier stored privately outside Git for logout comparison;
  this is not a browser cookie. No browser connector access to user's session.
  Requested user click Sign out, inspect /api/session for AUTH_REQUIRED/401 and
  confirm pachi_staff_session cookie absence via browser storage name only.
  Back may show stale rendered content; a fresh network request determines access.
- Await logout report, then independently verify revoked_at, staff:logout audit
  and baseline StaffStore.read rejection. Only after that request new login, then
  existing Reauthenticate with TOTP; compare sessions/authenticated_at, previous
  session revocation and actual server permission freshness behavior. UI deadline
  alone is not evidence. Sensitive business endpoints are not implemented here.
- No settings/data/service changes; mapped-but-ungranted real browser denial and
  real marketplace-token rejection remain separate from existing synthetic tests.
  G1 and recent step-up remain incomplete. This handoff update is uncommitted.

## Audited initial staff mapping and grant completed — 2026-09-27

- Branch feat/staff-auth-permissions; arrival HEAD
  63d571111f7397e50896dcfc090f64166c973b4b. Preserved prior uncommitted preflight
  note. Exact arrival CI https://github.com/david-developer/pachi/actions/runs/36344215075
  passed. User explicitly resolved scope to admin:permissions_manage.
- Reverified intended DB localhost:5432/pachi_local and zero mappings/grants,
  including inactive, for dedicated issuer/sub. Verified operator through source
  STS: arn:aws:iam::451475820431:user/pachi-david-dev. Runtime profile used only
  read-only Cognito verification; full MFA-policy validator passed before writes.
- Existing operator entrypoints failed before executing any statements: .ts was
  compiled as CommonJS despite top-level await. Corrected operator entrypoints to
  .mts with explicit typed CommonJS loading of existing admin config/provider;
  package scripts, README commands and typecheck inclusion updated. No operator
  audit/policy behavior changed. Regression spawns all three real entrypoints with
  no input and no DB credentials to verify they reach usage validation. Failed
  loader attempts created no mappings or grants; zero state rechecked before retry.
- Used existing audited staff:identity and staff:grant commands after fix. Separate
  application user fe485557-df32-4ae5-935f-732beeac5059 (PENDING_PHONE), display
  name Pachi development staff. Dedicated issuer/sub mapping verified, no email
  match or marketplace merge. Exactly one grant:
  73dcd4f8-ca2c-4476-8ef8-3229a71bca67, SUPER_ADMIN,
  {"kind":"platform","id":"pachi","permissions":["admin:permissions_manage"]}.
  Explicit expiry 2026-09-28T19:35:57.049Z, computed 24 hours from command execution
  preparation. Grant active/not revoked; no additional permissions.
- Readback confirms exact mapping/user/scope/expiry/operator. Immutable SUCCESS
  audits for staff:identity and staff:grant, request IDs respectively
  e5c83457-18be-404a-8fc5-5e3d1f240b6f and a89c0b9d-58cd-4c7e-99ce-f7ef5564acbe.
  Reason identifies explicit development bootstrap and verified absent-mapping
  denial a14497f6-cc1e-4cc2-9731-4752e31d0082. Operator inputs outside Git at
  ~/.local/share/pachi/staff-bootstrap-1790537755010, directory 0700/files 0600.
- Checks: admin tests 7/7 including CLI-module regression, typecheck and lint pass;
  diff check passes. Real writes only authorized mapping/grant/audits in development.
  No marketplace data edits, Cognito changes, migrations or service restarts.
- Next: fresh private-window staff login, confirm correct user, SUPER_ADMIN and
  exact platform scope; correlate callback/session evidence, then guide logout and
  verify invalidation. Pre-grant real denial was ABSENT MAPPING, not an existing
  mapped user without grant. Mapped-but-ungranted denial has synthetic integration
  evidence; real-browser case remains unverified. Marketplace-token rejection has
  automated coverage reported in earlier handoff, no new real-browser evidence.
  Actual post-grant access/logout, recent step-up and G1 remain incomplete.

## Bootstrap preflight; exact permission clarification pending — 2026-09-27

- Arrival clean at 63d571111f7397e50896dcfc090f64166c973b4b on existing branch.
  Exact CI run 36344215075 was in progress at inspection. This evidence update
  is uncommitted; no application changes or tests required.
- User authorizes audited separate staff identity and 24-hour SUPER_ADMIN grant,
  but specifies platform/pachi permissions [admin]. Existing accepted README
  bootstrap scope and staff-policy allowlist use [admin:permissions_manage];
  validStaffScope independently returns false for requested admin and true for
  documented permission. Do not invent an admin alias or broaden policy.
- Reverified source STS ARN arn:aws:iam::451475820431:user/pachi-david-dev.
  Established environment loader confirms localhost:5432/pachi_local. Read-only
  exact issuer/subject query finds zero mappings (including inactive) and zero
  associated grants. No email matching or user-data changes.
- Asked user whether to use the documented admin:permissions_manage permission
  or stop before provisioning. No identity/grant write pending explicit resolution
  of exact scope. Once resolved, use existing audited staff:identity, then the
  returned application user ID with staff:grant; operator inputs outside Git mode
  0600, actual 24-hour expiry computed at execution. Preserve runtime isolation.
- Existing browser denial remains absent-mapping evidence only. Mapped-but-ungranted
  real-browser test, staff authenticated access/logout, recent step-up and G1 remain
  unverified; automated evidence must remain separately labeled.

## Real login reaches expected ungranted denial — 2026-09-27

- Latest callback a14497f6-cc1e-4cc2-9731-4752e31d0082 at
  2026-09-27T19:19:51.078Z: staff_session_registration, grant_denied.
  This category maps exclusively to RESOURCE_SCOPE_DENIED and access_denied.
- Validated fingerprint matches dedicated issuer
  https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_7uju5eCyw and subject
  b2e594a4-1081-7083-a81b-874d8e4f5d01. Callback control flow proves signed
  token/local identity validation, authentication freshness, all AWS reads and
  complete pool/client/user required-TOTP validation PASSED before registration.
  User reports password and current authenticator code entered in a fresh private
  window. This is real authentication/MFA-policy evidence under accepted ADR 0002;
  not a privileged session, demonstrated step-up interface or G1 readiness.
- Read-only exact issuer/subject query confirms ZERO active AuthIdentity mappings.
  register reached mapping/authorization gate and denied before grants lookup
  (short-circuit when no mapping). No staff session granted. This is expected
  ungranted denial, not continuing MFA failure. No email lookup/linking used.
- Settings/authenticator/services/data preserved; no identity or grant written.
  No further login needed to establish this diagnosis. Next await explicit scope
  for audited identity/grant provisioning; do not provision in this task.
- Arrival clean at 17fe9524177844063635b055507e0481e496aded on existing branch;
  exact CI https://github.com/david-developer/pachi/actions/runs/36343787598 passed.
  This checkpoint updates only the handoff; no code changes/tests needed.

## Authorized existing TOTP activation — 2026-09-27

- Branch feat/staff-auth-permissions, code HEAD 03bcd5e4c511274fe07d2610477b008456582987.
  Preserved preceding uncommitted diagnostic evidence. Its exact CI passed as
  recorded below. No application changes or test reruns needed for this operation.
- Verified pachi-dev-source STS account 451475820431 and developer user
  arn:aws:iam::451475820431:user/pachi-david-dev immediately before mutation.
  Re-read dedicated pool eu-west-1_7uju5eCyw user; Username and returned sub both
  equal b2e594a4-1081-7083-a81b-874d8e4f5d01. Before: enabled, CONFIRMED,
  MFA-setting/preferred fields absent. Prior validated browser fingerprint already
  establishes this exact issuer/subject; no email matching used.
- Under explicit user authorization made ONE AdminSetUserMFAPreference call using
  pachi-dev-source, SoftwareTokenMfaSettings Enabled=true, PreferredMfa=true.
  AWS returned success. No reset/reassociation, password, other-user, pool/client,
  IAM, session-validation or grant changes. Runtime profile remained read-only.
- Independent pachi-staff-runtime readback returns UserMFASettingList exactly
  [SOFTWARE_TOKEN_MFA], PreferredMfaSetting SOFTWARE_TOKEN_MFA; returned sub matches.
  Full existing attestRequiredTotp passes, as do all pool/client checks and runtime
  assumed-role identity verification. This is configuration evidence, not real
  MFA acceptance, recent step-up or staff authorization evidence.
- Asked user to close existing private windows and open a fresh private context
  at localhost:3002; sign in with intended staff account and current authenticator
  entirely in Cognito. No restart needed; reads occur on every callback. Existing
  code/profile/services/secrets preserved. Next correlate callback identity,
  freshness, completed MFA checks and expected grant_denied/access_denied.
  No grant permitted; G1 remains incomplete.
- Operation semantics checked against official API reference:
  https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminSetUserMFAPreference.html

## Post-fix attempt reaches user MFA policy — 2026-09-27

- HEAD 03bcd5e4c511274fe07d2610477b008456582987, clean arrival. Exact CI
  https://github.com/david-developer/pachi/actions/runs/36342942970 passed.
  Running launcher 513846 selects pachi-staff-runtime; callback/provider source
  matches that commit and compiled dev output contains the settling helper.
- Latest completed attempt 1b1e22c3-316a-4863-ac4d-ed7d6fd84321 at
  2026-09-27T19:06:53.160Z fails mfa_policy_validation, category stage_failed.
  Earlier post-restart attempt 1190c868-2c36-462b-9bc5-dcd873cab12b at
  19:05:18.536Z has same outcome. Both follow dev_service_started PID 514149
  in .local-dev/staff-settle-admin.log. Validator's fixed error is MFA_UNPROVEN;
  the event does not persist its individual policy condition.
- Validated identity fingerprint matches dedicated issuer and subject
  b2e594a4-1081-7083-a81b-874d8e4f5d01. Authentication freshness PASSED; all AWS
  credential/policy/user reads completed, and user-MFA assertion was reached.
  Grant checks were NOT reached. This is not expected ungranted denial.
- Wait invocation/duration and successful final auth_time delta were not logged
  by 03bcd5e. Cannot reconstruct whether waiting was necessary for this attempt,
  its duration, or exact final difference. Control flow proves only that strict
  final freshness checks passed (not future, <=10 minutes old, transaction bound).
- Read-only runtime recheck: every pool/client check passes. SDK and CLI agree
  matched user is enabled, CONFIRMED and local; sub matches. UserMFASettingList
  and PreferredMfaSetting are absent/unset (CLI projects null; previous SDK probe
  normalized absence to []). Thus live reproducible failing condition is
  UserMFASettingList?.join(',') !== 'SOFTWARE_TOKEN_MFA'. No exact historical
  snapshot retained, so distinguish current read from callback event evidence.
- No code/service/cloud/MFA/grant changes. Handoff-only uncommitted update.
  Next diagnose Cognito enrollment/returned MFA-state semantics for the verified
  identity using existing evidence before requesting another retry. Do not reset
  authenticator or relax the validator. G1 remains incomplete.

## Bounded authentication-time settling fix — 2026-09-27

- Branch feat/staff-auth-permissions, arrival HEAD
  82e1962433505917f75beab391b13b38cb2d3d53; comparison base unchanged.
  Preserved uncommitted prior diagnostic handoff. Exact arrival CI
  https://github.com/david-developer/pachi/actions/runs/36342300676 passed.
- Host timedatectl reports synchronized=yes and NTP active; detailed timesync
  telemetry unavailable because systemd-timesyncd service is absent. No evidence
  establishes sustained clock drift. Seconds/milliseconds conversion is correct;
  freshAuthentication captures now at invocation after token validation, not
  before network work. Observed signed auth_time was in the next clock second;
  strict zero-future comparison caused the rejection.
- Introduced AUTH_TIME_CLOCK_SETTLE_MS=2000, a two-second maximum delay covering
  the observed one-second disagreement with a small bound. Callback waits only
  for a valid integral signed timestamp within this bound, then rereads time and
  applies the unchanged strict freshness validator. A stalled/backwards clock or
  timestamp still in the future fails closed. No future timestamp is admitted to
  session storage; signed authentication time is preserved, never replaced with
  current time. No JWT tolerance change, maximum-age extension, session/refresh
  lifetime change or step-up window extension. No existing documented tolerance
  was found. Pool/user MFA and grant checks remain enforced.
- Admin tests 6/6, typecheck/lint pass. Deterministic cases cover one second,
  exact two-second boundary, excessive future, stalled clock, invalid claims,
  stale/exact max-age and original signed expiry anchors. Staff integration test
  passes on verified localhost:5433/pachi_test; real store rejects future time and
  preserves signed time, eight-hour absolute and 15-minute step-up boundaries.
  Database typecheck/lint pass. No development DB tests or migrations.
- Restarted only verified admin launcher with pnpm dev admin and
  AWS_PROFILE=pachi-staff-runtime; supervisor 513702. Runtime-profile selection
  verified, admin/web/API readiness 200, staff login POST 303. Marketplace/worker
  preserved, no Cognito/user/grant/environment/secret changes. Startup builds
  shared packages normally. Restored generated next-env path churn only.
- Asked for one fresh browser attempt. Next inspect restart-specific
  .local-dev/staff-settle-admin.log, correlate timestamp/request ID and verified
  fingerprint, then read AdminGetUser for matched subject
  b2e594a4-1081-7083-a81b-874d8e4f5d01. MFA and ungranted-denial acceptance remain
  pending user interaction; no real step-up or G1 claim.

## Controlled retry identifies future auth_time — 2026-09-27

- Latest completed browser callback request 140d3d32-2871-4cec-a694-b673f315980f,
  observed_at 2026-09-27T18:55:26.861Z, fails authentication_freshness with exact
  safe reason AUTH_TIME_IN_FUTURE. auth_age_seconds=-1 and
  auth_transaction_delta_seconds=55: signed authentication time is one second
  ahead of the callback server's whole-second clock. No MFA/grant checks reached.
- Event is in restart-specific staff-runtime-admin.log after dev_service_started
  PID 506614; current launcher 506359 still selects pachi-staff-runtime. Latest
  diagnostics are active. The intervening login_transaction failure was the
  documented synthetic compile probe, not a completed browser login.
- Validated issuer/subject fingerprint exactly matches the independently computed
  fingerprint for dedicated issuer eu-west-1_7uju5eCyw and subject
  b2e594a4-1081-7083-a81b-874d8e4f5d01. Browser subject match is now established
  from validated claims, not email. This is a freshness/time-comparison rejection,
  not proof of a user-MFA failure or expected missing-grant denial.
- No settings, authenticator, permissions, grant or service changes in this
  diagnostic. Next investigate measured clock offset and accepted clock-tolerance
  policy before changing freshness validation. G1 remains incomplete. This
  evidence-only handoff update is uncommitted; code HEAD remains 82e1962.

## Latest callback rejected authentication freshness — 2026-09-27

- Arrival clean at a5468ba9946d0fdc5fc265a5d89937f2a78f610b on
  feat/staff-auth-permissions; comparison base unchanged. Exact arrival CI
  https://github.com/david-developer/pachi/actions/runs/36341803444 passed.
- Latest completed user attempt request 63e7a4df-26fc-4ee8-8c64-03672d48f9fa
  failed at authentication_freshness, category stage_failed. Earlier user attempt
  a7b5bba2-2a75-460c-bf32-45f1f4d10c52 failed at the same stage. Both are in the
  restart-specific staff-runtime-admin.log AFTER dev_service_started PID 506614.
  Current admin launcher 506359 uses pachi-staff-runtime and correct repository.
- Token exchange, ID/access validation and local-identity checks completed. The
  only error emitted by the existing freshness function is MFA_UNPROVEN; old logs
  cannot distinguish invalid/missing auth_time, time before transaction, future
  time or expired freshness. AWS credential/policy reads, user-MFA validation and
  staff grant checks were not reached. No evidence yet of an implementation defect
  in acceptance logic. Tokens were not retained, so issuer/subject cannot be
  recovered retrospectively; email/sole-pool membership is not a substitute.
- Runtime identity and pool/client checks reverified PASS. Independently inspected
  prior subject b2e594a4-1081-7083-a81b-874d8e4f5d01 through SDK and CLI: returned
  username/sub match, Enabled true, UserStatus CONFIRMED; MFA/preferred fields have
  no reported value (CLI projection null, SDK undefined normalized to [] by the
  earlier probe). Thus earlier wording 'empty list' included absent fields; not
  a proven literal empty-array response. This is not proof of callback identity.
- Added fixed freshness reason codes, numeric age/transaction deltas, observation
  timestamp and SHA256(JSON.stringify([verified issuer, verified subject])) to
  rejected callback diagnostics. No arbitrary exception text, claims, token,
  cookie, query or raw identity is logged. Existing acceptance boundaries remain;
  unsafe numeric auth_time additionally fails invalid. Expected prior-identity
  fingerprint: d727a6dd5685627441d2e346fd10e60c5e364036f0ae06a4ce573f75e11650b9.
- Admin unit tests 5/5, typecheck, lint and diff checks pass. Verified dev build
  contains new diagnostic fields; no service restart needed. A deliberate callback
  with no transaction compiled the route and returned 307; its login_transaction
  failure is synthetic and must not be confused with the two user attempts.
  No AWS/user/grant/database mutations, environment changes or marketplace restarts.
- Next: exactly one controlled fresh staff sign-in with browser-only credentials
  and authenticator input. Inspect new reason/time offsets and compare validated
  identity fingerprint before attributing any user MFA state. Old evidence cannot
  establish those missing facts. Preserve checks; no grant or G1 completion.

## Development staff policy corrected; fresh login pending — 2026-09-27

- Arrival clean on feat/staff-auth-permissions at
  `fd61eea65afc42e52f3d3d27fd4098d8d1bfa811`; base unchanged
  `6d8f8899498d52010e45646c6ebe16901b9cf291`. Exact arrival CI
  [36341224376](https://github.com/david-developer/pachi/actions/runs/36341224376)
  passed. This checkpoint changes documentation only.
- Before mutation, STS verified pachi-dev-source as account 451475820431,
  arn:aws:iam::451475820431:user/pachi-david-dev. Read live pool/client, built
  update requests from all returned writable fields using installed CLI input
  schemas (including pool Name→PoolName), and applied only authorized changes.
  Full described before/after comparison, excluding LastModifiedDate, found only
  Policies.PasswordPolicy.MinimumLength 8→12 and ExplicitAuthFlows reduced to
  ALLOW_USER_SRP_AUTH. No other described settings changed. Runtime stayed read-only.
  Private snapshots/requests are outside Git under
  ~/.local/share/pachi/staff-config-20260927 (directory 0700, files 0600).
- Runtime SDK identity remains the expected assumed role. All pool/client checks
  now PASS, including unchanged secret match, required TOTP, managed-login v2,
  code flow, callbacks/scopes, rotation/revocation and token lifetimes. Existing
  full attestRequiredTotp still FAILS only at inspected-user MFA state: empty
  UserMFASettingList, no preferred method. User enabled/CONFIRMED and local.
- Exact sole dedicated-pool Cognito Username and sub are both
  b2e594a4-1081-7083-a81b-874d8e4f5d01, issuer
  https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_7uju5eCyw.
  Reported at explicit user request. Prior safe callback logs have no subject;
  sole-pool membership does not establish ownership of the earlier browser
  attempt. No email match used, identity linked, MFA preference changed or grant
  written. User confirmation/fresh authenticated evidence remains pending.
- Inspected admin launcher 471913 and listener 472229 before stopping only that
  launcher. Restarted via pnpm dev admin with AWS_PROFILE=pachi-staff-runtime;
  actual launcher profile verified. API/web/worker launchers preserved. Admin
  page, marketplace page and API readiness return 200. First login POST returned
  503 (cause not established); independent config/discovery/database checks pass
  and repeat valid-origin login POST returns 303, wrong-origin POST returns 403.
  Normal diagnostic login transactions were created; no migrations or resets.
  Shared-package startup build completed. Environment files/secrets unchanged.
- Pool/client readiness, not already-completed user enrollment, gates this fresh
  login attempt. Callback MFA and grant checks remain unchanged. Asked user to
  open localhost:3002 in a private window, select staff sign-in, use intended
  dedicated identity and complete any TOTP setup/code prompt only in browser.
- AWS TOTP documentation describes an interrupted one-time-token enrollment case
  where managed login cannot resume until MFA is completed; documented recovery
  uses an InitiateAuth/AdminInitiateAuth MFA_SETUP session with
  AssociateSoftwareToken, verification and challenge completion. Do not infer
  this case occurred or reset user/authenticator; inspect actual browser outcome
  before designing any browser-only recovery. Source:
  https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html
- Next: after user's attempt, read this same subject's MFA state through runtime
  credentials and safe callback stage/category logs. Separate successful Cognito
  authentication/MFA policy from expected access_denied without identity/grant.
  No real-browser acceptance or G1 claim. No code changes/tests needed; live
  comparisons/validator/route checks above and git diff --check are validation.

## Runtime identity verified; Cognito policy mismatches — 2026-09-27

- Arrival clean on `feat/staff-auth-permissions` at
  `8bf8772f81d961f0889403cb00865c8375d3b2aa`; base remains
  `6d8f8899498d52010e45646c6ebe16901b9cf291`. Exact arrival CI
  [36338860449](https://github.com/david-developer/pachi/actions/runs/36338860449)
  passed. This checkpoint changes documentation only.
- User reports completing role and policies. Independently verified CLI STS and
  credentials resolved by the actual admin `awsClient()` SDK factory both identify
  `arn:aws:sts::451475820431:assumed-role/PachiStaffRuntimeReadOnly/...`.
  SDK used the established developmentEnvironment loader with
  `AWS_PROFILE=pachi-staff-runtime`; resolved credentials were passed in memory
  to a child STS probe, never printed or saved. Personal profile/config remains
  outside Git; root/admin/web environment files and secrets are unchanged.
- Source-profile GetRole verifies exact prepared trust and MaxSessionDuration
  3600. Role permission enumeration/read operations are AccessDenied; full
  effective role permissions remain unverified, despite administrator-reported
  exact policy installation. All five required Cognito inspection operations
  independently succeeded through runtime credentials.
- Existing `attestRequiredTotp` validator FAILS. Safe read-only diagnostics find:
  pool password MinimumLength is 8 (required >=12); client ExplicitAuthFlows is
  ALLOW_USER_AUTH plus ALLOW_USER_SRP_AUTH (required only ALLOW_USER_SRP_AUTH);
  inspected local user UserMFASettingList is empty and PreferredMfaSetting absent
  (required SOFTWARE_TOKEN_MFA only). This records current provider settings,
  not a conclusion about what occurred during the user's earlier enrollment UI.
- Verified other checks: required pool MFA, software TOTP enabled without SMS/email
  MFA, no remembered devices, admin-created users only, password first factor,
  managed-login v2 and correct pool, matching confidential client secret (boolean
  only), Cognito-only provider, OAuth code-only flow, staff scope, exact callback
  and logout, token revocation, refresh rotation with 10-second grace, five-minute
  access tokens. Refresh lifetime independently read as 480 minutes (8 hours).
- Source-profile read-only ListUsers found exactly one dedicated-pool user;
  runtime AdminGetUser confirmed enabled/CONFIRMED, matching subject, no federation.
  Subject/attributes were not printed; no identity mapping or grant was written.
  Sole-user inspection is not proof that this was the user's browser identity.
- No Cognito/IAM changes, admin restart, migration or data changes. API/web/admin/
  worker left running unchanged; ports remain 3001/3000/3002 respectively. No
  fresh browser attempt requested: validation must pass first. No application
  tests needed for docs-only changes; live SDK/CLI/validator evidence above and
  git diff --check are the affected checks. G1 remains incomplete.
- Next: administrator reviews the three mismatches against accepted ADR/README.
  Do not silently change cloud settings or bypass the validator. After provider
  configuration is corrected and user TOTP state established through the normal
  browser flow, rerun validation, then restart only admin via the launcher with
  the runtime profile. Real callback identity and expected ungranted denial remain
  outstanding; no staff grant is authorized at this stage.

## Runtime role preparation — 2026-09-27

- Arrival clean on `feat/staff-auth-permissions` at
  `4eb0ed71f743dc920dc98d5e0acaa67d01507c6f`; base remains
  `6d8f8899498d52010e45646c6ebe16901b9cf291`. Exact arrival CI
  [36322340156](https://github.com/david-developer/pachi/actions/runs/36322340156)
  passed. This checkpoint changes README, three IAM policy JSON artifacts and
  this handoff only; no application behavior changes.
- CLI 2.37.4 STS GetCallerIdentity using `pachi-dev-source` verified account
  `451475820431` and `arn:aws:iam::451475820431:user/pachi-david-dev`.
  No credentials or cached login data were displayed. The earlier missing-source
  credential blocker is resolved; admin must still use a separate runtime role.
- GetRole returned NoSuchEntity for `PachiStaffRuntimeReadOnly`; complete ListRoles
  returned only three AWS service-linked roles. CreateRole returned AccessDenied.
  ListAttachedUserPolicies and ListGroupsForUser also returned AccessDenied;
  historical group/PowerUser permissions remain unverified. No IAM resources or
  policies were changed and no denied operation was bypassed.
- Prepared exact trust/runtime/AssumeRole JSON under `docs/03-operations/iam` and
  ordered administrator console instructions in README. Trust delegates to the
  verified account constrained by the exact developer principal ARN, retaining
  the need for identity-based AssumeRole authorization. Runtime permissions are
  only the four specified pool-scoped Cognito reads plus region-restricted domain
  inspection. Preserve existing developer management permissions and applicable
  security conditions; no duplicate IAM user or privilege expansion is needed.
- Appended `pachi-staff-runtime` to personal `~/.aws/config` without rewriting
  existing settings: source `pachi-dev-source`, role
  `arn:aws:iam::451475820431:role/PachiStaffRuntimeReadOnly`, region eu-west-1,
  duration 3600 seconds. File remains outside Git with mode 0600. This profile is
  staged, not verified usable: role creation is still required.
- Validation: all three policy JSON files parse; assertions verify exact action,
  pool, region, principal and target-role scope; git diff --check passes. No DB
  tests/migrations needed or run. Root/admin/web environment files, secrets,
  API/web/admin/worker processes and development data remain unchanged.
- Blocked pending administrator console step: create the scoped role and authorize
  its assumption as documented. Then verify CLI and SDK assumed-role identity,
  inspect effective role policy where permitted, run the existing Cognito policy
  validator and restart only admin with the runtime profile. Do not run admin
  with the developer source profile. No fresh browser login requested yet.
  Dedicated subject, real MFA-policy evidence and expected ungranted denial are
  still unverified; no grant written, G1 remains incomplete. MCP setup excluded.

## Fresh callback evidence — 2026-09-27

- Clean arrival on `feat/staff-auth-permissions` at
  `7de9800429d3468d8902e73208d6028d99ce6ee7`; comparison base remains
  `6d8f8899498d52010e45646c6ebe16901b9cf291`. Exact code-commit CI
  [36321962044](https://github.com/david-developer/pachi/actions/runs/36321962044)
  passed. This follow-up changes only the shared handoff.
- User reports another authenticator submission followed by the same error.
  The new redacted callback event has failure_stage `aws_credential_resolution`,
  category `stage_failed`, request ID `8fadc169-2e45-4d4d-9f20-a53bf94d5164`.
  Callback control flow establishes that code exchange, ID/access-token checks,
  local-identity checks and authentication freshness completed for this attempt.
- AWS credential resolution failed before pool/client/user policy reads. Staff
  session registration and grant checks were not reached. This does not establish
  TOTP enrollment success or failure; real MFA acceptance remains unverified.
  Rechecked AWS CLI profile listing: no configured profiles. No credential or
  provider exception contents were printed.
- No code, secrets, environment files, service processes, migrations, accounts,
  grants or cloud settings changed. Existing API/web/admin/worker configuration,
  development data and migration baseline remain as recorded below. No additional
  tests needed for this documentation-only result; preceding code checks and CI
  passed. G1 and real-browser acceptance remain incomplete.
- Next: an authorized AWS administrator verifies the existing `pachi-david-dev`
  principal/account and prepares the README's separate read-only assumed runtime
  role, preserving developer management access. Establish the temporary developer
  source login and runtime role profile outside Git, then verify resolved identity
  and permissions before selecting it for admin. A new profile name or narrow
  policy attached alongside broad permissions does not restrict that developer.
  No further authenticator attempt is needed until AWS access is resolved; do not
  reset MFA or write a grant. Earlier requests below to repeat sign-in or create a
  new identity are superseded by this evidence and the existing developer identity.

## Callback stage diagnostic — 2026-09-27

- Clean arrival on feat/staff-auth-permissions at
  `044332540a068d529a8d402ca4f905348aa3b542`; base remains
  `6d8f8899498d52010e45646c6ebe16901b9cf291`.
- User reports password replacement, authenticator enrollment and code submission,
  followed by generic callback error. These do not independently establish TOTP
  success or failure. Two redacted log events show only login_rejected, with no
  failure stage. Existing evidence cannot identify the failing callback stage.
- Callback sequence: transaction → discovery/code exchange and ID-token checks →
  access-token/local-identity/freshness checks → AWS credential resolution and
  policy reads → pool/client/user MFA validation → staff registration/cookie.
  Missing identity mapping OR eligible grant in register throws
  RESOURCE_SCOPE_DENIED and maps to access_denied, not the observed generic error.
  Other registration errors can still produce the generic error.
- Added fixed failure-stage labels and fixed category only to rejected callback
  logs. Split AWS credential resolution, policy reads and policy assertion stages.
  No exception message/stack, tokens, subject, cookies, callback URL/query or MFA
  material is logged. Validation and error responses remain enforced unchanged.
- Admin unit tests 4/4, typecheck and lint pass after instrumentation.
- No AWS profiles configured at inspection. Existing IAM developer pachi-david-dev
  and former group PachiCognitoDevelopers/AmazonCognitoPowerUser are user-reported;
  current effective permissions/account not verified. README now proposes a
  separate read-only assumed runtime role sourced from that existing developer
  login. A profile alias or additional narrow policy does not narrow broad access.
  Preserve developer management access; no duplicate IAM user or IAM mutation.
- No grant, identity reset, MFA change, migration, or development-data reset.
  API/web/worker preserved; admin dev reloads diagnostic changes. Environment file
  locations unchanged. Real MFA/browser acceptance and G1 remain incomplete.
- Next: one fresh user sign-in (not a replay/reload of the callback) to record a
  fixed failure stage. Report only that the attempt finished. Inspect only the
  redacted stage/request-ID fields. Independently have the AWS administrator verify
  existing developer permissions and prepare the scoped role before runtime use.

## Login configuration diagnostic — 2026-09-27

- Arrival clean on `feat/staff-auth-permissions` at
  `eca0a02f0517a99bec94637d0d4f2687c2674992`; comparison base remains
  `6d8f8899498d52010e45646c6ebe16901b9cf291`. Exact arrival CI
  [36307966360](https://github.com/david-developer/pachi/actions/runs/36307966360)
  passed. Only README/handoff changed in this diagnostic.
- Login POST catches configuration, cookie/session, DB login-transaction, OIDC
  discovery and URL-construction errors as STAFF_CONFIGURATION. It performs no
  authenticated AWS API call; those occur later during callback MFA attestation.
- Required ignored file settings all present and actual staffConfig validator
  passes. Running admin inherited an empty client secret from its earlier launch;
  its presence/equality differed from the saved file. Valid-origin POST reproduced
  503. No values, cookie or redirect queries were printed.
- Restarted only identified admin launcher using `pnpm dev admin` with persistent
  supervision. No environment files or secrets edited. Valid-origin login now
  returns 303 to the expected Cognito host with code/S256 PKCE; marketplace-origin
  POST returns 403. This exercises configuration, DB transaction, encrypted cookie
  save and discovery but not token exchange. One short-lived login transaction
  from this diagnostic was created through the normal route; no accounts/grants
  changed. Migration baseline remains 0014; no migrations or DB tests run.
- API/web/worker launchers were preserved; admin startup builds shared packages
  and may trigger API's existing watcher. Ports remain API 3001, web 3000, admin
  3002. Environment sources remain root `.env`, `apps/web/.env`, `apps/admin/.env`.
- AWS CLI 2.37.4; no configured profile names; STS probe reports missing
  credentials. SDK source confirms INI role/login_session, credential_process and
  SSO support. README now contains minimal Cognito read-only policy with an
  explicit unknown account-ID placeholder and supported temporary `aws login`
  instructions for a non-root identity. No root credentials or long-lived keys
  used or created. AWS settings/account/permissions remain unverified.
- No application code changed; verification was actual route 503 → 303, PKCE
  redirect checks and wrong-origin 403. Real browser/MFA, token exchange, grant,
  logout and step-up acceptance remain incomplete. No grant authorized in this
  diagnostic; G1 remains incomplete.
- Next: account administrator supplies a non-root scoped development identity
  with README read-only policy and local-login permission. User runs the documented
  `aws login --profile pachi-staff-dev --region eu-west-1` in their terminal and
  completes browser authentication; report only profile name. Verify account and
  permissions before running staff-policy checks. Do not write a grant.

## Staff resource configuration follow-up — 2026-09-27

- Arrival: clean `feat/staff-auth-permissions` at
  `f7298dd115c6210ea99fa3ae14487284c5c6e5c6`; comparison base remains
  `6d8f8899498d52010e45646c6ebe16901b9cf291`. Its exact CI run
  [36283435191](https://github.com/david-developer/pachi/actions/runs/36283435191)
  passed. This checkpoint changes only README/handoff in Git.
- User-reported resources: region `eu-west-1`, pool `eu-west-1_7uju5eCyw`, client
  `6o98a1sg9j9qghna441so80s2u`; issuer and domain are recorded in README.
  Public OIDC discovery independently matches issuer/domain and advertises code
  flow. Pool MFA/registration and client scopes/secrets/rotation/lifetimes remain
  unverified without authenticated AWS access. No cloud settings were changed.
- Configured exact implemented staff keys in ignored `.env` and
  `apps/admin/.env`; marketplace settings and existing secrets preserved by
  comparison. Generated only the missing independent staff-session secret.
  `STAFF_COGNITO_CLIENT_SECRET` is still missing in `apps/admin/.env` and must
  be entered by the user locally. No secret values printed or committed.
- AWS CLI credential probe reports no credentials; zero configured profiles.
  SSO is not assumed or required. README names the five read operations and
  scope restrictions for an authorized profile; policy validation stays enabled.
- Restarted only identified project API/admin launchers through `pnpm dev api`
  and `pnpm dev admin`. Web port 3000 and worker were not stopped. API readiness
  200; admin port 3002 root 200 and session configuration 503. Logs are ignored
  `.local-dev/staff-config-{api,admin}.log`. These probes do not prove login.
  Initial tool-shell background launchers exited; restarted their identified
  orphan children with detached persistent supervisors. Both launcher locks are
  now live. Effective API staff identifiers match the supplied values and test
  issuer mode is disabled. Marketplace web remained PID 379506 throughout.
- No database migration or development-record mutation in this follow-up;
  previously verified migration 0014 remains the baseline. Startup tests 4/4,
  admin tests 4/4 and API unit tests 14/14 pass. No database tests were run.
- No authenticated browser attempt, identity mapping or grant performed. Pending:
  actual TOTP, authenticated ungranted denial, granted role/scope, marketplace
  credential rejection, marketplace workspace and logout/post-logout checks.
  No separate step-up demonstration or G1 completion is claimed.
- Next: user fills `apps/admin/.env` → `STAFF_COGNITO_CLIENT_SECRET` and configures
  an authorized AWS profile using their account's existing mechanism. Then inspect
  live pool/client policy, guide user browser password/TOTP, and establish the
  intended issuer/subject before audited provisioning. Authorized grant remains
  only SUPER_ADMIN / platform pachi / admin:permissions_manage. Do not choose a
  target from an email match or first signup. No broader features are authorized.

## Earlier setup evidence (historical)

## Current setup checkpoint — 2026-09-27

- Task arrival was clean at `feat/staff-auth-permissions`, HEAD
  `f7651e134f25770c23b6cd44f9aff8ffa175c336`, based on
  `6d8f8899498d52010e45646c6ebe16901b9cf291` (`origin/main`). The exact starting
  commit's [CI run](https://github.com/david-developer/pachi/actions/runs/36281158497)
  passed. This task's tracked changes are limited to `README.md` and this
  handoff; `apps/admin/.env` is ignored local configuration, not a Git edit.
- Setup documentation checkpoint `e0635cb8c6a3a7dc31f1e5049c8113dd143d1288`
  was pushed without merging. Its exact-commit
  [CI run](https://github.com/david-developer/pachi/actions/runs/36283253889)
  passed, including isolated migrations and integration, lint, typecheck, unit
  tests, production build and both web/admin Chromium suites.
- Verified configuration locations: root `.env` and `apps/web/.env` retain the
  existing marketplace configuration; `apps/admin/.env` was created from its
  ignored example with staff settings blank. No values are recorded here. API
  and web are in development mode on ports 3001 and 3000 and use
  `localhost:5432/pachi_local`; their consumer Cognito issuer/client settings
  exist and test-issuer mode is disabled. No `STAFF_COGNITO_ISSUER` or
  `STAFF_COGNITO_CLIENT_ID` is present in the running API environment. API PID
  437355 listens on port 3001; web PID 379506 listens on port 3000. Worker PID
  421608 is running without an HTTP listener. Admin launcher PID 437344
  (server child 437376) is running on port 3002 via `pnpm dev admin` and shows
  safe configuration guidance.
  The launcher reads `.env` plus `apps/admin/.env`, checks the port, and filters
  inherited test settings. The development and test Postgres listeners are on
  5432 and 5433 respectively.
- Migration target was parsed without printing URL credentials and confirmed as
  `localhost:5432/pachi_local` before running the normal `pnpm db:migrate` path.
  Before: 23 public tables, `users` present, and all four staff tables absent.
  After: 27 public tables; `staff_grants`, `staff_sessions`,
  `staff_auth_transactions` and `staff_access_audit` exist. Drizzle records 15
  migrations and the SHA-256 for `0014_staff_access.sql` is present. The reviewed
  migration only creates staff tables/index/trigger/function; it does not modify
  existing marketplace rows. User records were not read or reset. Test migrations
  and HTTP integration tests used only the CI's isolated `localhost:5433/pachi_test`
  URL; test fixtures were cleared by the integration harness only in that test DB.
- Current checks pass: admin unit tests 4/4; API unit tests 14/14; API HTTP
  integration tests 4/4; admin/API typecheck and lint; admin Chromium tests 2/2.
  The browser tests cover unconfigured guidance and synthetic session summary,
  denial and logout error behavior. They do not prove Cognito, TOTP or real
  session persistence. Local smoke requests returned admin root 200 and
  unauthenticated staff-session 401; neither proves login. The user confirmed
  marketplace login/workspace in the prior task, but there was no authenticated
  marketplace or staff browser run in this task.
- Current AWS state is **unverified**, not assumed absent: AWS CLI v2.37.4 was
  installed in ignored `.local-dev/aws-cli/` using the official user-local
  installer, whose published signature verified. No AWS environment
  credentials/profile or standard AWS credential files are available, and no
  console/browser control tool is exposed here. Therefore no account/region,
  pool, client, resource server, domain, IAM role,
  staff identity/subject or grant could be discovered, created or recorded.
  The reviewed target is a dedicated nonproduction Cognito pool with required
  TOTP, Essentials-or-higher managed login v2, admin-created password users,
  resource-server scope `pachi/staff`, a confidential authorization-code client,
  the exact localhost callback/logout URLs and token rotation described in the
  README. Required MFA is pool-wide, so applying it to the marketplace pool
  would alter consumer sign-in. Code requires staff tokens to match the separate
  staff issuer/client and `pachi/staff`; consumer tokens continue to use their
  existing issuer/client allowlist and `pachi/account`.
- The intended narrow initial permission-management grant, if authorized for
  the explicitly identified operator, is `SUPER_ADMIN` with platform scope
  `pachi` and only `admin:permissions_manage`; policy allows that permission
  only on the platform scope. No identity was selected or promoted, and no grant
  was written. The UI displays reauthentication freshness and login requests
  `prompt=login`, but there is no separate step-up action/route; step-up behavior
  remains unverified. Provider verification, media approval, moderation and
  publication remain out of scope. G1 and production readiness are not claimed.
- **Blocking action / next:** the user must provision the dedicated staff pool,
  client, domain, `pachi/staff` scope and a local account in the intended
  nonproduction AWS account using the README settings, and create a short-lived
  AWS SSO profile for the app's read-only Cognito inspection and audited grant
  commands using the installed `.local-dev/aws-cli/bin/aws`. Enter Cognito IDs,
  client secret and random staff-session secret only into the ignored local
  environment files, never chat. The user must then
  finish their own temporary-password and TOTP setup in the browser. After that,
  rerun inspection, map only the explicitly identified identity, write the
  audited narrow grant, and perform the real staff, ungranted, marketplace,
  logout and post-logout browser checks. Recent-authentication step-up remains
  unavailable to demonstrate through a dedicated interface.

Operational evidence only; [canonical documentation](../README.md) and its
authority order govern product behavior. Full scope is preserved. Premium mobile
is primary; functional web screens and the unapproved preview are not the visual
baseline. Current task: implement the explicitly requested staff authentication and
permission foundation only; preserve marketplace and submission gates.

## Staff access foundation — implementation evidence before runtime setup (historical)

- Branch `feat/staff-auth-permissions` created from clean functional baseline
  `3823aeddc1444b425bd06f248d7bd582909f8a65`; its CI passed (run 36264487402).
  No visual-prototype branch or existing edits incorporated.
- Read auth/environment ADRs, product permissions, domain model and role matrix.
  Design: separate admin client, dedicated required-TOTP Cognito pool to avoid
  changing consumer MFA, separate encrypted staff sessions, current scoped grants,
  8h absolute/30m idle and independent 15m reauthentication evidence.
- AWS docs confirm required MFA is pool-wide and prompt=login requires managed
  login (not classic hosted UI). Server configuration inspection plus validated
  fresh local identity authentication will establish evidence, not an assumed
  MFA token claim. No cloud resource changes authorized by implementation alone.
- Implemented initial staff-only grant/session/transaction/audit migration,
  required-TOTP policy inspection, OIDC routes, encrypted token rotation under
  database lock, separate API acceptance and minimal admin status interface.
  Operator commands create only a new principal for a verified staff subject,
  then grant to its explicit application ID; no existing-provider linking.
- Migration 0014 applied only to localhost:5433/pachi_test. Focused staff database
  and signed-token HTTP tests pass after fixing driver timestamp serialization
  and normalization. Controlled-clock checks cover idle/absolute/step-up expiry;
  concurrent refresh runs once and preserves authentication time. Initial admin
  build and provider-policy unit tests pass. Full lint/typecheck/unit/startup
  checks pass; isolated database 8/8 and API HTTP integration 4/4 pass. Focused
  staff checks rerun after final audit/scope changes also pass. OpenAPI parses.
- Chromium admin checks 2/2 pass against its production build: configuration
  guidance, safe role/scope summary, access denial and logout error feedback.
  These are synthetic session API fixtures, not a real staff login. Marketplace
  photo refresh suite 4/4 passes against existing development web, including
  processing-to-ready and form preservation; fixtures do not use real accounts.
  Prior user-confirmed marketplace login/workspace evidence remains separate.
- Current listeners inspected: marketplace web 3000 PID 379506, API 3001 PID
  409759 initially, isolated PostgreSQL 5433; admin 3002 free. Final smoke check
  found API/worker had exited during dependency-tree relinking (redacted API log:
  missing @nestjs/common/tsx files). Files were restored by dependency installation.
  Restarted only absent API/worker via `pnpm dev api` / `pnpm dev worker`, detached
  from tool terminals, with logs `.local-dev/staff-task-{api,worker}-launch.log`.
  API now listens on 3001 PID 421759; web remains PID 379506. Both new launcher
  locks are live. API readiness and web return 200; effective API environment has
  Cognito configuration, localhost:5432/pachi_local and test issuer disabled.
  Root/web env files untouched; admin .env does not exist. Health evidence is not
  a new real-account login acceptance test.
  No development migrations/data/secrets or Cognito resources changed.
- Setup requires dedicated staff pool/client, local user/TOTP, read-only Cognito
  inspection IAM, admin env, API staff issuer/client, and reviewed dev migration.
  README contains exact steps and operator commands. Real staff login unverified.
  Latest admin build and both browser checks pass. Implementation commits
  `fc8e11131207f1f33609e1407b17040584897c75` and
  `ee3e1c95f19dae328daa345e78177348cd0fc24e` are pushed without merging.
  Final code commit ee3e1c9 [CI](https://github.com/david-developer/pachi/actions/runs/36280924044)
  **passed**, including isolated migrations, database/API integration, all lint,
  typecheck/unit/startup checks, full production build and all six Chromium tests.
  Review also tightened fixed configuration-error responses and revokes staff
  sessions on operator grant changes; the latter has a passing regression.
- This documentation-only checkpoint records final code validation; `git rev-parse
  HEAD` identifies the latest handoff commit. No real staff pool/client, IAM,
  identity enrolment or browser login was exercised. Do not describe synthetic
  checks as real staff acceptance. No staff grant was given to the existing
  development provider or any development account.
- Next: await the user's next scope; for real staff acceptance, complete the
  README's dedicated-pool/client/IAM/env setup, reviewed development migration,
  operator identity/grant steps and user-entered password/TOTP browser walkthrough.
  Verify real refresh, idle/absolute/step-up behavior and logout/revocation there.
  G1 and production readiness remain incomplete.

## Continuity setup — 2026-09-26

- Arrival branch `feat/listing-readiness-submission`, clean HEAD
  `18317c76fbcb54b5b1495430bcf2a6b0c69f5b5e`; local origin/main comparison base
  remains `6d8f8899498d52010e45646c6ebe16901b9cf291`. Arrival checkpoint
  [CI](https://github.com/david-developer/pachi/actions/runs/36246456388) passed.
- Root AGENTS explicitly requires this handoff at every task start and updates
  after meaningful progress and before handoff/stopping. Copilot uses the same
  record; canonical specifications retain authority. No competing progress file.
- Active installed Codex is `0.155.0-alpha.16.3`. Enabled its supported stable
  `features.memories` in `/home/david/.codex/config.toml`; verified all other
  parsed settings were preserved and the feature reports enabled. Personal
  config/memories remain outside Git, with narrow ignore rules as a safeguard.
  This verifies configuration, not generation or recall of a native memory.
- Used skill-creator to create exactly two instruction-only repository skills
  under `.agents/skills`: `pachi-runtime-debugging` and `pachi-ui-verification`.
  They reference maintained commands/docs, the clean launcher, isolated test
  runners, installed Playwright and observed startup/UI races. Automatic
  selection retains its default; explicit `$skill-name` invocation is supported.
- Both final skill folders pass the bundled validator; all linked local files
  resolve. Native `skills/list` discovers both as enabled repository skills from
  root and `apps/web`, with no discovery errors and no explicit-only policy.
  `debug prompt-input` includes both catalog entries in each directory. It does
  not expand bodies for dollar-name mentions; no executed model-turn selection
  test was performed. Description routing was reviewed: runtime failures match
  runtime-debugging, interaction regressions match ui-verification, and neither
  implies starting a new staff-auth feature or approving visual designs.
- Changes are guidance/skills/ignore rules only. No app edits, service restarts,
  environment-file changes, migrations, database writes or application test runs
  in this setup. Existing service roles/ports, environment locations, migration
  caveat and application/browser evidence below remain historical verified facts,
  not new probes. Setup commit `482547068a5d820a506c02bcdfb47516071a24be` is
  pushed without merging; its [CI](https://github.com/david-developer/pachi/actions/runs/36264454762)
  was in progress at handoff. This subsequent documentation checkpoint records
  that observation; use `git rev-parse HEAD` for its exact commit and check CI
  before treating either checkpoint as remotely validated.
- User clarified: report this setup when complete; staff authentication and
  permissions will follow in a new user prompt. Do not infer or start that scope.

## Current result — photo refresh

Implementation commit `a66b406987cc5d01090b97b604138b6efab8d4a9` is pushed on
`feat/listing-readiness-submission`, without merging. Its exact-commit
[CI run](https://github.com/david-developer/pachi/actions/runs/36246268465)
**passed**, including the full build and all four Chromium UI regressions against
the production server. The latest subsequent checkpoint documents this outcome
and the local browser installation only; `git rev-parse HEAD` identifies it.

Refresh now shows loading/completion/errors, updates current draft photos without
reloading form inputs, and discards prior-request/prior-draft/poll responses.
Processing-to-ready and the originally reproduced race cases pass in Chromium.
The production auth/API/worker and development records were left unchanged.

## Login recovery result (previous maintenance task)

Repair commit `2baedb7a85f1cb113f4a5e19f43af844e30c9dc3` is pushed to the same
feature branch; no merge or PR was created. Its exact-commit
[CI run](https://github.com/david-developer/pachi/actions/runs/36238741087)
**succeeded**, including isolated migrations/integration tests, lint, typecheck,
unit tests and full production build. Worktree after that push was clean. This
subsequent documentation-only evidence checkpoint changes only this handoff;
`git rev-parse HEAD` identifies the current checkpoint. That login repair remains intact; the photo-refresh repair below is a separate
maintenance checkpoint.

User confirmation (2026-09-26): real login works; existing drafts, photos and
readiness display correctly. This closes the prior visual-confirmation item.
The user now reports that after an upload, **Refresh status** does not update the
displayed status, while a full-page reload does. A follow-up click gives no visible
response. Current investigation is scoped to this button and its polling/state.

## Photo-refresh diagnosis and validation

- Arrival branch is unchanged; HEAD `c6a04ba4179417b06fa4730c82adc10ff17a20aa`,
  clean worktree. Its [CI](https://github.com/david-developer/pachi/actions/runs/36238911779)
  passed. Existing services and ignored environment files are untouched.
- Button calls `loadPhotos(editingDraftId)`; it has no loading/success feedback and
  does not clear a previous error on success. Both client fetch and authenticated
  Next-to-API fetch explicitly use `cache: no-store`. The dynamic route checks the
  server session; API checks provider ownership then reads current DB lifecycle.
- Upload/retry polling also calls `loadPhotos`. Every response unconditionally
  sets the list, without request ordering or draft-switch/unmount cancellation.
  Controlled Chromium reproduction confirms both races; the user's browser
  payload is unavailable, so do not claim the exact interleaving of their click.
- Recent real media reads return 200; no private response payloads inspected.
  Initially no exposed browser tool or installed browser existed. Installed a
  temporary Playwright 1.56.1/Chromium harness under /tmp/pachi-browser-check,
  including locally extracted browser libraries (no system changes). User then
  explicitly authorized installing tools for autonomous verification.
- Before editing application code, actual /provider UI with synthetic intercepted
  API responses reproduced: click issues media GET and updates PROCESSING to
  READY; no pending feedback; delayed A response replaces B photos; delayed poll
  replaces manual READY with PROCESSING. Unsaved title survives the simple refresh.
  Script: /tmp/pachi-browser-check/reproduce.mjs. No development records written.
  Cause established in client request ordering/draft scope and missing feedback,
  not a missing handler or observed response cache.
- Small application fix stays in the provider component: generation/request checks
  reject stale photo reads; selecting a draft or unmounting invalidates old work;
  manual refresh supersedes upload polling and resumes one scoped poll while
  processing continues. Draft-open/readiness responses also respect selection.
  Refresh never reloads/saves the form, has a ten-second request deadline, and
  displays loading, completion and errors (including expired sessions).
- Chromium regressions now live in `apps/web/tests/photo-refresh.spec.ts`, using
  pinned @playwright/test 1.56.1. 4/4 pass: PROCESSING → READY, preserved unsaved
  title/description/price, 401/500/network failures + retry, delayed prior-draft
  response, stale upload poll after manual refresh, and stopping settled polling.
  Initial harness selector mistakes were corrected before the passing run.
  Existing web unit tests 7/7, web lint and typecheck pass. Test config is included
  in typecheck; the optional webServer config was corrected for exact optional types.
- CI now installs the pinned headless browser and runs these tests against a
  production server on 3100 after the existing full checks/build. Synthetic API
  interception is limited to fresh test contexts; it does not modify app auth,
  server authorization, CSRF, test issuer settings or the running user session.
- Local autonomous browser command (pinned Node on PATH):
  `LD_LIBRARY_PATH="$PWD/.local-dev/browser/libs/usr/lib/x86_64-linux-gnu"
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64
  PLAYWRIGHT_BROWSERS_PATH="$PWD/.local-dev/browser/browsers"
  PACHI_BROWSER_BASE_URL=http://localhost:3000 pnpm --filter @pachi/web test:browser`
  (join these environment assignments on one shell line). Libraries were downloaded
  and extracted locally because this Ubuntu 26.04 host lacks NSS/NSPR/ALSA; the
  browser uses the compatible Ubuntu 24.04 build. Binaries/libraries were also
  copied into ignored .local-dev/browser so future sessions do not depend on /tmp.
  README describes normal install
  and run commands. No credentials/tokens/cookies or real records enter fixtures.
- No migration/schema changes or database tests needed for this client-only fix.
  Development accounts, drafts, photos, secrets and service startup remain intact.
  No service restarts were needed. Production build and browser regressions passed
  in exact-commit CI; the running development .next output was not replaced.
  The documented persistent-browser command was smoke-tested successfully with
  the processing-to-ready/form-preservation case.

## Arrival evidence — 2026-09-26 (historical snapshot)

- Branch: `feat/listing-readiness-submission`; arrival HEAD/upstream:
  `894b4f875c0caad2027de79033f1f4b481f99011`.
- Merge base with local `origin/main`: `6d8f8899498d52010e45646c6ebe16901b9cf291`.
  No PR exists for this branch (GitHub checked during recovery).
- Arrival edit: README startup instructions, +13/-2 lines, preserved and being
  incorporated into the startup repair. No other arrival worktree edits.
- Root AGENTS.md and the Copilot instructions now reference this single handoff.
- Pinned Node 24.21.0 and pnpm 12.0.0 exist under
  `/home/david/.nvm/versions/node/v24.21.0/bin`; shell PATH initially lacks them.
- Environment sources: ignored root `.env` (API/worker) and `apps/web/.env`
  (Next.js). Both exist. Never copy examples over existing environment files or
  regenerate the web session secret. `/proc/.../environ` only shows startup
  inheritance, not settings Next.js subsequently loads from files.
- Listener inspection: web PID 346611 on 3000; **no API listener on 3001**.
  API watcher PID 346539 remains without Cognito variables in its inherited
  environment. Worker watcher 346540 / child 360773 remain. Web launcher 346553.
  Local PostgreSQL listens on 5432 (development) and 5433 (isolated test);
  ClamAV on loopback 3310. Staff 3002 is not running. Other listeners untouched.
- Fresh HTTP probes: web `/` 200; API `/v1/health/ready` connection refused.
- Redacted historical web log: code exchange completes then bootstrap starts;
  recent callbacks eventually fail with TypeError, with no persistence-complete
  stage. Earlier failures have generic Error. This establishes API-bootstrap
  failures in captured attempts, not the state of a new browser attempt.
- Logs inspected through a whitelist sanitizer only:
  `/tmp/pachi-web-submit.log`, `/tmp/pachi-api-submit.log`,
  `/tmp/pachi-api-authenticated.log`, `/tmp/pachi-worker-submit.log`.
  Existing Next request logs contain callback queries; do not print raw logs.
- Migrations/data inventory, validation and exact-commit CI: not checked yet.
- No browser automation tool exposed. Real-account credentials stay with user.
  Fresh login, ACTIVE account, provider workspace, saved drafts, photos and
  readiness are **not yet verified** in this takeover.

## Recovery checkpoint — 2026-09-26

- Added clean-environment `pnpm dev [all|api|web|worker]`; filtered app `dev`
  scripts use it too. It bypasses Turbo's filtered development environment,
  builds shared packages, reads root `.env` and overlays `apps/web/.env` only for
  web, rejects test database/issuer configuration, and checks ports/PID locks.
  Ctrl-C signals only owned process groups. Run in a persistent terminal after
  `nvm use 24.21.0`; `docker compose up -d postgres clamav` supplies dependencies.
  Staff/mobile are separate, unchanged commands. Startup runs no migrations.
- Root and web DB/issuer/client/session-secret settings agree; client-secret
  values differ. Existing web secret retained through its file override; the
  API uses verifier settings, not the web confidential-client secret. No secret
  files changed. Database URL parsed safely: localhost:5432/pachi_local.
- Stopped only reidentified Pachi launcher PIDs 346539, 346553 and 346540.
  The first repaired run was captured in tool terminal session 34922. A controlled
  SIGTERM to its launcher stopped all owned services and released ports/locks.
  Restarted through the final launcher (tool session 74717): API listener 379485
  on 3001, web 379506 on 3000, worker 379486 (watcher 379453). Append-only ignored
  logs are `.local-dev/api.log`, `.local-dev/web.log`, `.local-dev/worker.log`;
  PID locks also live there. Recheck live PIDs before any future stop.
  Startup was deliberately invoked with inherited CI/test DB/test issuer settings:
  actual service environments exclude them, use localhost:5432/pachi_local and
  have Cognito settings present. API/web health return 200 after restart.
- API readiness and web root now return 200. Fresh HTTP login initiation returns
  307 to HTTPS with S256 PKCE and a transaction cookie (values never printed).
  This is not a completed browser authentication.
- Bootstrap now times out after 10 seconds; generated request IDs are propagated
  to the API. Logs include callback stage/duration/error class/API status only.
  Next development logging is disabled to avoid callback queries/browser logs.
- Read-only data inventory: 1 ACTIVE + 1 PENDING_PHONE account, 1 provider account,
  4 properties, 3 DRAFT listings, 3 READY and 2 DELETED media assets, 3 attached
  photos/1 cover, 0 submissions. This does not prove browser rendering or account
  ownership; no data was reset or edited by the diagnostic.
- Migration history contains all 14 entries through 0013, timestamps match.
  **Existing 0011 hash differs from repository SQL**; the other 13 hashes match.
  The recorded hash exactly matches 0011 with the later CHECKSUM_MISMATCH item
  removed. Applied migration 0012 adds that item, and the current database
  constraint includes it. No migration history or development schema was changed.
- Focused web tests 7/7 pass, web typecheck passes; startup regressions pass.
  Full lint, typecheck and unit checks pass. Isolated database integration 7/7
  and API HTTP integration 3/3 pass against only localhost:5433/pachi_test; test
  migrations ran there only (log: `/tmp/pachi-recovery-validation.log`).
  Duplicate API launch safely refused with exit 1 and no running-service changes.
- GitHub reports no PR for this branch; local merge base with origin/main is a
  comparison base, not a confirmed PR target. Baseline 894b4f8 CI succeeded:
  https://github.com/david-developer/pachi/actions/runs/36235118442 .
- Fresh browser action requested: new login from localhost root, existing account,
  provider workspace, reopen draft/photos/readiness, reload. At approximately
  11:20 UTC the fresh callback `b2e02735-b71f-4606-9d9e-ec5b6aa5020c` completed
  code exchange, API bootstrap (201, same request ID), and web session persistence
  in 1,240 ms. Subsequent authenticated provider/media derivative requests and
  photo-order mutations returned 200. Draft detail, readiness and all three photo
  derivatives returned 200 before restart. After restart, authenticated property
  and draft-list requests still return 200 without another callback, demonstrating
  server-side session persistence. User visual confirmation remains pending; no
  browser screenshot/DOM access is available to this agent.

## Historical report

Copilot's attached report says a valid Cognito exchange failed API bootstrap with
401 because the verifier was unconfigured, test settings leaked from a shell,
stale API processes competed for 3001, and a corrected API was restarted. Current
listener evidence contradicts continued availability of that corrected API.
The user reports an indefinite spinner after password entry. Earlier real login,
an ACTIVE account, workspace, drafts and photos are reported, not yet independently
reverified. Do not claim recovery based on health/negative tests alone.

## Known gates and next action

Submission remains blocked by `MEDIA_APPROVAL_UNAVAILABLE` and
`PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE`. Never edit verification records or
bypass these rules for a successful walkthrough.

Next: await the user’s next prompt. The staff foundation and code CI are complete;
real AWS/staff-browser acceptance requires the setup recorded above. No further implementation is required for
the photo-refresh repair. Use the documented
browser regression suite for future reports. Real-account acceptance is distinct
from the synthetic UI suite; the user confirmed login/workspace before this fix,
while this fix's processing transitions were verified autonomously with controlled
API responses. Do not expand scope or bypass submission gates.

Full build passed in remote CI. Avoid running next build over the active dev
server's .next files. Services are left running through tool session 74717; if
that terminal no longer exists, inspect listeners/PID files before starting
`pnpm dev` in a persistent terminal. Unrelated listeners were left untouched.
