Follow the root [AGENTS.md](../AGENTS.md) as the primary repository instructions.

Before implementation work, read [docs/README.md](../docs/README.md) and
[docs/engineering/current-state.md](../docs/engineering/current-state.md), then
follow the documentation authority order and read task-specific canonical
product, domain, architecture, security and operations documents.

At the start of resumed work, reconcile `git status`, branch, HEAD, recent history
and exact-commit CI with the shared handoff. Never assume a handoff SHA is current.
Preserve evidence-gated checklist semantics and update the handoff when verified
state, blockers, branches, CI evidence or the next handoff materially changes.

Do not regenerate secrets or overwrite ignored `.env` files with examples. Do not
weaken server authorization, identity, evidence, verification, session or
moderation boundaries to make tests pass. Archives and old chat transcripts are
not implementation authorities. Do not claim production readiness from G1.
