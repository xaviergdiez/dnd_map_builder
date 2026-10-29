// Builds the battle-map floor-texture prompt.
//
// The DM describes the ground in their own words; the FIXED clauses below are
// wrapped around that description, never replaced by it. So the thing that
// keeps the set coherent is still enforced here in code — flat top-down,
// evenly lit, no grid of its own, mid values, nothing that must stay upright
// (see TEXTURES.md) — while what is ON the ground is theirs to say.
//
// A NOTE ON WHAT THIS GIVES UP. Accepting a free description means the wrapper
// constrains the SHOT, not the subject: the endpoint is, within the length cap
// below, a general-purpose image generator on the owner's key. Whoever deploys
// it decides who can reach it (see api/generate-texture.js).
//
// The environment and condition lists are kept as starting points: they fill
// the box rather than restrict it.
//
// Pure, and outside /api so Vercel does not count it against the function cap.
// See mapprompt.check.mjs.

const E = (id, name, surface, detail) => ({ id, name, surface, detail });

export const ENVIRONMENTS = [
  E('dungeon', 'Dungeon flagstone',
    'a dungeon floor of worn grey flagstones laid in rough courses',
    'mortar seams, scattered old straw, a crack running through one slab, damp staining in the low corners'),
  E('crypt', 'Crypt and catacombs',
    'the floor of a burial crypt, pale marble slabs over packed earth',
    'worn inlay, bone dust drifted into the seams, a cracked slab, candle-wax drippings'),
  E('cave', 'Cavern floor',
    'a natural rock cavern floor, damp and uneven',
    'flowstone, rubble, mineral staining, pooled water in the low ground, guano'),
  E('mine', 'Mine and tunnel',
    'a mine tunnel floor of broken rock and packed spoil',
    'rotted timber, scattered ore, cart ruts in the dust, old lamp-oil stains'),
  E('forest', 'Forest floor',
    'old woodland floor, leaf litter over dark soil',
    'exposed roots, moss on stone, rotting branches, a faint game trail worn through the litter'),
  E('swamp', 'Swamp and fen',
    'brackish swamp ground, peat and standing water',
    'reed beds, sunken timber, algal scum, a half-submerged flagstone path'),
  E('desert', 'Desert waste',
    'wind-scoured desert hardpan and drift sand',
    'ridged dunes, cracked pan, half-buried sandstone blocks, dust drifted over an old caravan road'),
  E('tundra', 'Frozen tundra',
    'frozen tundra, hard ground under thin snow',
    'frost-heaved stone, dead scrub, wind-scoured ice in the hollows'),
  E('tavern', 'Tavern floorboards',
    'the plank floor of an inn’s common room, dark oak worn pale down the middle',
    'old nail-heads, spilt ale stains, sawdust in the gaps, scuffs where chairs have been dragged'),
  E('volcanic', 'Volcanic rock',
    'black volcanic basalt with glowing cracks',
    'ropey lava crust, slag clinker, ash drifted into the hollows, faint orange light in the seams'),
  E('street', 'Cobbled street',
    'a town street of rounded cobblestone setts',
    'packed dirt in the gaps, horse-dung stains, a drain grate at one edge, moss at the kerb'),
  E('ruin', 'Ruined hall',
    'the rubble-strewn floor of a collapsed stone hall',
    'broken flagstones, fallen masonry, rotted timber, weeds forcing through the joints')
];

export const environmentById = (id) =>
  ENVIRONMENTS.find((e) => e.id === id) || null;

const C = (id, name, phrase) => ({ id, name, phrase });

// Conditions are additive weather and damage, not new environments. Each has
// to make sense on any of the surfaces above, or the two combine into
// something the model cannot picture.
export const CONDITIONS = [
  C('none', 'As it stands', ''),
  C('flooded', 'Flooded', 'standing water pooled across it, reflecting flat grey light'),
  C('burning', 'Burnt over', 'scorched and burnt over, ash and charred debris, heat-cracked ground'),
  C('overgrown', 'Overgrown', 'reclaimed by growth, roots and creeper forcing through every seam'),
  C('frozen', 'Frozen over', 'glazed in ice, snow packed into every hollow'),
  C('battle', 'Fought over', 'trampled and scarred, broken arrows and splintered shafts, scorch marks of spellfire'),
  C('derelict', 'Long abandoned', 'dust-layered and undisturbed, cobwebbed, everything settled and still'),
  C('cursed', 'Cursed', 'blighted by dark magic, pale lichen and dead growth, faintly stained with arcane residue')
];

export const conditionById = (id) =>
  CONDITIONS.find((c) => c.id === id) || null;

/* The fixed part. Every clause here earns its place against a real failure:

   - "top-down orthographic", "no perspective": it is a floor. A floor shot at
     an angle tiles into a floor that leans.
   - "seamless tiling": it repeats across the whole deck.
   - "even flat lighting, no cast shadows, no highlights": a bright spot
     repeats and reads as a lighting fault rather than as the ground.
   - "no grid": the app draws the grid, calibrated to the table. A texture
     with its own grid fights it and the two will never line up.
   - "no text, no logos, no insignia": lettering tiles into an obvious repeat
     and hands the eye a grid of its own.
   - "mid-tone values": tokens, templates and the grid are drawn over this.
     Pure black loses the walls, pure white glares on a projector. */
/* The fixed parts, and the ORDER is the point. The portrait prompt next door
   leads with the medium and the quality — "A cinematic, highly detailed
   photorealistic render in the aesthetic of a fantasy tabletop game" — and
   only then says what is in the picture. An earlier version of this file led
   with "top-down orthographic floor texture" and left "photorealistic" to the
   very end, after a run of negations; what came back was illustration, not
   photography. Medium first.

   Every clause after the subject earns its place against a real failure:

   - shot straight down, no perspective, no horizon: it is a floor. A floor
     photographed at an angle tiles into a floor that leans.
   - seamless tiling: it repeats across the whole deck.
   - flat even light, no cast shadows, no highlights: a bright spot repeats
     and reads as a lighting fault rather than as the ground.
   - no grid: the app draws the grid, calibrated to the table. A texture with
     its own grid fights it and the two will never line up.
   - no text, no logos, no insignia: lettering tiles into an obvious repeat
     and hands the eye a grid of its own.
   - mid-tone values: tokens, templates and the grid are drawn over this.
     Pure black loses the walls, pure white glares on a projector.
   - no figures: a battle map is where the miniatures stand. */
const LEAD =
  'A photorealistic, highly detailed overhead photograph of ground, in the aesthetic '
  + 'of a classic fantasy dungeon-crawl tabletop game.';

const TAIL = [
  'Physically based materials with fine surface grain and real depth: lived-in,'
  + ' weathered by age and use rather than by ruin',
  'muted natural palette with at most a single warm torchlight or lichen-green accent',
  'shot straight down from directly overhead, flat even light, no cast shadows,'
  + ' no highlights, no vignette, seamless tiling',
  'mid-tone values, nothing pure black and nothing pure white',
  'photographic, not illustrated, not painted, not rendered as game art',
  'No text, no lettering, no logos, no insignia, no grid lines, no perspective,'
  + ' no horizon, no figures, no watermark, no border. Square 1:1 image.'
];

export const MAX_DESCRIBE = 600;

const clean = (v) => String(v == null ? '' : v)
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_DESCRIBE);

/* Takes either a free description, or an environment/condition pair, or both.
   The description leads, because it is the specific thing the GM asked for;
   the list entries fill in behind it when they were used. */
/* ---- the props that stand on that ground ----

   Sixteen tokens — doors, cover, hazards, foliage — asked for as ONE 4x4
   sheet rather than sixteen calls. Three reasons, in order of how much they
   matter:

   1. They have to match each other. Generated separately the crates come back
      in a different light, a different degree of wear and a slightly
      different palette from the pillar beside them, and a deck dressed in
      them looks like a collage. In one image the model is composing a set.
   2. They have to match the floor. The ground's own description is repeated
      here, so the props are of the same place as the surface they stand on.
   3. One image is one call.

   THE ORDER IS LOAD-BEARING. The app slices this sheet by position — cell 0
   is the closed door, cell 4 the crates — so SHEET_SLOTS below must stay in
   step with SPRITE_SLOTS in src/spritesheet.js. They are checked against each
   other in mapprompt.check.mjs; if the lists ever disagree the app cuts the
   fire out of the cell holding the pillar, and nothing else would catch it. */
const SHEET_SLOTS = [
  ['door_closed', 'a heavy closed wooden door, iron-banded, both leaves shut, seen from directly above'],
  ['door_open', 'the same doorway standing open: only the frame and the open threshold,'
    + ' the opening itself empty black so the floor shows through it'],
  ['trapdoor', 'a small wooden trapdoor with an iron ring pull, set flush into the floor, closed'],
  ['barrier', 'a low stone wall or wooden fence about waist height, running across the cell,'
    + ' the kind an archer crouches behind and shoots over'],
  ['barrels', 'a stack of barrels and wooden crates piled together, bound with iron hoops'],
  ['furniture', 'a heavy oak table with benches, or a carved stone altar, or a heap of fallen masonry'],
  ['pillar', 'a single massive stone pillar or column, part of the building'],
  ['fire', 'an open fire burning on the ground, flame and glowing embers'],
  ['gas', 'a drifting cloud of poisonous green gas, semi-transparent'],
  ['arcane', 'a glowing magical glyph, a rune circle inscribed on the ground and lit from within'],
  ['smoke', 'a bank of thick grey fog or smoke, soft-edged and semi-transparent'],
  ['scrub', 'sparse low scrub and small plants, scattered, mostly bare ground between'],
  ['thicket', 'a dense thicket of tall plants, thick enough to hide a person'],
  ['tangle', 'a tangle of creeper, roots and spider web across the ground'],
  ['grate', 'an iron floor grating or drain set into the ground, seen from above'],
  ['wall_low', 'a low broken stone wall or bench, chest height, running across the cell']
];

export const SHEET_SLOT_ROLES = SHEET_SLOTS.map(([role]) => role);

/* The master token style. The GM's own words, kept verbatim as the fixed
   wrapper, because the sheets that already ship were generated with it and a
   generated set has to sit beside them without looking generated:

     - 100% orthographic 90-degree top-down, which is the only angle that can
       be dropped onto a square of a battle map.
     - photoreal render, hyper-detailed materials, high-fantasy dungeon, well-used,
       rim lighting.
     - pitch-black background, which is what makes the token cuttable: the app
       turns that black into transparency (see src/spritesheet.js).
     - NO token frame, coin border, medallion ring or miniature base. Every
       one of those is a thing image models add unasked to anything called a
       "token", and every one of them is a ring of plastic around a crate.
     - no perspective tilt, no isometric, no front-facing portrait, no cartoon
       or pixel art. */
const SHEET_STYLE = [
  'A 4x4 grid of 16 separate objects on one square image, each object centred in its'
  + ' own cell with even spacing, every cell filled, no object touching another',
  '100% orthographic 90-degree top-down overhead view of each object, as laid on a'
  + ' tabletop battle map',
  'photorealistic 3D render, hyper-detailed physically based materials, 4K texture'
  + ' detail, classic high-fantasy dungeon-crawl aesthetic, weathered and well-used, specular metallic'
  + ' highlights, dramatic rim lighting',
  'every object isolated on a seamless solid pitch-black background, pure #000000,'
  + ' with no shadow cast onto the background',
  'No circular token frame, no coin border, no medallion ring, no plastic miniature'
  + ' base, no disc base, no cell borders, no grid lines, no dividing lines between'
  + ' cells, no text, no lettering, no numbering, no watermark.',
  'No 3D perspective tilt, no isometric angle, no front-facing or side-on view —'
  + ' every object must be seen from 100% directly overhead.',
  'Not 2D cartoon art, not pixel art, not low-poly, not anime illustration.'
];

/* The same description the floor was made from, so the props belong to it. */
export function buildSpritesPrompt(input) {
  const src = input && typeof input === 'object' ? input : {};
  const describe = clean(src.describe);
  const env = environmentById(src.environment);
  const cond = conditionById(src.condition);

  const place = describe || (env ? `${env.surface}, ${env.detail}` : null)
    || `${ENVIRONMENTS[0].surface}, ${ENVIRONMENTS[0].detail}`;

  const setting = [
    `Every object belongs to this place and is built of its materials: ${place}`,
    cond && cond.phrase ? cond.phrase : null
  ].filter(Boolean).join(', ') + '.';

  const list = 'Reading left to right, top to bottom, the sixteen cells are: '
    + SHEET_SLOTS.map(([, text], i) => `(${i + 1}) ${text}`).join('; ') + '.';

  return [SHEET_STYLE[0] + '.', setting, list, SHEET_STYLE.slice(1, 4).join(', ') + '.',
    ...SHEET_STYLE.slice(4)].join(' ');
}

export function buildTexturePrompt(input) {
  const src = input && typeof input === 'object' ? input : {};
  const describe = clean(src.describe);
  const cover = clean(src.cover);
  const env = environmentById(src.environment);
  const cond = conditionById(src.condition);

  // Nothing said at all still produces a usable floor rather than billing for
  // an empty request.
  const ground = describe || (env ? `${env.surface}, ${env.detail}` : null)
    || `${ENVIRONMENTS[0].surface}, ${ENVIRONMENTS[0].detail}`;

  const subject = [
    `The ground is ${ground}`,
    cover ? `scattered across it: ${cover}` : null,
    // 'none' carries an empty phrase and drops out rather than adding a comma.
    cond && cond.phrase ? cond.phrase : null
  ].filter(Boolean).join(', ') + '.';

  // The prohibitions are their own sentence; run into the list with a comma
  // they read as a mid-sentence aside and get weighted like one.
  const body = TAIL.slice(0, -1).join(', ') + '.';
  return [LEAD, subject, body, TAIL[TAIL.length - 1]].join(' ');
}
