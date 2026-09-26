---
name: pachi-runtime-debugging
description: Diagnose Pachi local startup, port conflicts, environment leakage, and login or API regressions. Use for running-service failures, not designing new authentication features.
---

# Pachi runtime debugging

Use the existing [handoff](../../../docs/engineering/current-state.md) for the
latest evidence and [README local workflow](../../../README.md#local-foundation)
for commands and environment sources. Product/auth changes must follow the
[authority map](../../../docs/README.md) and
[authentication ADR](../../../docs/02-architecture/adr/0002-authentication-and-session-strategy.md).

Establish the failed boundary before modifying authentication: browser navigation,
Cognito exchange, callback, API bootstrap, or session persistence. Correlate a
fresh attempt's redacted stage/request IDs with API status and duration. A health
200 or negative-auth test is not proof of a working real login. If browser access
or credential entry is missing, complete independent diagnosis and state the
specific remaining user action; never obtain credentials through chat or logs.

Inspect actual listeners and their process working directories, not just launcher
PIDs. Compare configuration presence and source-file precedence without printing
values. Next loads settings after startup, so `/proc/PID/environ` alone cannot
prove its final environment. Parse database URLs and expose only host/port/name.
Historical callback logs may contain queries: select safe fields rather than tailing
raw logs. Follow root AGENTS.md's redaction rules.

Use `pnpm dev [all|api|web|worker]` from the root with the pinned toolchain; inspect
[scripts/dev.mjs](../../../scripts/dev.mjs) and
[environment loading](../../../scripts/dev-environment.mjs) if startup itself fails.
This launcher builds dependencies, isolates inherited test settings, checks ports,
and writes ignored `.local-dev` logs/PID files. Do not recreate the old bare Node,
Turbo-filtered or shell-sourced startup that lost Cognito settings. Treat a port
conflict as evidence to identify its owner; stop only verified project processes
when needed. Do not repeatedly restart if the next attempt reproduces the same
failure without new evidence, and do not reset databases, accounts or secrets.

For database tests, use the existing guarded
[database](../../../packages/database/scripts/test-integration.mjs) and
[API](../../../apps/api/scripts/test-integration.mjs) runners with the isolated
localhost:5433/pachi_test environment; never reuse a development-service shell.
Run checks appropriate to the fix and record the evidence, limitations and next
action in the same handoff. Keep submission/verification gates intact.
