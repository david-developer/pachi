# Pachi — Reconciled Documentation Package

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

This repository contains the canonical product documentation and an incrementally implemented local foundation. Current local slices include Cognito-backed web authentication, phone-confirmation test delivery, individual provider onboarding, and private property/listing-draft preparation. None of these slices imply production readiness, public listing publication, cloud provisioning, or executed production migrations.

Design direction note (2026-09-26): `/preview` was a review experiment and is
not approved as Pachi's visual direction. Keep it isolated from functional
marketplace/provider screens and native mobile work while the premium mobile
housing direction is explored separately.

Start with [docs/README.md](docs/README.md). Replace the corresponding files in your repository's `docs/` directory, inspect the diff, preserve unrelated files and make a separate documentation commit. This package README is delivery guidance; merge any useful notes into the existing repository README rather than overwriting unrelated project instructions.

See [reconciliation record](docs/archive/documentation-migration-record.md) for deliberate changes, resolved questions and remaining launch evidence. Historical source material is archived and is not a second implementation specification.

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
Photos and derivatives stay behind provider-scoped API checks; `READY` does not
mean moderation-approved or published. No public media route is enabled.

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

This local foundation deliberately reports `MEDIA_APPROVAL_UNAVAILABLE` and
`PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE`: `READY` media is not approved
media, and the evidence-backed `PROVIDER_IDENTITY` capability is not present in
the current workspace. Do not change verification records manually to make a
submission succeed. A complete eligible submission walkthrough remains blocked
until those approved capabilities are implemented; blocked readiness,
cross-provider scope, stale versions, and duplicate-safe command behavior are
covered against the disposable test database. If the web session expires or an
API data request is unauthorized, the account and provider screens show a
session/data error or sign-in prompt rather than presenting empty collections.

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

1. In the nonproduction AWS account/region, create a Cognito Essentials-or-higher
   pool with managed-login domain **version 2**, minimum password length 12,
   admin-created users only, required MFA (`ON`), software TOTP enabled, SMS/email
   MFA disabled, no remembered-device configuration and no external IdPs. Keep
   password-based local authentication (`AllowedFirstAuthFactors: [PASSWORD]`);
   do not enable passkeys, custom or passwordless flows.
2. Create resource-server identifier `pachi` and scope `staff`. Create a separate
   confidential app client, supported provider `COGNITO` only, OAuth code grant
   only, scopes `openid email pachi/staff`, token revocation enabled, access-token
   validity **5 minutes**, refresh-token rotation enabled with **10 seconds**
   grace. For explicit SDK flows allow only `ALLOW_USER_SRP_AUTH`; disable
   `REFRESH_TOKEN_AUTH` and custom auth. Use an 8-hour refresh validity (the app
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
6. Apply migration 0014 with the normal reviewed migration command before use.
   During automated verification use **only** `db:migrate:test` and
   localhost:5433/pachi_test. This task does not silently migrate development.
7. Create a local Cognito staff user through the operator-controlled console,
   have that person set their password/enroll TOTP in managed login. Never send
   credentials or TOTP codes through chat. Record the verified **subject**, not
   email. An initial login without a mapped grant is intentionally denied.

For operator commands, load the intended root/admin files explicitly in a clean
operator shell (Node supports `--env-file`); do not reuse a test shell. From root:

```bash
node --env-file=.env --env-file=apps/admin/.env --import ./apps/admin/node_modules/tsx/dist/loader.mjs apps/admin/scripts/staff-identity.ts /private/identity.json
node --env-file=.env --env-file=apps/admin/.env --import ./apps/admin/node_modules/tsx/dist/loader.mjs apps/admin/scripts/staff-grant.ts /private/grant.json
node --env-file=.env --env-file=apps/admin/.env --import ./apps/admin/node_modules/tsx/dist/loader.mjs apps/admin/scripts/staff-revoke.ts /private/revoke.json
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
Sensitive future endpoints must use `requireStaffPermission`, current grant and
resource eligibility, purpose/reason and audit. This foundation implements none
of the verification, media approval, moderation or publication decisions.

Automated policy, session, signed-token HTTP and Playwright checks use synthetic
identities/isolated data. They do not prove real Cognito login, TOTP enrolment,
AWS IAM configuration or provider rotation. Real staff acceptance remains pending
until the new pool/client/user and these browser checks are completed. G1 and
production readiness remain incomplete.
