# Battle map textures

How a floor becomes a map theme, and what it has to look like to belong beside
the ones already there.

A theme is one floor texture plus five numbers. The texture is a tiling image
of the **ground seen from directly above**; the numbers say how the app draws
over it.

---

## Three ways in

**Inside the app**, which is the one a DM uses: **Ground** on the toolbar opens
a panel. Describe the ground and what lies on it in your own words,
**Generate**, and judge the result in the preview — tiled 2x2 on purpose,
because a floor is judged on how it repeats and a single copy hides every seam.
**Generate again** until it is right, then name it and **Save to my grounds**:
it joins the ground picker beside the ten built in, and the map switches to it.

Nothing is written to the map until you save, because the first attempt is
rarely the one you keep. **Try it on this map** puts a preview on the map
without saving it.

This one needs the image endpoint (`api/generate-texture.js`, a Vercel
function that calls Gemini): run `vercel dev` and set `GEMINI_API_KEY`. Under
plain `npm run dev` the panel says so rather than failing quietly, and
uploading still works.

**The fixed clauses are wrapped around your description, never replaced by it.**
`lib/mapprompt.js` adds the shot, the lighting, the palette and the
prohibitions; what is ON the ground is yours to say. So the rules below are
enforced in code rather than left to whoever is typing.

What that gives up, stated plainly: the wrapper constrains the shot, not the
subject, so the endpoint is — within a 600-character cap — a general-purpose
image generator on the owner's key. **It has no sign-in.** Deploy it where only
people you trust can reach it (a private project, deployment protection, a
network allowlist), or put your own check at the top of the handler.

**By uploading one.** **Ground → Upload a floor…** takes an image of your own
through the same preview and the same save. It is cropped to the middle and
stored at 512px, and it tells you what it did rather than changing your file
silently. *Crop to square* is on by default because a photo (4:3) and a
screenshot (16:9) both repeat as a letterboxed band unless cropped, and anything
with a horizon in it tiles into a wall.

**From the command line**, for a texture that ships with the app as a built-in
theme — see the pipeline below.

Saved grounds live in your browser's `localStorage`, each carrying its texture
as a data URL, so a handful of them can fill the ~5MB a browser allows. The app
says so when it happens; delete one to make room.

---

## The built-in ten

`npm run textures` writes `public/maps/<id>.jpg` for dungeon, catacombs,
cavern, volcanic, tavern, forest, swamp, desert, tundra and cobbles, from
`scripts/gen-textures.mjs`. They are **procedural stand-ins**: seeded noise and
Voronoi, periodic by construction, so a seam is impossible rather than merely
unlikely (`scripts/gen-textures.check.mjs` proves each one wraps exactly). A
painted floor will beat them, and replacing one is a one-command job:

1. **Make** a 1024² or larger square image, from the prompt skeleton below.
2. **Install it.** `scripts/add-map-texture.sh <image> <theme-id> [crop-px]`
   resamples to 1024, encodes at q85 and writes `public/maps/<theme-id>.jpg`.
   The third argument trims the bottom, where generators put a watermark;
   tiled, one watermark becomes a grid of them. (`sips`, so macOS.)
3. **Re-tune the five numbers** in `MAP_THEMES` in `src/battlemap.js` — below.
   `npm run textures -- --report` prints a generated floor's average colour;
   for your own image, `fallback` is its average.
4. **`npm run check`.** `battlemap.check.mjs` fails if the file is missing,
   under 20KB, or over 900KB.

To add a new theme rather than replace one, add it to `MAP_THEMES` and to
`GROUNDS` in `gen-textures.mjs` (the check insists the two lists agree), or
just install a painted file and skip the generator.

### Why 1024 and not more

The texture *tiles*. At a normal px/square a 1024 tile already covers the whole
canvas once, and what 2048 buys is sub-panel detail that then gets a wash and a
grid drawn over it. It is paid for on every load, by a DM who is often
projecting over someone else's wifi. 1024/q85 lands at 300–480KB for a painted
floor.

---

## What the image has to be

- **Top-down, flat, no perspective.** It is a floor. A photograph taken at an
  angle tiles into a floor that leans.
- **Evenly lit.** A bright spot or a cast shadow repeats across the map and
  reads as a lighting fault rather than as the floor.
- **No grid.** The app draws the grid, calibrated to the table. A texture with
  its own grid fights it and the two will never line up.
- **Busy at panel scale, quiet at square scale.** A square is ~40px on screen.
  Detail finer than that turns to noise and then to mush under the wash.
- **Mid values, not extremes.** Tokens, templates and the grid are drawn over
  this. Pure black loses the walls; pure white glares on a projector.
- **Nothing that must stay upright.** Lettering and runes tile into an obvious
  repeat and give the eye a grid of its own.

---

## The five numbers

| Field | What it is |
| :-- | :-- |
| `grid` | The grid line colour. It has to read **on the floor**: a pale floor takes a dark line and a dark floor a bright one. |
| `accent` | The hairline along derived walls. Pick it out of the texture, not off a colour wheel. |
| `fallback` | The flat colour painted if the file 404s. The texture's average. |
| `wash` | How far the map is knocked back before the grid and overlays are drawn, 0–0.5. A dim, cluttered flagstone takes `0.22`–`0.25`; sunlit sand or snow takes `0.12`–`0.14` or it just goes grey. |
| `gridAlpha` | How hard the grid is drawn, 0.1–1. A dark line over a bright floor needs more ink: `0.34` for the dim grounds, `0.5`–`0.55` for the bright ones. |

Set `wash` and `gridAlpha` by looking at the thing on a map with a few rooms
stamped, not by reasoning about it. The failure mode is a grid you cannot see
from across the table. A ground saved from the app gets all five derived from
its own average by `themeNumbersFor()`.

---

## The aesthetic

Classic dungeon-crawl: **lived-in, weathered by use, and indifferent to whoever
is standing on it.** The register is a table of miniatures under a lamp, not a
cinematic render.

- **Wear comes from use, not from ruin.** Worn paths down the middle of a
  corridor, stained corners, a crack in one slab.
- **Materials are plain and legible.** Flagstone, oak, packed earth, basalt.
  You should know what it is made of from across the table.
- **Colour is muted and natural, with one warm note.** Torchlight, lichen
  green, ember orange — one, not three.
- **Ornament is part of the structure**, not applied to it: inlay in the marble,
  a drain in the cobbles.

---

## Prompt skeleton

Fill the two bracketed parts and keep the rest:

> A photorealistic, highly detailed overhead photograph of ground, in the
> aesthetic of a classic fantasy dungeon-crawl tabletop game. The ground is
> **[SURFACE]**, **[DETAIL]**. Physically based materials with fine surface
> grain and real depth: lived-in, weathered by age and use rather than by ruin,
> muted natural palette with at most a single warm torchlight or lichen-green
> accent, shot straight down from directly overhead, flat even light, no cast
> shadows, no highlights, no vignette, seamless tiling, mid-tone values,
> nothing pure black and nothing pure white, photographic, not illustrated, not
> painted, not rendered as game art. No text, no lettering, no logos, no
> insignia, no grid lines, no perspective, no horizon, no figures, no
> watermark, no border. Square 1:1 image.

**The order matters more than the words.** The medium leads. An earlier version
of this opened with "top-down orthographic floor texture" and left
"photorealistic" to the very end, after a run of negations — and what came back
was illustration, not photography. Saying what it is *not* earns its place too:
game art is the default register for a fantasy prompt, and it is the wrong one
for a floor.

`lib/mapprompt.js` holds twelve ready-made environments and eight conditions
(flooded, burnt over, overgrown…) that fill the same two brackets. A few:

| Environment | SURFACE | DETAIL |
| :-- | :-- | :-- |
| Dungeon flagstone | a dungeon floor of worn grey flagstones laid in rough courses | mortar seams, scattered old straw, a crack through one slab, damp in the low corners |
| Crypt | the floor of a burial crypt, pale marble slabs over packed earth | worn inlay, bone dust in the seams, candle-wax drippings |
| Cavern | a natural rock cavern floor, damp and uneven | flowstone, rubble, mineral staining, pooled water, guano |
| Tavern | the plank floor of an inn's common room, dark oak worn pale down the middle | old nail-heads, spilt ale, sawdust in the gaps |

Outdoor grounds work with the same tools: a "wall" there is terrain and a
"door" is a gate or a cave mouth. Nothing in the app needs changing for that.

---

## Props

Doors, barrels, pillars, fires and thickets are drawn as **flat shapes** unless
a ground has a prop sheet. Seven of the built-in ten (crypt, cavern, cobbles, desert, swamp, tundra, volcanic) ship with one, cut into `public/maps/tokens/<theme>/`; the masters stay in `art/sprites/`, which is not deployed; a ground you
generate can have its own (**Generate matching props**, in the Ground panel, once a floor is previewed), asked for
as ONE 4x4 sheet so the sixteen share a palette and a light. To ship a sheet
with a built-in theme, put it in `art/sprites/`, name it in `SHEET_FOR_THEME`
(`src/spritesheet.js`) and run `node tools/slice-sprites.mjs`.

**Floors from Gemini.** Nine of the ten floors in `public/maps/*.jpg` are Gemini
renders (masters in `art/textures/`, recompressed to 1024px JPEG q84); only
`dungeon` is still procedural. `npm run textures` rewrites all ten procedural
ones, so pass `--only dungeon` unless you mean to replace the Gemini floors.

## Overlay art

The spell and weapon overlays — the burst, the cone, the aura, the beam — are
**drawn in canvas, not generated**. A template has to be whatever radius the
spell says, and a bitmap stretched from a 5-foot burst to a 120-foot one goes
soft exactly where the DM is reading an edge. See `drawBlast`, `drawShield`,
`drawCone` and `drawBeam` in `src/BattleMap.jsx`. Cover and hazards are drawn
for the same reason, and because they have to recolour per theme.
