---
description: "Resume authorized engineering work in the Pachi repository"
agent: "agent"
---
Follow the root [AGENTS.md](../../AGENTS.md) as the primary repository
instructions.

1. Read [docs/README.md](../../docs/README.md) and
   [docs/engineering/current-state.md](../../docs/engineering/current-state.md).
2. Inspect `git status`, branch, HEAD, recent history, relevant branches and PRs,
   and exact-commit CI. Treat the live repository as authoritative; never assume
   an old handoff SHA is current.
3. Read the canonical product, domain, architecture, security and operations
   documents applicable to the task, following `docs/README.md` authority order.
4. Reconcile handoff, checklist, CI and canonical-document discrepancies before
   changing behavior. Resolve conflicting canonical rules before implementation.
5. Determine the next authorized task from current repository evidence and user
   scope; do not infer authorization from historical notes.
6. Make the smallest authorized change and run meaningful, task-scoped
   validation. Preserve authorization, identity, evidence, verification, session
   and moderation boundaries.
7. Update the shared handoff and affected evidence/checklist documentation with
   verified facts, exact commits/CI and remaining blockers. Distinguish synthetic,
   owner-reported and independently verified evidence.
8. Report commits, CI/evidence, unresolved blockers and the next authorized
   action accurately. Do not claim production readiness from G1.
