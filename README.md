# D&D Battle Map Builder

A battle map builder for 5e, run from a browser and projected under physical
miniatures. Build a dungeon by stamping tiles or painting squares (or generate
one), lay doors, cover, hazards and fog, then pick **a weapon or a spell** and
the map casts what it does: range bands and disadvantage for a longbow, the
20-foot burst of a Fireball, the cone of Burning Hands, the line of a Lightning
Bolt, the aura of Spirit Guardians — trimmed by the walls and doors between.

Nothing is drawn for a combatant. The miniatures on the table are the
combatants; the map shows what a model cannot.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
```

Maps and generated grounds are kept in your browser's `localStorage`. There is
no account and no server for them. **Project in a window** opens the map in a
second window for a projector; **H** hides the toolbars and **F** / **P** take
that window full screen.

Image generation for grounds is the one thing that needs a server:

```sh
npm i -g vercel
GEMINI_API_KEY=... vercel dev
```

It has no sign-in, so deploy it only where the people who can reach it are the
people you would hand your key to. Uploading a floor of your own works without
it. See [TEXTURES.md](TEXTURES.md).

## Deploy

Vite preset, nothing to override: build `npm run build`, output `dist`. The one
function, `api/generate-texture.js`, is picked up from `api/` and allowed 60 s
by `vercel.json` (an image call can outlast the 10 s default).

Set `GEMINI_API_KEY` in the project's environment variables to turn on image
generation, and **protect the deployment first** (Settings → Deployment
Protection): the endpoint has no sign-in of its own, so on a public URL anyone
could spend your key. Leave the variable unset and the rest of the app works
unchanged.

## What the overlay knows

| Picks | Draws |
| :-- | :-- |
| A melee weapon | its reach: 5 ft, or 10 ft with the Reach property |
| A ranged or thrown weapon | normal and long range rings; long range is **disadvantage**, past it **no attack** |
| A spell with a range | a ring to its reach, and the lane to the target |
| A spell with an area | a **sphere** (burst at the target, or an aura on the caster), a **cone** with the 5e flat end, a **cube** or a **line** |

On every lane it reports the distance in feet, the band, what stands in the
way (a shut door, a pillar, fog) and the target's **cover** — half (+2),
three-quarters (+5) or total — from a low wall, a barrel stack or a pillar.
Distance is the straight line between square centres (the PHB's true-distance
variant), and a square is 5 ft unless you say otherwise under **Grid, scale
and light**.

**Rules data** comes from [dnd-data](https://github.com/nick-aschenbach/dnd-data):
the Player's Handbook weapons, the Wizards of the Coast monsters (for contacts) and spells (one row per
spell, however many books print it), reduced to the geometry above plus save and
damage. Descriptions are deliberately left
out; the map is not a rules reference. Regenerate with `npm run rules`.

**What is house, not 5e:** noise radii, how far sight reaches into fog and
foliage (5e has only "lightly" and "heavily obscured"), and the 30 ft sense
sweep. They are plain tables in `src/awareness.js` and `src/battlemap.js` that a
table can edit.

## Layout

```
src/rules.js         the 5e rules: range bands, cover, what an overlay is
src/battlemap.js     the map: themes, tiles, doors, cover, geometry, templates
src/mapgen.js        dungeon, catacomb and cavern generator (seeded)
src/terrain.js       procedural ground from a sentence ("a swamp with a river")
src/BattleMap.jsx    the canvas and the controls
src/data/*.json      weapons and spells, written by scripts/build-rules.mjs
scripts/             rules build, texture generator, texture installer
lib/mapprompt.js     the fixed clauses wrapped around a ground description
api/                 the one serverless function (image generation)
```

Each module has a `*.check.mjs` beside it. `npm run check` runs them all.

## Scripts

| | |
| :-- | :-- |
| `npm run dev` / `build` | the app |
| `npm run check` | every self-check |
| `npm run rules` | rebuild the weapon and spell tables from `dnd-data` |
| `npm run textures` | rebuild the ten built-in floors |
