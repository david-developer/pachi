---
name: pachi-premium-ui
description: Design, implement, and visually critique Pachi's premium housing-marketplace web or native UI. Use for homepage, search, listing details, provider, account, messaging, mobile layouts, design tokens, brand assets, and UI review. Enforces screenshot-based acceptance and current marketplace safety contracts.
---

# Pachi premium UI

## Read first

Read `../../../docs/design/pachi-visual-identity.md` (relative to this skill directory). That document is the proposed Pachi art direction and current owner feedback. Read `references/visual-review-checklist.md` for the evidence requirements. Read only relevant code and existing product rules; never invent APIs or mock business capabilities for real screens.

## Mandate

Make Pachi look and work like a **distinctive, trusted Cameroon property marketplace**. Functional correctness is required; it is not proof of premium design. The first G3-I1 attempt passed CI but was rejected visually. Do **not** substitute a generic card dashboard or generic house symbol for the selected identity and established photographic composition. The owner-locked palette below remains authoritative. Give the interface coherent architecture, real media hierarchy, refined typography and intentional mobile behavior.

## Design-build-review loop

1. **Inspect:** Read target page, API contract, flow/security tests and screenshots; distinguish actual product data from synthetic fixtures. Identify three specific layout/brand deficiencies, not generic adjectives.
2. **Compose:** Propose one clear page composition and component hierarchy grounded in real-estate browsing. Choose tokens from the brand document, define a type scale and image treatments; specify the one signature architectural element. Do not invent decorative content to fill blank space.
3. **Implement:** Use the existing Next.js/React/CSS architecture for web and Expo/React Native when explicitly tasked for native. Share tokens and patterns, not inappropriate web components. Prefer a few polished reusable primitives; no large CSS/UI framework without a demonstrated need. Ship working search, media, session and contact behavior.
4. **Render:** Run the page locally with synthetic TEST fixture media at 390, 768 and 1440 px. Inspect screenshots visually, not just DOM/test output. Check actual type sizing, alignment, white space, imagery, cards, form density, button prominence and CTA reachability.
5. **Critique and revise:** Compare against the old screenshots and the intended hierarchy. Rework weak screens (not just recolor). Repeat the capture at least once after meaningful visual corrections. Do not describe an unfinished screen as premium.
6. **Regression:** Confirm all existing authorization and privacy requirements, automated browser assertions, and current mandatory CI. If the screenshot tool/browser is unavailable, say so and stop before visual acceptance.
7. **Handoff:** Deliver exact screenshot paths, before/after contrasts, 1–5 scores across all six visual criteria, real regressions, and remaining gaps. Human owner reviews visuals before a UI PR is merged.

## Current G3-I1 reference refinement

For the owner-supplied Lovable iteration, the listing-detail screenshots are the primary visual reference. Read DESIGN-BRIEF and view every supplied image before editing; compare against the latest rendered G3-I1 candidate, not just the original rejected version. Keep supplied archives and screenshot references in ignored evidence. Preserve public contract capabilities: the prototype is not a dataset or authority for identities, verification, amenities, saved state, ranking or confirmation dates. Deliver a direct element-by-element reference comparison, full-gallery/media-count and contact evidence, and actual owner-selected JPEG versus reconstructed SVG comparisons at equivalent scale, using the branding lock below. Do not replace that comparison with self-awarded rubric scores.

## Owner-selected branding lock

For the branding correction, the three actual JPEGs and BRAND-LOCK in ignored `.local-dev/pachi-approved-logo-references/` supersede the old exploration collage, concept SVGs and prior simplified runtime marks as logo authority. Read the lock and visually inspect all three actual images before edits; stop and report if any image is missing/unreadable. Reconstruct their flat underlying vector lettering, dominant triangular A, open light architectural channels, side piers and prominent sloping-top copper volume. Match primary/reversed/monochrome path geometry and the selected standalone icon's optical proportions; do not copy paper/relief/shadows or embed raster imagery. Preserve the current Lovable-guided page structure and all product contracts.

The exact palette is Forest `#0E3B2E`, Copper `#C47F56`, Ivory `#F8F6EE`, Sage `#D6DECF`. Forest is the primary CTA, copper an accent; accessible neutrals and semantic colors are permitted. Replace competing marketplace colors in place. Deliver actual-JPEG-versus-rendered-SVG comparisons at equivalent scale, icon at 16/32/48/160 px, reversed on forest and desktop/mobile interface captures. Keep references ignored, remove the temporary root ZIP after verified extraction, and stop at final owner inspection with PR #51 unmerged.

## Nonnegotiable UX rules

- Prioritize **legibility and decision making**: photo, price, offering period, location, key facts, and next action; not decorative widgets.
- No fake property inventory, reviews, trust badges, testimonials, maps, completed verification, supported regions or direct-contact exposure.
- Respect XAF terms, two Cameroon launch regions and backend location taxonomy; no exact private address in public output.
- Preserve Cognito PKCE, session/phone checks, CSRF, idempotency, block restrictions and moderated reputation.
- Use authorized media derivatives with reliable aspect ratios, fallback treatment and intrinsic dimensions. No stock images masquerading as listings.
- Desktop filters and mobile filter UI are first-class, shareable URL state remains correct, pagination race handling must survive.
- Touch targets >=44×44 px, visible focus, keyboard nav, form labels/errors, high contrast and reduced-motion preferences. Test French text expansion even if localization is not yet implemented.
- No unapproved dependency, redesign of unrelated staff/account screens, schema migrations or native work added to a web-only task.
- **No automatic merge on CI green**. Screenshot review and owner decision gate premium UI delivery.

## Quality rubric

Score 1–5 each: brand distinctiveness, composition/hierarchy, media presentation, information density, trust/clarity, mobile polish. Aim >=4 in each; justify any score with a visible observation. Hard block: broken functionality, mobile overflow, privacy regressions, misrepresented prices/verification, accessibility failure, or unverifiable visual output.

## Task-specific scope

For current **PR #51**, iterate inside the same draft PR, preserve its functional gains and tests, and keep it unmerged until owner approves screenshot evidence. Install this skill through the normal repo review process before use. Use it again for future provider, messaging and mobile milestones.
