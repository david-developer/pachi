---
name: pachi-ui-verification
description: Reproduce and verify Pachi web interaction bugs with the existing Playwright suite, including stale UI, polling races, loading feedback, and unsaved form state. Not visual-design approval or proof of real Cognito login.
---

# Pachi UI verification

Start from the [handoff](../../../docs/engineering/current-state.md) and applicable
[web instructions](../../../apps/web/AGENTS.md). Use the canonical
[product authority map](../../../docs/README.md) for expected behavior. Functional
web screens and the unapproved preview are not Pachi's approved visual direction.

Trace the actual action: enabled/clickable control → handler → authenticated
request → response payload → displayed state. Reproduce before editing. Distinguish
no feedback from no request; check errors, cache behavior and older async work
before blaming an event handler. In photo-refresh incidents, delayed polling and
prior-draft responses overwrote current results despite `no-store` fetches.

Use the installed Playwright runner through `pnpm --filter @pachi/web test:browser`.
The [README browser setup](../../../README.md#web-authentication-setup) documents
both the existing-server command and this host's ignored browser/library paths.
Inspect [playwright.config.ts](../../../apps/web/playwright.config.ts) and the
[photo-refresh regression suite](../../../apps/web/tests/photo-refresh.spec.ts)
before extending them. With `PACHI_BROWSER_BASE_URL`, tests use the running web;
otherwise they start the existing production build on 3100. Do not build over the live dev
server's `.next` files. No browser MCP tool is assumed; use a connected browser
tool only if actually available and suitable for the task.

Use a fresh browser context and synthetic API interception for deterministic
transition/error/race tests, preserving real records. Control response timing to
prove that an older response cannot overwrite the selected draft or a newer result.
Check in-place processing-to-ready updates, loading/error feedback, preserved
unsaved inputs, selection switches and polling termination when relevant. Assert
visible behavior; account for Next's separate route-announcer alert in locators.
Do not broaden an unrelated UI edit into this entire regression matrix.

Synthetic session fixtures test UI behavior; they neither bypass server auth in
the app nor prove real-account login, authorization or worker processing. Describe
those evidence limits explicitly. Use the user's own credential entry for a real
flow when needed, without collecting cookies/tokens/callback queries. For a UI fix,
run affected lint/typecheck/unit/browser checks and update the existing handoff;
keep product approval and publication gates separate from technical media READY.
