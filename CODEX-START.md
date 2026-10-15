# Pachi G3-I1 — Install the UI skill and redesign PR #51

This file is a ready-to-use Codex task. The accompanying folder contains the authoritative proposed brand direction and an original repo-local UI skill.

## Starting constraints

Repository: `david-developer/pachi`.
Main baseline: `dfd8e191e42d23aa5a0eaf22e4f3c0258b12d697`.
Existing PR #51: OPEN / DRAFT / UNMERGED, head `b828756bbaf08487900cb11700652c8b7978653e` at prior independent verification.
Final successful CI: push `38629616342`; PR `38629626847`.

Verify current identities; do not assume they remain unchanged. Preserve the existing worktree and its uncommitted screenshot handoff. No merge or deployment is authorized.

## A. Install the supplied kit

From the supplied archive, copy these files into the project with the same relative paths:

- `docs/design/pachi-visual-identity.md`
- `docs/design/assets/pachi-brand-exploration.png`
- `docs/design/assets/pachi-wordmark-concept.svg`
- `docs/design/assets/pachi-mark-concept.svg`
- `.agents/skills/pachi-premium-ui/SKILL.md`
- `.agents/skills/pachi-premium-ui/references/visual-review-checklist.md`

Do not overwrite unrelated files. Inspect the files for safety and relevance before adopting them. Add a single brief note to the existing repository `AGENTS.md` (if present) directing UI tasks to use `$pachi-premium-ui`; do not replace established instructions.

Treat brand directions and logo explorations as **proposals requiring owner approval**, not irreversible brand choices.

## B. Redesign within PR #51

The owner visually rejected G3-I1's initial screenshots as too generic and WordPress-like, even though technical tests passed. We need substantive composition improvements, not merely fresh colors.

Read and explicitly invoke `$pachi-premium-ui`. Preserve the valuable implemented flows, tests and architecture. Rework homepage, search results and listing detail with the coherent premium architectural direction in the brand guide.

Required improvements:

1. Create a refined **vector PACHI wordmark** with a distinctive building-shaped A. Use the supplied concept only as an exploratory starting point. Show logo clearly at desktop/mobile header and favicon size. No new external branding dependency.
2. Create an immersive homepage with purposeful hierarchy: editorial proposition + functional search + actual listing photography (or refined no-media fallback). Reduce large bland color fields; do not invent listings.
3. Make results compelling for comparison: strong property photography, price/period hierarchy, location and facts, refined cards, polished desktop filters and mobile filtering.
4. Recompose detail page with large immersive gallery, well-structured specifications and terms, desktop sticky inquiry area, and accessible mobile contact. Preserve all privacy and account gates.
5. Replace repeated demo photo evidence with multiple **visually distinct synthetic TEST media** (not live inventory), plus missing-photo and no-listing cases.

Use existing Next.js, backend contracts and stable runtime. No unrelated feature scope, React Native implementation, migration, new CSS framework, fake claims or real customer activity.

## C. Mandatory visual and technical gate

Capture screenshot sets at 1440, 768 and 390 px for `/`, `/listings` and `/listings/[id]`, plus empty/missing-media states. Render and inspect *before and after*. Iterate on visuals at least once after the first corrected render. Report scores and actual weaknesses using the included checklist.

Verify keyboard, contrast, mobile overflow, auth navigation/returnTo, provider onboarding, XAF numbers, API search/URL/pagination, galleries, published-only reputation, private addresses, CSRF/idempotency and block/phone gates.

Run targeted web Playwright and normal CI. Ordinary repair on the same draft PR is authorized. Do not weaken privacy assertions. Keep archived evidence locally; do not add large screenshot binaries to Git history unless the existing repo explicitly requires them.

## D. Delivery

Commit the coherent skill/guide and final redesign to PR #51, push without force, verify final-head CI. Do **not merge**.

Give the user exact screenshot paths and a concise report covering how the composition changed, logo/vector files, functional regression results and six visual scores. State clearly that premium visual acceptance is pending owner review.

Success: `G3-I1 PREMIUM REDESIGN READY — SCREENSHOT APPROVAL REQUIRED — PR #51 UNMERGED`.
Stop. Do not start new UI features or security work.
