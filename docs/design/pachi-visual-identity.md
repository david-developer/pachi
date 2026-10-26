# Pachi — Visual identity and marketplace UI direction

**Status:** owner-selected logo references and locked palette; vector implementation awaits final visual approval. Lovable-guided page composition is retained. **Product:** Pachi, a Cameroon housing marketplace for seekers and property providers. **Scope:** web first; principles also guide a later native Android/iOS design system. **Baseline:** G3-I1 PR #51 remains a draft and should not merge merely because CI passes.

## 1. The design thesis

**Architectural confidence, everyday accessibility.** Pachi should feel like a serious place where people confidently compare homes, rentals, land and commercial opportunities—not a luxury-hotel brochure, a finance dashboard, a generic WordPress template or a global stock-photo property portal.

Use an **editorial architectural composition**: distinctive large typography, disciplined grid, actual listing photography, sharply organized facts, and responsive search. The interface should be aspirational **without inventing inventory or trust signals**. Cameroon relevance should appear through verified listing content, XAF prices, supported locations and practical terms (deposit, advance months, short-let nights), not stereotyped decoration.

**Brand attributes:** clear · assured · welcoming · precise · locally grounded. **Not:** childish, flashy, generic SaaS, faux-luxury, monochrome developer prototype. The signature device is the architectural letter **A** in the wordmark and complementary architectural framing in photo crops—not repeated house clip art.

## 2. Owner-selected wordmark and icon

The actual images in the supplied `pachi-approved-logo-references.zip`, not earlier concept SVGs or the exploration collage, are the visual authority. Their unchanged copies and BRAND-LOCK are retained only under ignored `.local-dev/pachi-approved-logo-references/`:

- `01-primary-wordmark-reference.jpeg`: authoritative horizontal uppercase PACHI on ivory.
- `02-app-icon-reference.jpeg`: authoritative standalone architectural A on an ivory rounded tile.
- `03-reversed-wordmark-reference.jpeg`: authoritative ivory wordmark on forest green.

The A is a dominant solid triangular architectural mass extending above the other capitals, with open light building channels, two narrow side piers and a prominent copper central volume whose top slopes upward to the right. It has no conventional horizontal crossbar or small pentagonal doorway. Preserve the selected P/C curves, heavy H/I stems, spacing and baseline relationship. Do not substitute font text, older concept paths or a generic house icon.

Reconstruct flat vector geometry only. Paper texture, relief, bevels, cast shadows and photographic lighting belong to the JPEG presentation and must not enter production SVGs. Primary/reversed/monochrome wordmarks use identical paths; standalone icon variants, favicon and app-icon source use identical icon paths. The actual standalone reference has a taller, centered inner aperture than the primary/reversed wordmarks; retain that supplied optical adaptation while preserving the same triangular mass, open channels, side piers and copper-building proportions. Do not pretend the reference apertures are mathematically identical. At small sizes retain these features rather than inventing another simplified symbol.

Production SVGs are transparent paths, except the standalone app-icon tile. Light channels are negative space, appearing ivory on the primary ivory surface and forest on the reversed forest surface. No embedded bitmap, runtime font dependency, filters or presentation textures. Old `assets/*-concept.svg` and `pachi-brand-exploration.png` are historical explorations, not current logo authorities.

## 3. Locked brand palette and supporting tokens

These four colors are authoritative, not proposals:

| Token | Hex | Use |
|---|---|---|
| `--p-forest` | `#0E3B2E` | Primary typography, wordmark, actions, tabs and focus |
| `--p-copper` | `#C47F56` | Architectural building volume and sparse decorative accents |
| `--p-ivory` | `#F8F6EE` | Canvas, header, cards, forms, gallery controls and reversed lettering |
| `--p-sage` | `#D6DECF` | Secondary surfaces, footer, soft state and nonessential dividers |
| `--p-forest-hover` | `#092B21` | Darkened forest interaction state |
| `--p-muted` | `#4D6257` | Accessible secondary text |
| `--p-input-border` | `#718073` | Essential input/control boundary |
| `--p-error` / `--p-error-surface` | `#9D352D` / `#F8EAE3` | Distinct semantic error text/background |

Semantic aliases `--p-ink`, `--p-canvas`, `--p-surface`, `--p-mist` and `--p-border` resolve to forest, ivory, ivory, sage and sage. Marketplace legacy aliases resolve to the same system; unrelated account/staff styling is not redesigned by this task. Update existing declarations rather than layering new route overrides.

Forest/ivory contrast is 11.53:1. Muted text has 6.06:1 on ivory and 4.75:1 on sage. Essential control borders use the neutral above, with 3.85:1 on ivory and 3.02:1 on sage. Sage/ivory alone is 1.28:1 and cannot identify an essential control boundary. Copper/ivory is 2.98:1 and copper/forest 3.87:1: copper is a logo/decorative accent, never the primary CTA or normal body/link text. Forest remains the primary action color, with ivory text. Keep semantic errors distinct, disabled controls readable, and photo-control focus visible through paired forest/ivory rings. Do not restrict all rendered pixels to four colors at the expense of accessibility.

**Type:** preserve locally bundled Manrope headings/numbers and DM Sans body/controls, robust fallbacks and French diacritics. Logo lettering is vector geometry from the supplied references, not these fonts.

**Existing layout scale retained:** 4/8 px rhythm, 1320 px container, current desktop/mobile gutters, card/control geometry, responsive breakpoints and reduced motion. This branding correction does not reopen the Lovable-guided structural redesign.

## 4. Information architecture and page compositions

### Homepage: make discovery the hero

- Full-width photographic/editorial hero with asymmetric two-column composition. The image must be derived from a **real publishable listing's authorized media**; if inventory/media is empty, use an elegant typography/architectural pattern fallback—never a decorative stock listing masquerading as inventory.
- Left: brand proposition, direct supporting copy, tight Rent / Buy / Short let segmentation and focused location search. Right: immersive real photography or fallback. Search should be usable quickly without scrolling on 768–1440 px where feasible.
- Compact trust narrative **only when backed by actual features**, e.g., explain phone verification or report controls; do **not** invent verification badges, reviewed-property counts, testimonials or nationwide inventory.
- Curated-looking latest listings using actual results (not invented recommendations), complete image crops, price/term emphasis, meaningful location and property descriptors. Avoid repetitive demo-photo compositions in the review fixtures.
- Provider CTA has a distinct, finished editorial section rather than a large generic green rectangle.

### Search/results: compare quickly

- Desktop: search toolbar + left filter rail + visual cards in a spacious results field. Filtering should feel intentional, not like an admin form; show applied chips with proper actions where supported. Keep current URL state, validation, browser back/forward behavior and cursor pagination intact.
- Cards have well-judged 4:3 or 3:2 photo crops, crisp price hierarchy (`XAF` and rental period), 1–2 line title, location, meaningful relevant facts. Do not stretch a `No photo` panel to become visually dominant over all actual inventory.
- At 1280–1440 px aim for compact two/three cards per row as density allows; at 390 px use one card per row with thumb-friendly filter sheet/disclosure. Use type/space, not oversized blank margins, to create luxury.
- Use robust loading, empty, image-failure and pagination states. No fabricated result totals. Distinct images in **synthetic testing** should remain visibly labeled TEST.

### Listing detail: sell the property; protect the user

- Large immersive gallery with a coherent thumbnail pattern, keyboard nav, error fallbacks and correct authorized derivatives. No three identical thumbnails in visual evidence unless intentionally testing duplicates (then test a richer fixture as well).
- Strong title/location/price grouping. Main content: property specifications, useful terms and readable description. Desktop: a compact **sticky inquiry/contact panel** near the gallery with price and next step. Mobile: restrained accessible sticky contact action, respecting safe area; avoid hiding content or masking the report/block controls.
- Include provider reputation only according to current published-data rules (no fictional star average under minimum review count). Surface block/report/privacy controls without overwhelming the page.
- Location stays coarse; **never display private addresses or security instructions** in public UI. Missing fields should be gracefully omitted or explained—not thirty identical “Not specified” boxes.
- The detail page must feel like a high-quality property presentation, not a lengthy stack of form tables.

### Other routes and cross-platform path

- Keep `/account`, `/provider`, `/organizations` and messaging workflows functionally intact in G3-I1. Their complete redesign belongs to later bounded tasks, using the same tokens and logo.
- Native Android/iOS is **not** redesigned by this skill's first invocation. Later Expo work reuses palette, naming and hierarchy but implements native navigation, gestures, safe areas and performance independently—**not** copied web markup.

## 5. Honest content and behavior

- No invented property photography, listings, reviews, badges, agent faces, location claims, analytics counts or success stories.
- Use actual Cameroon place names only within supported launch region/filter rules. Label TEST fixtures; never ship them as inventory.
- Preserve user flows: PKCE/session/logout, phone gate, CSRF, idempotency, blocks, listing visibility, review suppression, safe media proxy, private address, provider authority.
- Price display in XAF: formatting must respect actual amounts, pricing period, deposit/advance semantics and backend contract; do not silently alter pricing units.
- Start English; ensure layout supports future French text expansion (30% longer controls), accents and translated legal notices. Do not claim French localization exists.

## 6. What failed in G3-I1 screenshots—and how to improve it

The owner rejected the first rendering, despite passing CI:

1. Flat monochrome hero and generic house symbol lacked a distinct product signature. **Replace with typographically and photographically composed hero + architectural A brand system.**
2. Search looked like default stacked form fields, especially mobile. **Create a cohesive search surface, intentional emphasis and filter interaction.**
3. Cards were readable but ordinary; duplicated photo and one large no-photo slab dominated visual comparison. **Refine imagery, data density, hierarchy and varied synthetic preview inventory.**
4. Detail view was very long, with repeated boxed data points and small standalone CTA. **Design a deliberate content rhythm and sticky desktop/mobile inquiry zone.**
5. All sections had near-identical white/cream treatment. **Use controlled editorial transitions and varied section geometry without gratuitous decoration.**
6. Mobile technically stacked but felt like a shrunken desktop page. **Design mobile navigation, filtering, card density and contact action as first-class flows.**

## 7. Visual sign-off gates

Before announcing success, inspect **rendered actual screenshots** at 390, 768 and 1440 px for `/`, `/listings`, `/listings/[id]`. Also inspect 320 px and zoom/keyboard states if the tooling supports it. Use a realistic **synthetic TEST fixture with at least three visually distinct property media scenarios**: home/rent, short stay, and missing media; plus empty/error cases. No production data mutation.

For each route measure: **brand distinctiveness, visual hierarchy, photography, information density, trust clarity, and mobile polish** (1–5 each). Target **at least 4/5 in every category**, with no accessibility or behavioral regression. Ratings are editorial judgment, not a substitute for actual screenshots or user approval. Capture paired before/after screenshots to support review and call out unresolved tradeoffs plainly.

Any critical failure—privacy leakage, nonfunctional CTA, broken navigation, clipped content, overlapping controls, mobile horizontal scroll, inaccessible search, low-contrast text, false trust claim, or manipulated price—**blocks acceptance regardless of visual score**.

**Owner visual approval is required before PR #51 can merge.** A passing CI report alone does not constitute design approval.

## 8. References and skill use

The owner-selected references and four-color palette above are authoritative; the reconstructed vectors and rendered integration require final visual approval. The repo-local skill `.agents/skills/pachi-premium-ui/SKILL.md` turns it into a repeatable implementation and critique workflow. Refer to `references/visual-review-checklist.md` inside that skill for review evidence. External inspiration (Sahibinden, Property Finder, Zillow and contemporary architectural portfolios) is for **interaction patterns only**, never copied branding, assets or layouts.

## 9. Reviewable implementation assets

The following flat vector reconstructions implement the selected JPEG references; their fidelity and rendered integration await final owner inspection:

- `apps/web/public/brand/pachi-wordmark.svg`: PACHI letterforms reconstructed from the authoritative primary JPEG, with the triangular architectural A and prominent copper building volume.
- `apps/web/public/brand/pachi-wordmark-monochrome.svg` and `pachi-wordmark-reversed.svg`: forest monochrome and ivory reversed variants, sharing the exact primary path geometry.
- `apps/web/public/brand/pachi-mark.svg` and `pachi-mark-light.svg`: primary ivory-tile and reversed forest-tile icon treatments; `pachi-mark-monochrome.svg` is the one-color treatment. `pachi-symbol.svg` supplies the same bare architectural A for interface fallbacks. `apps/web/app/icon.svg` supplies the primary favicon.
- `docs/design/assets/pachi-app-icon.svg`: scalable app-icon design source for review; no native app change is implied.

Manrope and DM Sans are self-hosted using local variable fonts. Their unmodified sources, immutable upstream revision, hashes and SIL Open Font Licenses are recorded in `apps/web/app/fonts/`. The old concept assets remain historical and unchanged; they are not the selected logo references. Do not declare the vector implementation final until the actual supplied-JPEG comparisons and interface captures are visually approved.

## 10. Lovable-guided structural refinement proposal

The owner's supplied Lovable listing-detail screenshots are now the primary visual reference for G3-I1 composition. This does not approve the existing implementation or fictional prototype content. The six references and their supplied DESIGN-BRIEF remain local evidence outside Git. Compare them against the latest prior G3-I1 candidate (`4813fd8`) and each new actual render, rather than the original rejected baseline.

Lead detail with a responsive photographic mosaic, then a tightly grouped property title, coarse location and essential facts alongside the price/contact panel. Show only distinct media identities belonging to that listing, degrade deliberately with fewer images, and provide a working accessible full-gallery interaction. Keep the mobile photo and property/inquiry hierarchy prominent. Present description, supplied specifications, rental terms and published reputation with a compact reading rhythm. Cards should form cohesive photo-led comparison surfaces; homepage featured media, real listing title/price and functional search should read as one discovery composition.

Public detail now supplies a bounded provider display name, current identity verification, current authority declaration and actual confirmation timestamp. Initials may represent that public name; a declaration must not appear as verified property authority. Amenities, saved-state and recommendation ranking remain absent. Missing fields must not be filled with prototype facts or inert controls. Native contact hands off explicitly to the configured authenticated web flow. Preserve account eligibility/contact, media delivery, block, private-location and review boundaries. Report element-by-element matches and remaining differences for all six references; numeric rubric scores alone are insufficient.

The earlier concept-derived runtime SVGs are superseded for branding by the three exact owner-selected JPEGs and locked palette in sections 2–3. The latest Lovable-guided layout remains unchanged. Compare actual supplied JPEGs against the reconstructed wordmark at equivalent scale, the standalone icon at 16/32/48/160 px, and the reversed asset on forest. Retain desktop/tablet/mobile interface evidence and run focused visual checks plus normal exact-head CI. Reference JPEGs/archives remain ignored, and PR #51 remains draft and unmerged pending final owner visual approval.
