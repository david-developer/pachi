# Pachi — Visual identity and marketplace UI direction

**Status:** proposed visual direction, for owner review. **Product:** Pachi, a Cameroon housing marketplace for seekers and property providers. **Scope:** web first; principles also guide a later native Android/iOS design system. **Baseline:** G3-I1 PR #51 remains a draft and should not merge merely because CI passes.

## 1. The design thesis

**Architectural confidence, everyday accessibility.** Pachi should feel like a serious place where people confidently compare homes, rentals, land and commercial opportunities—not a luxury-hotel brochure, a finance dashboard, a generic WordPress template or a global stock-photo property portal.

Use an **editorial architectural composition**: distinctive large typography, disciplined grid, actual listing photography, sharply organized facts, and responsive search. The interface should be aspirational **without inventing inventory or trust signals**. Cameroon relevance should appear through verified listing content, XAF prices, supported locations and practical terms (deposit, advance months, short-let nights), not stereotyped decoration.

**Brand attributes:** clear · assured · welcoming · precise · locally grounded. **Not:** childish, flashy, generic SaaS, faux-luxury, monochrome developer prototype. The signature device is the architectural letter **A** in the wordmark and complementary architectural framing in photo crops—not repeated house clip art.

## 2. Wordmark and logo direction

**Name:** `PACHI` (uppercase master mark; product copy may say `Pachi`). The **A** is an intentionally constructed architectural glyph that reads as an A first and suggests a pitched roof + structural columns/door second. The P, C, H and I are sturdy geometric letters with even optical weight. No detached generic roof icon above the whole name.

- **Primary:** horizontal PACHI vector wordmark, dark architectural ink; subtle warm copper only in the A's inner vertical feature. Avoid gratuitous trailing punctuation in the primary lockup.
- **Small-size mark:** the architectural A alone, optically corrected for 16–48 px usage; test it on light and dark surfaces.
- **Alternates:** one-color ink, reversed white, and accessible app icon with a non-decorative boundary.
- **Restrictions:** no unlicensed font files, raster-only logos as the sole asset, bevels, complex gradients, drop shadows, cartoon rooftops, or tiny windows that disappear when scaled. Ensure the letter is still legible without copper or color.
- **Vector delivery:** final `pachi-wordmark.svg`, `pachi-mark.svg`, accessible favicon, and app-icon design source, reviewed at 24, 32, 48, 144 and 300 px. Any supplied concept board or SVG is **exploratory**, not automatically an approved final mark.

Included assets under `assets/` are **concept explorations for critique**, not immutable brand standards. Refine their optical spacing, exact geometry and small-size readability in the review PR.

## 3. Proposed design tokens

These tokens are a **new proposal**, not a retrospective endorsement of the existing green/cream screenshots. Alter deliberately after rendered evaluation, and maintain contrast.

| Token | Hex | Intent |
|---|---|---|
| `--p-ink` | `#142D30` | Core typography; logo; high-contrast UI |
| `--p-teal` | `#08665B` | Primary actions, interactive controls |
| `--p-teal-hover` | `#064D45` | Hover/active on light surfaces |
| `--p-copper` | `#BE7651` | Sparse brand highlight, never broad CTA fill |
| `--p-canvas` | `#F6F8F6` | Light neutral background |
| `--p-surface` | `#FFFFFF` | Cards, forms, sheets |
| `--p-mist` | `#E6EEEA` | Image fallback/soft section contrast |
| `--p-muted` | `#516560` | Secondary legible copy |
| `--p-border` | `#D8E2DD` | Lightweight dividers |
| `--p-error` | `#9D352D` | Destructive/error states |

Keep dark hero regions intentional rather than a blanket green background. Avoid beige+green everywhere, and avoid orange accent strips on every card. Verify contrast against WCAG 2.2 AA target, including focus and disabled states.

**Type proposal:** `Manrope` for headings, numbers and the interface's geometric personality; `DM Sans` for comfortable body copy and controls. Choose licensed webfont sourcing or bundled permitted subsets through the project's normal asset workflow; never embed or distribute font files in this kit. Use robust fallback stacks, complete Latin/French diacritics, and avoid layout shift. The designed SVG wordmark does **not** depend on a downloaded font at runtime.

**Working scale:** 4/8 px base rhythm; body 16–17 px/1.5–1.65; meta 12–14 px with sufficient contrast; section heading ~30–42 px; desktop hero ~56–76 px; mobile hero ~38–48 px. Avoid giant headlines that squeeze search below the fold. Set container ~1320–1440 px with responsive 24–40 px desktop gutters, 16–20 px mobile gutters. Cards radius ~10–14 px, controls ~8–10 px. Prefer subtle borders and light tonal differentiation over stacked heavy shadows. Motion 140–220 ms and `prefers-reduced-motion` respected.

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

This document is Pachi's authoritative **proposed** design direction once approved. The repo-local skill `.agents/skills/pachi-premium-ui/SKILL.md` turns it into a repeatable implementation and critique workflow. Refer to `references/visual-review-checklist.md` inside that skill for review evidence. External inspiration (Sahibinden, Property Finder, Zillow and contemporary architectural portfolios) is for **interaction patterns only**, never copied branding, assets or layouts.

## 9. Reviewable implementation assets

The following vector candidates implement this proposal in G3-I1; they remain subject to owner visual approval:

- `apps/web/public/brand/pachi-wordmark.svg`: original geometric PACHI paths with an architectural A and copper doorway; no font dependency.
- `apps/web/public/brand/pachi-wordmark-monochrome.svg` and `pachi-wordmark-reversed.svg`: ink and reversed variants.
- `apps/web/public/brand/pachi-mark.svg` and `pachi-mark-light.svg`: small mark treatments; `apps/web/app/icon.svg` supplies the favicon.
- `docs/design/assets/pachi-app-icon.svg`: scalable app-icon design source for review; no native app change is implied.

Manrope and DM Sans are self-hosted using local variable fonts. Their unmodified sources, immutable upstream revision, hashes and SIL Open Font Licenses are recorded in `apps/web/app/fonts/`. The supplied concept assets remain intact for comparison. The SVG candidates are refined implementation proposals, not approved final brand standards.

## 10. Lovable-guided structural refinement proposal

The owner's supplied Lovable listing-detail screenshots are now the primary visual reference for G3-I1 composition. This does not approve the existing implementation or fictional prototype content. The six references and their supplied DESIGN-BRIEF remain local evidence outside Git. Compare them against the latest prior G3-I1 candidate (`4813fd8`) and each new actual render, rather than the original rejected baseline.

Lead detail with a responsive photographic mosaic, then a tightly grouped property title, coarse location and essential facts alongside the price/contact panel. Show only distinct media identities belonging to that listing, degrade deliberately with fewer images, and provide a working accessible full-gallery interaction. Keep the mobile photo and property/inquiry hierarchy prominent. Present description, supplied specifications, rental terms and published reputation with a compact reading rhythm. Cards should form cohesive photo-led comparison surfaces; homepage featured media, real listing title/price and functional search should read as one discovery composition.

The current PublicListing projection supplies no provider identity/avatar, verification/authority badges, amenities, saved-state, recommendation ranking or confirmation timestamp. Their absence must not be filled with prototype facts or inert controls. Preserve existing account eligibility/contact, media delivery, block, private-location and review boundaries. Report element-by-element matches and remaining differences for all six references; numeric rubric scores alone are insufficient.

The earlier runtime wordmark simplified P/C/H/I letter geometry and substituted a small house-shaped cutout in A; it diverged from the owner's original concept. The current runtime proposal now retains the original concept's letter outlines and architectural A, trims transparent viewBox margins for header legibility, and removes only the faint inner tint. Header, footer, fallback A, favicon and scale variants share that concept geometry. The original SVG remains unchanged for side-by-side inspection against the arrival runtime and this proposal at actual UI sizes. This is a review candidate, not a final owner-approved brand selection.
