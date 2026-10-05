# Pachi — Reconciled Documentation Package

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

This repository contains the canonical product documentation and an incrementally implemented local marketplace. G0/G1/G2 are complete, including the recorded individual-provider synthetic/local TEST journey through verification, property/listing/media, scoped moderation/publication, public discovery, inquiry/messages/provider response and analytics. See the [G2 closure evidence](docs/engineering/current-state.md#g2-vertical-slice-complete--2026-10-05). G3 alpha functionality, E01–E07, real-account acceptance, deployment and pilot evidence remain outstanding; this is not production readiness.

Design direction note (2026-09-26): `/preview` was a review experiment and is
not approved as Pachi's visual direction. Keep it isolated from functional
marketplace/provider screens and native mobile work while the premium mobile
housing direction is explored separately.

Start with [docs/README.md](docs/README.md). Replace the corresponding files in your repository's `docs/` directory, inspect the diff, preserve unrelated files and make a separate documentation commit. This package README is delivery guidance; merge any useful notes into the existing repository README rather than overwriting unrelated project instructions.

See [reconciliation record](docs/archive/documentation-migration-record.md) for deliberate changes, resolved questions and remaining launch evidence. Historical source material is archived and is not a second implementation specification.

## Conversation messaging (bounded G2 implementation)

`/conversations` lists the authenticated seeker's or current individual provider's
Conversations. Listing contact still opens/reuses its Interaction. The Conversation
page supports plain text, manual refresh, older-message pagination and persisted
recipient delivery/read acknowledgement. Private content is not cached offline;
URLs remain text. This is a functional development interface, not approved final design.

Sending requires current ACTIVE/phone eligibility and an OPEN Interaction; providers
also need current profile/account/identity eligibility. Historical participant rows
never grant access; organization messaging fails closed pending assignments.
CLOSED/RESTRICTED and blocked contexts retain authorized history. Durable block
enforcement substrate exists; block-management UI/API and reporting remain deferred.

Messages have a server sequence and sender/client-message retry identity. Receipt
acknowledgement is per recipient: READ implies DELIVERED, and both use server times.
The shared PostgreSQL fixed-window limiter defaults to 20 sends per Conversation
and 60 globally per sender per 60 seconds. API configuration can override
`MESSAGE_CONVERSATION_LIMIT`, `MESSAGE_GLOBAL_LIMIT`, `MESSAGE_WINDOW_SECONDS`;
all API processes must use the same configuration. Persisted retries consume no
additional unit. Current Conversation access is always required; an identical
persisted retry confirms its existing Message even after state, block or sender
eligibility changes. Current send capability applies only to a genuinely new
Message. A table SHARE lock serializes new sends against block mutations; it permits
concurrent sends and may need a finer locking protocol with later block management.

Every new message commits one safe `message_sent` source event; the first provider
reply commits one `provider_first_response` per Interaction. Outbox schema version 1
records only approved structured metadata and response buckets, never message text.
The 24-hour bucket includes exactly 24 hours. Analytics consumption/deduplication,
measurement validation and the coherent G2 vertical-slice acceptance are recorded
with synthetic/local TEST evidence. Broader G3 alpha functionality remains incomplete,
including external notifications, viewing, native calls and reviews; attachments and
voice remain outside this slice. Real verification evidence intake retains E01 gates;
real Cognito/account, deployment and pilot acceptance remain outstanding.

## Local foundation

Prerequisites: Node.js 24.21.0, pnpm 12.0.0, and Docker Compose. In a
fresh WSL terminal with `nvm` installed, activate the pinned toolchain before
running repository commands:

```bash
nvm install 24.21.0
nvm use 24.21.0
corepack enable
corepack install --global pnpm@12.0.0
node --version
pnpm --version
```

The repository repeats these pins in `.nvmrc`, `package.json`, and the
lockfile; do not rely on a globally selected Node or pnpm version.

```bash
cp .env.example .env
set -a
source .env
set +a
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
```

Start the local API, marketplace web and media worker from the repository root
after activating the pinned toolchain. Keep this command running in a terminal:

```bash
docker compose up -d postgres clamav
pnpm dev
```

The launcher builds shared packages, reads existing ignored `.env` for API/worker
and overlays `apps/web/.env` for web. It discards inherited application settings,
`CI`, `DATABASE_TEST_URL`, test issuers and runtime hooks; it requires the local
development database and configured Cognito verifier. Do not regenerate secrets
or overwrite existing files with examples. The web file's client secret takes
precedence over the root file for web. No migrations are run by startup.

For separate terminals use `pnpm dev api`, `pnpm dev web`, and `pnpm dev worker`.
The equivalent filtered app `dev` commands use the same launcher. Port conflicts
and duplicate launchers fail with an explanation; inspect `ss -ltnp` and the
identified PID's working directory before stopping a stale project process.
Never use broad `pkill` patterns. Ctrl-C stops only services owned by that launcher.
Do not run both the combined and individual commands for the same service.

Read/update the shared [engineering handoff](docs/engineering/current-state.md)
when resuming. It records verified recovery evidence, outstanding work and CI;
health checks alone do not prove browser login. Authentication diagnostics log
stage, duration, generated request ID and API status without callback queries.

The API is available at `http://localhost:3001/v1/health/live` and
`http://localhost:3001/v1/health/ready`. The marketplace shell runs on
port 3000, the separate staff shell on port 3002, and Expo starts the
mobile development shell with `pnpm --filter @pachi/mobile start`.

The identity foundation exposes `POST /v1/auth/bootstrap`,
`GET /v1/account/me`, `GET /v1/account/sessions`,
`POST /v1/account/logout`, and `POST /v1/account/logout-all`. These
endpoints accept Cognito access tokens only when Cognito settings are
configured; local tests use a separate synthetic signed issuer and never
enable that issuer in production. The response contract is in
`packages/contracts` and the API description is in `apps/api/openapi.yaml`.

Phone ownership uses `POST /v1/account/phone/request` and
`POST /v1/account/phone/confirm`. Local delivery uses an isolated test sink;
production SMS is intentionally not configured until the documented E02 gate.
The request response never contains an OTP.

For local-only phone testing, use the synthetic Cameroon number
`+237690000001` after signing in and requesting a code in the web account
screen. Copy the returned `challengeId`, then retrieve the in-memory sink code
from the loopback-only development endpoint:

```bash
curl http://localhost:3001/v1/dev/local-sms/CHALLENGE_ID
```

This endpoint exists only when `NODE_ENV=development` and the request comes
from loopback. It is not available in production, and OTPs are not returned
by normal phone APIs, rendered in the web UI, or written to logs. Restarting
the API clears the in-memory sink.

## Private property and listing drafts

Design direction note (2026-09-26): the `/preview` experiment is not approved
as Pachi's visual direction. Keep it isolated from functional marketplace and
provider screens and native mobile work; the target remains a premium mobile
housing app with responsive marketplace web alongside it.

The individual provider workspace is available at `http://localhost:3000/provider`.
For a local walkthrough, sign in at `http://localhost:3000`, confirm the
synthetic phone number using the development SMS sink above, and complete the
individual provider profile from the account page. Then open the provider
workspace, create a property, and select its relationship declaration
(`OWNER`, `AUTHORIZED_AGENT`, or `PROPERTY_MANAGER`). The property and its
provider relationship are persisted as separate records.

Create a private listing draft by selecting one of the saved properties and a
purpose. The form stores listing copy as a listing revision and XAF commercial
terms as an offering version. Rent drafts accept monthly price, deposit,
advance months, minimum lease length, utilities, service charge and availability;
sale drafts accept total price, negotiability and availability; short-let drafts
accept nightly and optional weekly rates, minimum nights, guest limit,
check-in/check-out times, cleaning fee and availability. Select a saved draft
to reopen its current values, edit listing copy or purpose-specific terms, and
save. Each save creates a new immutable revision/version; returning to the
draft list reloads the persisted current version.

These routes are authenticated and provider-scoped. The API requires an ACTIVE,
phone-confirmed user and an eligible individual provider profile; provider
identity verification is not claimed by this local slice. Draft readiness and
submission are described below; submission moves only a fully eligible exact
revision to `PENDING_REVIEW`/`IN_REVIEW`. It does not approve, publish, or
change market status. API paths and schemas are described in
`apps/api/openapi.yaml`; TypeScript request and response types live in
`packages/contracts`.

## Private draft photo management

Run the API and web as above, and start the local ClamAV adapter and worker in
additional terminals:

```bash
docker compose up -d clamav
pnpm dev worker # only if it is not already running through pnpm dev
```

The API writes originals to ignored `/.local-media/` quarantine storage. The
worker scans through the loopback-only ClamAV service, decodes and re-encodes
JPEG/PNG/WebP uploads with Sharp, strips source metadata, and creates private
WebP derivatives at 320, 640, 1280 and 1920 pixel bounds. Processing status is
persisted in PostgreSQL; an unavailable scanner leaves a retryable failed
status and never marks media READY. Uploads are limited to 15 MiB, 40
megapixels and 20 photos per listing. The local quota defaults are 1,000
active/reserved provider assets, 2 GiB reserved/active provider originals,
five simultaneous upload authorizations and 100 upload authorizations per
provider per hour. Expired unattached upload intents are cleaned by the worker.

In the authenticated provider workspace, reopen a private listing draft and
use **Draft photos** to upload, wait for scan/processing, move photos up/down,
set a processed cover, retry transient failures, or remove a photo. Reloading
the draft reloads photo order, cover, derivative previews and processing state.
Originals and private draft derivatives stay behind provider-scoped API checks;
`READY` does not mean moderation-approved or published. Guarded public derivatives
are served only for eligible approved published listings, as evidenced in synthetic G2.

This is a local filesystem/worker/ClamAV adapter only. Production S3 bucket and
IAM separation, KMS, scoped presigned upload URLs, SQS/DLQ delivery, malware
signature operations/monitoring, CloudFront authorization/invalidation,
retention reconciliation and production orphan deletion controls remain
unimplemented. This slice is not production-ready and is not G1 evidence.

## Listing readiness and review submission

After preparing a private draft, open it in the provider workspace and use
**Listing readiness** to refresh the backend-owned checklist. The checklist
covers current listing content, property specification and location, active
property state, a current declared/verified relationship, enabled region,
purpose-compatible XAF terms and availability, processed media and cover, and
account/provider eligibility. The workspace displays stable blocker codes and
field-level messages; client checks do not replace the API decision.

When every required capability is available, **Submit for review** binds the
current listing revision, offering version, ordered media and cover selection in
an immutable submission snapshot. The command is authorization-checked and
idempotent, records the existing audit event, and moves only the publication
axis to `PENDING_REVIEW` while moderation becomes `IN_REVIEW`. Draft edits and
photo changes are then unavailable until a documented review outcome permits
correction. Approval, publication and market status remain separate staff or
domain operations.

Photo content review is separate from technical processing. A region-scoped
`LISTING_MODERATOR` can review a current `READY` draft photo and record
`APPROVED`, `CHANGES_REQUIRED`, or `REJECTED` with a reason. The provider sees
the decision and any replacement action. `MEDIA_CONTENT_APPROVAL_REQUIRED`
remains blocked until every current photo has content approval; `READY` alone
never satisfies it. The
`PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE` check reads the current,
evidence-backed provider claim. Synthetic claims count only in isolated tests;
outside tests, real intake is disabled pending E01, so this check remains
blocked. An expired claim also blocks immediately.
Do not change verification records manually to make a submission succeed.
A complete eligible submission walkthrough with current CLEAR authority is recorded
in isolated synthetic G2 acceptance. Synthetic provider claims never count outside
isolated tests; real verification remains E01-gated. Blocked readiness,
cross-provider scope, stale versions, and duplicate-safe command behavior are
covered against the disposable test database. If the web session expires or an
API data request is unauthorized, the account and provider screens show a
session/data error or sign-in prompt rather than presenting empty collections.

## Provider identity verification

The provider workspace shows the latest `PROVIDER_IDENTITY` case, its decision
reason and next action. Its submission audit records declared provider capacity; the case holds synthetic
government-ID and live-selfie evidence classes, an immutable submitted snapshot,
policy version and a unique request key. Correction, rejection recovery and
renewal create linked cases; a pending case cannot be duplicated. The admin
workspace opens a case by the reference shown to its applicant. An assigned
`VERIFICATION_OFFICER` with an unexpired case grant for `provider:verify` and
`evidence:read` reviews both evidence classes and records `VERIFIED`, `REJECTED`
or `NEEDS_RESUBMISSION` with an outcome-specific reason. Review and decision
require staff TOTP reauthentication within 15 minutes. A separate current
`admin:permissions_manage` grant may assign an already scoped officer, but does
not permit a verification decision. Applicant/reviewer conflicts are denied.

The decision, current claim, provider projection, audit and durable event row
change in one transaction. Listing readiness reads the live claim instead of a
profile flag. A local worker expires claims and pauses dependent published
listings; reads fail closed immediately at expiry. Synthetic evidence is encrypted,
excluded from listing media and public DTOs, access-audited, deleted 30 days
after case closure unless held, and never put on a public CDN. No public
evidence URL exists in this slice.

**E01 still blocks real identity intake.** The approved Cameroon document list,
privacy notice, retention schedule and deletion/backup treatment must be
recorded before real documents are collected. This implementation accepts only
exact synthetic samples in isolated tests. A local development demo needs both
`PACHI_SYNTHETIC_VERIFICATION_EVIDENCE=enabled` and a distinct
`VERIFICATION_EVIDENCE_SECRET` of at least 32 characters in the ignored root
environment file; production ignores the flag. Never put real documents in the
demo. The live provider account and human staff grant are unchanged. When real
evidence intake is implemented after E01, an operator must create a **new**, narrowly
scoped `VERIFICATION_OFFICER` grant for that case through the existing reviewed
`staff:grant` command, then assign it with an eligible recently authenticated
admin session. Do not add `provider:verify` to an existing `SUPER_ADMIN` grant or
extend that grant automatically. Real evidence storage/processing, appeal and
notification acceptance remain separate release work.

## Web authentication setup

The web shell uses server-side `openid-client` Authorization Code + PKCE and
an opaque Secure, HttpOnly, SameSite cookie. Token ciphertext is encrypted in
the server-side PostgreSQL web session store; tokens are never placed in
browser storage or rendered into pages. Without Cognito settings,
the app remains in its signed-out development state.

For nonproduction Cognito setup, create a User Pool app client with a client
secret, authorization-code grant, S256 PKCE, and scopes
`openid email profile pachi/account`. The `pachi/account` scope must be an
approved Cognito resource-server scope for the app client because the API
requires it.
Set the allowed callback URL to:

```text
http://localhost:3000/api/auth/callback
```

Set the allowed sign-out URL to:

```text
http://localhost:3000
```

Copy `.env.example` to `.env` and set `COGNITO_ISSUER`,
`COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_DOMAIN`, `WEB_SESSION_SECRET`, and
`PACHI_API_URL`. Cognito managed-login, real credentials, cloud resources,
and real SMS are not provisioned by this repository. Real Cognito sign-in has
been confirmed against the temporary development sandbox; Google/Apple
federation and production callback domains require separate approved setup.

Before the first real nonproduction sign-in, create the Cognito User Pool/app
client and resource-server scope, configure the callback and sign-out URLs
above, set the web environment values, ensure the API issuer/client/scope
settings match, start Postgres/API/web, and open `http://localhost:3000`.
Real Cognito sign-in is confirmed; phone ownership remains simulated through
the development SMS sink and is not proof of control of a real phone number.

This local Cognito configuration is a temporary standalone AWS Free-plan
sandbox in Ireland using localhost callbacks. It does not provide the planned
staging/production AWS account separation or production readiness evidence.

Run the foundation checks with `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm build`. These checks do not replace the documented
G1-G6 evidence gates.

Provider photo-refresh browser regressions use a fresh Chromium profile and
synthetic API responses; they do not access real accounts or write development
records. Install the pinned test browser once:

```bash
pnpm --filter @pachi/web exec playwright install --with-deps chromium --only-shell
```

On this Ubuntu 26.04 development host, the compatible Ubuntu 24.04 browser and
its required libraries are already installed under ignored `.local-dev/browser/`.
Use them from the repository root without changing system packages:

```bash
LD_LIBRARY_PATH="$PWD/.local-dev/browser/libs/usr/lib/x86_64-linux-gnu" \
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 \
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local-dev/browser/browsers" \
PACHI_BROWSER_BASE_URL=http://localhost:3000 pnpm --filter @pachi/web test:browser
```

With the development web already running, use
`PACHI_BROWSER_BASE_URL=http://localhost:3000 pnpm --filter @pachi/web test:browser`.
After a production build, `pnpm --filter @pachi/web test:browser` starts an
isolated server on 3100 and stops it afterward. CI runs this suite after build.
It covers processing-to-ready, unsaved form input, request failures, draft
switches and upload-poll races. Real-account acceptance remains separate.

## Staff authentication setup

The functional staff shell is separate at `http://localhost:3002`. The default
`pnpm dev` still starts API/web/worker. Copy only the **new**
`apps/admin/.env.example` to `apps/admin/.env` if that file does not already exist,
then run `pnpm dev admin` in another terminal. The launcher reads root `.env`,
overlays `apps/admin/.env`, filters inherited test settings and checks port 3002.
An empty staff configuration displays configuration guidance. Marketplace
configuration, secrets and cookies must remain unchanged. Admin uses a distinct
`pachi_staff_session` cookie and encryption secret; no tokens reach browser JS.

Before real staff login, provision a **new nonproduction staff pool**, not a
change to the existing marketplace pool. ADR 0002 explains the isolation decision.
Required setup (not performed by the repository):

Required MFA is configured on a user pool, not on an individual app client.
Enabling it on the marketplace pool would change sign-in requirements for its
users, so staff must use a dedicated pool. Cognito managed login is available
from the Essentials tier; with required MFA and TOTP enabled, managed login
handles first-password setup and TOTP enrollment. See AWS's current guides for
[pool MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html),
[TOTP](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html),
and [feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html).

1. In the nonproduction AWS account/region, create a Cognito Essentials-or-higher
   pool with a Cognito domain using
   [managed-login version 2](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain-prefix.html),
   minimum password length 12,
   admin-created users only, required MFA (`ON`), software TOTP enabled, SMS/email
   MFA disabled, no remembered-device configuration and no external IdPs. Keep
   password-based local authentication (`AllowedFirstAuthFactors: [PASSWORD]`);
   do not enable passkeys, custom or passwordless flows.
2. Create resource-server identifier `pachi` and scope `staff`. Create a separate
   confidential app client, supported provider `COGNITO` only, OAuth code grant
   only, scopes `openid email pachi/staff`, token revocation enabled, access-token
   validity **5 minutes**, refresh-token rotation enabled with **10 seconds**
   grace. For explicit SDK flows allow only `ALLOW_USER_SRP_AUTH`; disable
   `REFRESH_TOKEN_AUTH` and custom auth; Cognito does not support that refresh
   flow together with token rotation
   ([refresh-token guidance](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)).
   Use an 8-hour refresh validity (the app
   independently enforces its 8-hour absolute / 30-minute idle maximum).
3. Allow exactly callback `http://localhost:3002/api/auth/callback` and logout
   `http://localhost:3002`. Assign managed-login branding to this client. Production
   requires its own HTTPS origin, callback, client and pool, never localhost.
4. Set the admin-only issuer, client ID/secret/domain, origin, independent random
   session secret (at least 32 characters) and API URL in `apps/admin/.env`.
   Set only `STAFF_COGNITO_ISSUER` and `STAFF_COGNITO_CLIENT_ID` in the API's root
   `.env` as well. Do not add staff clients to `COGNITO_CLIENT_IDS`. Optional
   `STAFF_API_AUDIENCE` validates a deliberately configured API audience; the
   default code flow does not request resource binding.
5. Give the admin server short-lived AWS credentials (local AWS SSO/profile,
   workload role when deployed) for `DescribeUserPool`, `GetUserPoolMfaConfig`,
   `DescribeUserPoolClient`, `DescribeUserPoolDomain` and `AdminGetUser`, scoped to
   this staff pool where AWS supports resource scoping. It needs no pool mutation
   permission. The operator commands additionally need controlled database write
   access. Keep operator credential access separate from ordinary app users.
6. Migration 0014 was applied on 2026-09-27 to the confirmed development target
   `localhost:5432/pachi_local` with `pnpm db:migrate`. The reviewed migration
   creates the four staff tables and does not modify existing marketplace rows.
   Automated verification uses **only** `db:migrate:test` and
   `localhost:5433/pachi_test`.
7. Create a local Cognito staff user through the operator-controlled console,
   have that person set their password/enroll TOTP in managed login. Never send
   credentials or TOTP codes through chat. Record the verified **subject**, not
   email. An initial login without a mapped grant is intentionally denied.

Development configuration supplied by the user (2026-09-27): region `eu-west-1`,
pool `eu-west-1_7uju5eCyw`, client `6o98a1sg9j9qghna441so80s2u`, issuer
`https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_7uju5eCyw`, domain
`https://eu-west-17uju5ecyw.auth.eu-west-1.amazoncognito.com`. Public OIDC discovery
was independently reachable and matched the issuer/domain. This does **not** verify
MFA, registration policy, client secret, scopes, rotation or token lifetimes.

Those identifiers are configured in the ignored root/admin environment files.
Marketplace settings and existing secrets were preserved. The client secret is now
present in `apps/admin/.env` and passes local configuration validation. After
editing this file, restart the identified admin launcher: its inherited settings
take precedence over Next's dotenv reload. On 2026-09-27, restarting admin resolved
login configuration 503 into the expected Cognito 303 redirect with PKCE; a
marketplace-origin POST remains 403. This does not prove secret validity at token
exchange, MFA, or authenticated access.

The existing validator requires authenticated AWS API access. STS verified
`pachi-dev-source` as `arn:aws:iam::451475820431:user/pachi-david-dev` on
2026-09-27. Runtime-role provisioning is blocked by `iam:CreateRole` AccessDenied. IAM Identity Center/SSO is **not** a prerequisite: use an
existing authorized IAM role/profile or ask the account administrator for a
profile with these permissions. Four operations can be scoped to
`arn:aws:cognito-idp:eu-west-1:451475820431:userpool/eu-west-1_7uju5eCyw`:
`cognito-idp:DescribeUserPool`, `cognito-idp:GetUserPoolMfaConfig`,
`cognito-idp:DescribeUserPoolClient`, `cognito-idp:AdminGetUser`.
`cognito-idp:DescribeUserPoolDomain` requires `Resource: "*"`; restrict its
`aws:RequestedRegion` condition to `eu-west-1`. No write/list/admin-wide policy
is needed. An account administrator can use this policy after replacing the
account placeholder with the actual development account ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:DescribeUserPool",
        "cognito-idp:GetUserPoolMfaConfig",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:AdminGetUser"
      ],
      "Resource": "arn:aws:cognito-idp:eu-west-1:451475820431:userpool/eu-west-1_7uju5eCyw"
    },
    {
      "Effect": "Allow",
      "Action": "cognito-idp:DescribeUserPoolDomain",
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "eu-west-1" } }
    }
  ]
}
```

 Cognito client credentials cannot replace these AWS IAM credentials.

Existing IAM identity (STS verified; group/policy membership remains user-reported):
`pachi-david-dev`, previously in `PachiCognitoDevelopers` with
`AmazonCognitoPowerUser`. Preserve its resource-management access; do not create
another IAM user or attach the read-only policy alongside broad policies and
claim that narrows access. Profile names do not restrict IAM permissions.

Use a separate assumed runtime role with only the read-only policy above, a trust
policy restricted to the actual existing developer principal, and explicit
`sts:AssumeRole` permission on that principal for this role. Account ID is verified;
current developer permissions require administrator inspection.
Keep the developer console-login source profile for management; run admin using
only the role profile. Example `~/.aws/config` (placeholders must be resolved):

```ini
[profile pachi-staff-runtime]
role_arn = arn:aws:iam::451475820431:role/PachiStaffRuntimeReadOnly
source_profile = pachi-dev-source
region = eu-west-1
```

Validate the resolved assumed-role ARN and effective policies before selecting
this profile for the app. No IAM resources or policies have been changed here.

#### Administrator console step: development runtime role

Latest verification (2026-09-27): the role now exists. CLI and admin SDK resolve
`pachi-staff-runtime` to the expected assumed role; trust and one-hour session
limit are verified. Policy enumeration is denied, so complete role permissions
remain administrator-reported. All required Cognito reads succeed. The existing
pool/client checks now pass after authorized changes to minimum password length
12 and SRP-only ExplicitAuthFlows; before/after comparisons preserved all other
settings. The inspected user's MFA list remains empty, so full user attestation
is pending. Admin was restarted with the runtime profile for a fresh managed-login
TOTP attempt; callback enforcement is unchanged.
See the [shared handoff](docs/engineering/current-state.md) for current evidence;
the provisioning observations below describe the earlier setup attempt.

Role inventory contains only three AWS service-linked roles; GetRole confirms
`PachiStaffRuntimeReadOnly` is absent. CreateRole returned AccessDenied. Do not
add IAM provisioning permissions to the developer to work around that denial.
The local `pachi-staff-runtime` profile is prepared in `~/.aws/config`, but cannot
resolve until the role and assumption permission exist. Admin has not been
restarted with either AWS profile.

An authorized account administrator should:

1. Confirm the console account is `451475820431`. In **IAM → Roles**, check again
   for `PachiStaffRuntimeReadOnly`; if it now exists, inspect its trust, attached
   and inline policies, boundary and ownership instead of creating a duplicate.
2. Choose **Create role → Custom trust policy** and paste
   [staff-runtime-trust.json](docs/03-operations/iam/staff-runtime-trust.json).
   This delegates to the account only when the caller ARN is exactly the existing
   developer user; it requires that user's AssumeRole permission. The account
   principal in this JSON does not mean authenticating with root credentials.
   Preserve any applicable organization, boundary or administrator-required
   security conditions; do not relax them to make assumption work.
3. Select no broad managed policies. Name the role `PachiStaffRuntimeReadOnly`,
   with maximum session duration **1 hour**, and create it. Under its Permissions,
   choose **Add permissions → Create inline policy → JSON**, paste
   [staff-runtime-permissions.json](docs/03-operations/iam/staff-runtime-permissions.json),
   and name it `PachiStaffCognitoInspection`. This is the exact read-only policy
   above; attach no other runtime permission policies.
4. Under **IAM → Users → pachi-david-dev → Permissions**, inspect existing
   permissions first. If the exact role is not already assumable, add the inline
   policy [staff-runtime-assume.json](docs/03-operations/iam/staff-runtime-assume.json)
   named `AssumePachiStaffRuntime`. Keep all existing developer management
   permissions and applicable boundaries/conditions intact.
5. Report that the role is ready (identifiers only). The next agent verifies CLI
   and admin SDK assumed-role identity and policies, runs the existing Cognito
   validator, and only then restarts admin with `AWS_PROFILE=pachi-staff-runtime`.
   No Cognito setting or staff grant is changed by this IAM setup.

The trust design follows [AWS account principals](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#principal-accounts).


AWS CLI 2.37.4 is available at `.local-dev/aws-cli/bin/aws`. The installed SDK's
INI provider supports `login_session`, role profiles and credential processes.
For an existing **non-root** console IAM/federated identity scoped to the policy
above, an administrator must also permit `SignInLocalDevelopmentAccess` for
browser-based local login. Then run from the repository root:

```bash
./.local-dev/aws-cli/bin/aws login --profile pachi-dev-source --region eu-west-1
```

Select that non-root development identity in your browser. This obtains temporary
credentials without creating access keys or requiring SSO. See
[AWS local-development login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).
If only root access exists, the account administrator must first provide a scoped
non-root identity; do not connect the application as root. Share only the profile
name after login, never credentials or browser authorization material.
 Configure a named profile
through the account's existing credential mechanism (SSO only if already used),
keeping credentials in the user's AWS files, outside Git. Temporary role
credentials in `~/.aws/credentials` require access key, secret key and session
token together. Select the profile with `AWS_PROFILE=<profile>` when launching
`pnpm dev admin` and the operator commands; the launcher forwards that selector.
Do not put AWS credentials into chat or the repository environment files.

Once the secret and AWS access are available, inspect actual policy before login.
Open `http://localhost:3002`, choose **Sign in with staff account**, and use the
explicitly selected local user in this dedicated pool. Replace a temporary
password if prompted, then enroll an authenticator and enter its TOTP directly
on Cognito. An authenticated user without a mapped grant must be denied first.
Establish the dedicated issuer/subject unambiguously before using the audited
identity/grant commands below; equal emails never identify the grant target.
Real role/scope display, logout, TOTP reauthentication/session replacement and
marketplace-token rejection have recorded evidence in the [shared handoff](docs/engineering/current-state.md).
The separate real mapped-but-ungranted browser case remains pending; an earlier
absent-mapping denial is not that case. The real reauthentication and server
permission-guard freshness evidence do not certify unimplemented sensitive
business operations or G1 completion.

For operator commands, load the intended root/admin files explicitly in a clean
operator shell (Node supports `--env-file`); do not reuse a test shell. From root:

```bash
node --env-file=.env --env-file=apps/admin/.env --import ./apps/admin/node_modules/tsx/dist/loader.mjs apps/admin/scripts/staff-identity.mts /private/identity.json
node --env-file=.env --env-file=apps/admin/.env --import ./apps/admin/node_modules/tsx/dist/loader.mjs apps/admin/scripts/staff-grant.mts /private/grant.json
node --env-file=.env --env-file=apps/admin/.env --import ./apps/admin/node_modules/tsx/dist/loader.mjs apps/admin/scripts/staff-revoke.mts /private/revoke.json
```

Keep input files outside Git, mode 0600. Identity input is
`{operator, subject, displayName, reason}`; it creates a **new**, unprivileged
PENDING_PHONE application user and prints its user ID. It refuses an already
mapped subject and cannot merge/link the development provider. Grant input is
`{operator, userId, subject, role, scope, reason, expiresAt}`; the issuer comes
from staff configuration. Use the returned explicit user ID, an accountable
operator/SSO identity, an operational reason of at least 10 characters and an
explicit ISO expiry. Initial permission-management scope is
`{"kind":"platform","id":"pachi","permissions":["admin:permissions_manage"]}`
with `SUPER_ADMIN`. This grants no general private evidence/message access.
Other role ceilings and case/region scope checks live in the staff policy module
and follow the canonical role matrix. Revoke input is `{operator, grantId, reason}`;
use the grant ID returned by the provisioning command. All
successful operations and mapped failures append a staff audit record. Grant
changes revoke existing staff sessions so the next login regenerates the cookie. The CLI
is an operator boundary, not a public privilege-management API or dashboard.

Open the admin app and sign in. Confirm eligible identity/role/scope summaries,
logout and reauthentication; test denied login with an ungranted staff user.
Sensitive endpoints use `requireStaffPermission`, current grant and resource
eligibility, purpose/reason and audit. Provider identity case decisions for synthetic
evidence, scoped media approval, exact listing moderation and guarded publication
are implemented and evidenced in the recorded synthetic/local G2 acceptance.

Automated policy, session, signed-token HTTP and Playwright checks use synthetic
identities/isolated data. They do not prove real Cognito login, TOTP enrolment,
AWS IAM configuration or provider rotation. Earlier real staff foundation
acceptance completed G1. The new verification workflow has synthetic tests
only; production readiness remains incomplete.

### Isolated local backup/restore check

Run `python3 scripts/check-local-restore.py` from the repository root with the
existing `pachi-postgres-test-1` service running. It verifies the source is
`localhost:5433/pachi_test`, captures a private custom-format dump outside Git,
and restores into a new disposable container with no network or published port.
It waits for the final PostgreSQL process, then creates the destination from
`template0` so PostGIS initialization schemas cannot collide with the dump.
It compares all public table counts/content hashes, extensions, constraints and
index validity, verifies the source is unchanged, and removes only its own target
container/anonymous volumes. Dumps and sanitized evidence remain under
`~/.local/share/pachi/g1-restore` (0700 directory, 0600 files).

This exercises the local mechanism in the accepted
[restore procedure](docs/03-operations/deployment-and-operation-runbook.md#restore-procedure).
It does not demonstrate deployed RDS recovery, media/identity/key restoration,
cross-region recovery or E04. Current results belong in the
[shared handoff](docs/engineering/current-state.md).

### G1 security and consistency checks

Run `pnpm check:secrets`, `pnpm check:dependencies`, and `pnpm check:contracts`.
CI runs all three as ordinary failing steps (no `continue-on-error`).

- Secret scanning uses [Gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1,
  SHA256-verified Linux x64 release, full fetched Git history and 100% redaction.
  A generated disposable private-key canary must return failure first. Only two
  exact historical synthetic-test finding fingerprints are ignored; reasons are
  beside them in `.gitleaksignore`. No file/directory blanket exclusions.
- [pnpm audit](https://pnpm.io/cli/audit) checks production AND development
  dependencies at severity `low` and above; registry errors also fail. There are
  exactly two temporary advisory exceptions, enforced by the policy checker:
  `GHSA-86w9-cpqp-85rv` and `GHSA-vfj7-8cjw-p6xm`, due for review on
  2026-10-16. Scoped overrides in `pnpm-workspace.yaml` fix upstream
  transitive pins. Metro 0.83.8 is required with image-size 2.0.3 because the old
  Metro passes filenames to the removed v1 API. Mobile exports exercise this
  compatibility; xcode's UUID v4 and query-string decoding retain their used APIs.
- Contract checking generates types from OpenAPI in a temporary directory,
  compares every shared schema bidirectionally with `@pachi/contracts`, and
  checks the exact Nest controller method/path inventory plus SQL/journal
  consistency. Negative mutations prove route, field-type and required-field
  drift fail. BootstrapRequest remains an inline controller input, not an exported
  shared DTO. This is structural consistency, not proof that arbitrary runtime
  JSON conforms: HTTP integration tests exercise the implemented runtime guards.

Migration 0015 provides the organization authorization foundation. Additive
migration 0028 supports atomic organization onboarding, a stable organization
ProviderAccount, private ordinary-role invitations and audited membership
commands. `/organizations` is the functional web workspace. The API rechecks
registered session, ACTIVE account, current verified phone and current membership
authority; mutations use idempotency keys and expected versions. OWNER/ADMIN
targets and grants are denied by these ordinary commands. A deferred database
constraint protects the final active owner of onboarded organizations. Legacy
foundation rows remain unavailable to these lifecycle APIs until onboarded;
this migration does not fabricate owners or rewrite existing data.

Invitations last exactly seven days and bind to the recipient's current verified
phone contact and verification version. Only token digests are persisted. The
private in-memory delivery adapter is injected by isolated tests; the default
runtime has no delivery adapter and returns `DELIVERY_UNAVAILABLE` before creating
an invitation. No token retrieval endpoint exists. Recipient commands consume a
privately delivered token in the request body. External delivery remains deferred.

Organization ACTIVE and ProviderAccount existence do not establish BUSINESS
verification, publication or messaging eligibility. Ownership/admin delegation,
MFA step-up, transfer/recovery and resource assignments remain deferred. Mobile
organization screens and real-account acceptance are also deferred; G3 remains
NOT RUN. Validation uses only guarded `localhost:5433/pachi_test`; development
data and Cognito are preserved.
