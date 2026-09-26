# Pachi working agreement

Read [docs/README.md](docs/README.md), the relevant product/domain requirements,
accepted ADRs, and [.github/copilot-instructions.md](.github/copilot-instructions.md)
before changing behavior. Nested AGENTS.md rules also apply.

## Continuity

Use [docs/engineering/current-state.md](docs/engineering/current-state.md) as the
single engineering handoff. Read it on arrival; update it after meaningful
changes/diagnostics and before stopping. Separate verified evidence, historical
reports, assumptions, blockers, and the next action. Include branch/base/HEAD,
outstanding edits, environment file locations (never values), services, migrations,
tests, browser evidence, and exact-commit CI. Commit coherent checkpoints; label
incomplete work honestly. Do not maintain competing progress files.

## Scope and preservation

- Product specifications remain authoritative; progress notes cannot amend policy.
- Preserve the full Cameroon housing marketplace scope. The premium mobile app is
  primary; current web screens are functional development interfaces. `/preview`
  is not an approved visual direction.
- Keep work within the user-authorized maintenance scope in the shared handoff;
  do not start new features without authorization. Preserve authentication, authorization, CSRF, and submission
  gates. Media READY is not approval; identity verification remains required.
- Preserve existing edits, development data, accounts, secrets, and Cognito
  resources. Do not reset branches or databases to repair startup.
- Inspect actual listeners and configuration sources before restarting. Stop only
  identified project PIDs, never broad process-name patterns.
- Keep credentials, tokens, authorization codes, state, cookies, callback queries,
  private content, and database URL credentials out of logs and command output.
  Parse database URLs and report only host/port/database when needed.
- Use only localhost:5433/pachi_test for database tests. Never inject test issuer
  or database settings into development services.
- Health checks and synthetic auth tests do not prove real browser login. Record
  account/workspace/draft/photo/readiness evidence separately and state missing
  user/browser actions precisely.
