# Engineering handoff

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
