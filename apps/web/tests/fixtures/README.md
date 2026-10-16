These labelled synthetic TEST listings and generated property photographs
exist only for intercepted automated browser tests and visual evidence. They are
not real inventory, do not establish publication eligibility, and are never
served by the application's public directory or seeded into development data.
The public-address canary deliberately tests that extra private payload fields
are ignored by the rendered UI.

The three photographs are visibly distinct: the existing bright apartment living
room, a blue-wall bedroom, and a green-tile kitchen/dining room. The rent listing's
three gallery IDs resolve to different photographs; the short-stay card uses the
bedroom as its cover. The sale listing deliberately has no media. All photographs
use clearly labelled TEST listings, and both new images also carry an embedded
TEST label. They stay in this test-only directory. None is a real
Cameroon property, an approved listing, or evidence of marketplace activity.

`synthetic-bedroom.jpg` and `synthetic-kitchen.jpg` were generated with the built-in
imagegen tool on 2026-10-15, then encoded as JPEG with the existing Sharp dependency
without cropping or retouching. No dependency was added. The prompts were:

- Bedroom: realistic landscape 3:2 architectural photograph of an entirely
  invented furnished short-stay bedroom; walnut headboard, cream linen, deep muted
  blue wall, writing desk, tall window with leafy tropical greenery; natural
  eye-level view from the entrance; soft afternoon daylight. Small, readable
  `TEST` label at lower left. No people, identifiable location, real property,
  logos, verification marks, address, phone number or price.
- Kitchen: realistic landscape 3:2 architectural photograph of an entirely
  invented sunny separate kitchen and dining nook; terracotta tile, warm-grey
  cabinets, dark green tiled backsplash, oak table, timber chairs and broad
  louvered window with leafy greenery; three-quarter view, bright morning
  daylight. Small, readable `TEST` label at lower left. No people, identifiable
  location, real property, logos, verification marks, address, phone number or
  price.

To capture the redesigned core routes and empty, missing-media and API-error
states with the existing built application, set `PACHI_VISUAL_EVIDENCE_DIR` to an
absolute ignored evidence directory and run
`pnpm --filter @pachi/web test:browser tests/premium-visual.spec.ts` from the repo
root. The runner owns a temporary preview on port 3100 unless
`PACHI_BROWSER_BASE_URL` names an already-running preview. The screenshots are
diagnostic artifacts, not Git snapshots or aesthetic approval. Existing functional
browser tests remain the behavior authority.
