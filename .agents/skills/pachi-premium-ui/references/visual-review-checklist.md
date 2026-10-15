# Pachi — Visual acceptance checklist

Use this for **every** Pachi UI feature PR. It is brief on purpose: visuals are accepted by observation and judgment, not by a long form.

## Before implementation

- Name the primary user, route and one decision/action the screen enables.
- Identify three deficiencies in the *previous rendered page* and how the redesign corrects them.
- Make a clear desktop and mobile composition sketch (rough ASCII acceptable) and choose consistent palette/type treatments.
- Identify the real API fields, privacy boundaries and unsupported features; don't fabricate content.

## Capture set

Use synthetic TEST data, label it accordingly, and capture these scenarios:

| Route | 1440 px | 768 px | 390 px | Exceptions |
|---|---|---|---|---|
| `/` | Hero, nav, current listings, CTA | Hero/search fold | Header/menu, search, cards | No inventory, API error |
| `/listings` | Filter rail, cards, sort | Reflow filters and grid | Filter control, listing card, applied state | No photo, invalid filter, zero results, cursor retry |
| `/listings/[id]` | Hero gallery, details, contact | Gallery and detail reflow | Gallery, metadata, sticky contact | Missing image, anonymous/blocked/phone-ineligible |

After meaningful visual changes, capture **a second set**; compare before and after rather than declaring success from a single screenshot.

## Check the visual details

- Is PACHI memorable and the custom architectural A recognizable at header and app-icon size?
- Can users identify **price, property type, location and action** in three seconds?
- Does the real photograph dominate appropriately, without stretched crops or fake photography?
- Does the page feel like a real estate product, not a form-builder template or admin panel?
- Are large empty spaces intentional, or simply unfinished layout?
- Does the desktop listing detail have a compact price/contact panel rather than a tiny detached button?
- Does mobile have first-class navigation/filtering/contact with no overlap or horizontal overflow?
- Are loading, no media, no results, errors and pending states visually deliberate?
- Are fonts, contrast, density and control shape consistent between pages?
- Are 'verified', reputation and urgency claims strictly supported by backend data?

## Functional hard stops

No merge if protected data leaks, private location appears, session/logout/phone checks break, blocked contact succeeds, reviews leak, pricing is inaccurate, pagination loses data, keyboard controls trap focus, touch targets are unusable, or synthetic TEST photos become public production inventory.

## Scoring and reporting

Record six simple scores (1–5) with one precise observation each: **Brand / Hierarchy / Photography / Density / Trust / Mobile**. Target >=4 each. Then list functional tests, exact screenshot paths, visual iteration count, unresolved gaps and a clear recommendation: **ready for owner review** or **revise again**. Only the owner can accept the aesthetic direction; the agent must not self-approve the PR solely from CI.
