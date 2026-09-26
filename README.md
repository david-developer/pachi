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

With the development web already running, use
`PACHI_BROWSER_BASE_URL=http://localhost:3000 pnpm --filter @pachi/web test:browser`.
After a production build, `pnpm --filter @pachi/web test:browser` starts an
isolated server on 3100 and stops it afterward. CI runs this suite after build.
It covers processing-to-ready, unsaved form input, request failures, draft
switches and upload-poll races. Real-account acceptance remains separate.
