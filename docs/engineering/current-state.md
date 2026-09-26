# Engineering handoff

Operational evidence only; [canonical documentation](../README.md) and its
authority order govern product behavior. Full scope is preserved. Premium mobile
is primary; functional web screens and the unapproved preview are not the visual
baseline. Current task: recover real login and durable development startup only.

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

Next: receive user confirmation of browser workspace/draft/photo/readiness, then
commit/push the bounded repair without merging and report exact-commit CI. Full build
will run in CI; avoid running next build over the active dev server's .next files.
