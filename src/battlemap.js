/* ============================= BATTLE MAP =============================
   A map for a 5e fight — a dungeon crawl, a cave, a ruined road.

   There are two layers here and they are deliberately separate:

   GEOMETRY is the map itself: which cells are floor, which are void, where the
   doors are. It is scenery. The DM builds it by stamping modular tiles or
   painting cells, and the walls are not stored at all — they are derived from
   the floor every time it is drawn (see wallMask), so a wall can never
   disagree with the floor it is supposed to edge.

   COMBATANTS ARE NOT DRAWN. The fight is played with miniatures on the table,
   and the map is projected under them. A token painted on the map would sit
   beneath a physical model and fight it for the square, so nothing here tracks
   who is standing where — the models do that.

   That makes two scales matter, and they are different things:
     feetPerSquare  what a square is worth IN THE FICTION, which is what range
                    is priced in. Five, unless the DM says otherwise.
     mmPerSquare    how big a square is ON THE TABLE, which is what the
                    projector has to be calibrated against so a square fits a
                    miniature's base.

   The payoff is reachBetween(): two squares become a distance in feet, and
   rules.js knows what that is worth against a weapon's normal and long range.

   Distance is the straight line between square centres, not squares walked:
   the PHB's variant for true distance, and the one under which a spell's
   sphere is round. */

import { rangeBand, RANGE_EFFECT, FEET_PER_SQUARE, coverDegree, CONE_HALF_ANGLE_DEG } from './rules.js';
import { spriteRole } from './spritesheet.js';

/* ------------------------------ themes ------------------------------ */

/* `wash` is how far the deck is knocked back before the grid, the tokens and
   the templates are drawn over it. It exists so those read against a busy
   floor, and it is per theme because the floors differ: a dim, cluttered
   flagstone needs the full quarter, and the same wash over sunlit sand turns a
   deliberately bright map grey.

   `gridAlpha` goes with it. The grid is how the table counts squares, so it
   has to be legible ON the floor, and a dark line over a bright deck needs
   to be drawn harder than a bright line over a dim one. */
const T = (id, name, subtitle, grid, accent, fallback, desc, wash = 0.25, gridAlpha = 0.3) => ({
  id, name, subtitle, grid, accent, fallback, desc, wash, gridAlpha,
  // The floor fill is a real photographed/painted texture served from
  // public/maps as a static file, not a flat colour and not a bundled
  // import: a 1024px texture has no business going through the JS bundle.
  // `fallback` is what the floor is painted if the texture 404s.
  texture: `/maps/${id}.jpg`
});

export const MAP_THEMES = [
  T('dungeon', 'Dungeon', 'Worn flagstones, mortar seams, old straw',
    '#e6d9b8', '#c0552a', '#534f47',
    'Cut stone laid by people long dead, and walked on by whatever came after.'),
  T('catacombs', 'Crypt', 'Pale marble slabs, bone dust, cracked inlay',
    '#2e342e', '#4a6a48', '#aea799',
    'Burial halls under a temple. Everything here was placed carefully, then left.',
    0.14, 0.5),
  T('cavern', 'Cavern', 'Damp bare rock, flowstone, pooled water',
    '#d8cbb4', '#c98f4a', '#555246',
    'A natural cave floor, uneven and wet, with nothing level for a mile.'),
  T('volcanic', 'Obsidian and Ember', 'Black basalt, glowing cracks, slag',
    '#f0c98a', '#ff6b2c', '#444341',
    'Ground that is still cooling, over something that is not.'),
  T('tavern', 'Tavern Boards', 'Worn plank, spilt ale, old nail-heads',
    '#f0dcb0', '#c0552a', '#705c45',
    'An inn’s common room, a ship’s deck, a merchant’s upper floor.',
    0.2, 0.34),

  /* Outdoors. The tile and door tools work out here unchanged — a wall is
     terrain and a door is a gate or a cave mouth, which is a matter of what the
     DM calls it at the table rather than anything the app needs told. The
     numbers differ a lot across these, because a sunlit dune and a forest
     floor are not the same kind of dark. */
  T('forest', 'Forest Floor', 'Leaf litter, root, moss, dappled earth',
    '#d9e6b8', '#7fa05a', '#4a4031',
    'Old woodland. Everything underfoot is rotting, or growing through something that is.',
    0.18, 0.34),
  T('swamp', 'Swamp', 'Peat, standing water, reed and algae',
    '#d3dfb0', '#8fa04a', '#3c3d30',
    'Low, wet ground where the path is whatever has not sunk yet.',
    0.2, 0.34),
  T('desert', 'Desert', 'Drift sand over cracked hardpan and bare rock',
    '#4a3520', '#8a5a2b', '#c1a278',
    'Wind-scoured and open. Cover is wherever the rock has broken, and there is not much of it.',
    0.14, 0.5),
  T('tundra', 'Frozen Tundra', 'Pack snow, blue ice, frost-heaved stone',
    '#2c4450', '#2f7f99', '#9da9b4',
    'Hard ground under thin snow. The blue is where the snow has gone and the ice has not.',
    0.12, 0.55),
  T('cobbles', 'Cobbled Street', 'Rounded setts, packed dirt in the gaps',
    '#e6dcc4', '#b5651d', '#686153',
    'A town street or a keep’s courtyard, worn to a shine down the middle.',
    0.2, 0.34)
];

export const DEFAULT_THEME = 'dungeon';

/* What to tell a GM about a floor they are about to upload.

   A map texture TILES. That is the whole difference between it and a
   picture, and it is what makes the two things people reach for — a photo
   and a screenshot — usually wrong: a 16:9 shot repeats as a band of
   letterboxed strips, and anything with a horizon in it tiles into a wall.

   Square is the shape to aim for, within a few per cent. Pure, so the
   advice can be checked without a canvas. */

/* How far from square a floor can be before it is worth saying something.
   Set from real generated floors rather than picked: image generators hand
   back 1024x945 and 1024x930 more often than 1024x1024, because a watermark was
   cropped off the bottom. A tolerance that flagged those as the wrong shape
   would be advice nobody should take. 4:3 and 16:9 are still well outside. */
export const SQUARE_TOLERANCE = 0.12;

export function textureAdvice(size) {
  const w = Math.round(Number(size && size.width) || 0);
  const h = Math.round(Number(size && size.height) || 0);
  if (w <= 0 || h <= 0) {
    return { ok: false, square: false, ratio: 0, message: 'That file is not an image this can read.' };
  }
  const ratio = w / h;
  const square = Math.abs(ratio - 1) <= SQUARE_TOLERANCE;
  if (square) {
    return {
      ok: true, square: true, ratio,
      message: `${w}\u00d7${h}, square enough to tile cleanly.`
    };
  }
  // Said as a ratio rather than a decimal, because 16:9 is a thing a person
  // recognises and 1.78 is not.
  const asRatio = ratio > 1
    ? `${(ratio).toFixed(2).replace(/\.?0+$/, '')}:1`
    : `1:${(1 / ratio).toFixed(2).replace(/\.?0+$/, '')}`;
  return {
    ok: true, square: false, ratio,
    message: `${w}\u00d7${h} is ${asRatio}. A floor tiles best square \u2014 `
      + 'cropped to the middle it will repeat cleanly; left as it is it repeats as a band.'
  };
}

/* ---------------- a saved environment, and its five numbers ----------------
   A GM who generates a ground should not then be asked for a grid colour, a
   wash and a grid strength. They are derived from the image itself, using the
   same reasoning the nine built-in themes were tuned by hand with (see
   TEXTURES.md): a dark line on a bright floor and a pale one on a dark floor,
   less knock-back on a bright deck because washing it only turns it grey, and
   more ink in the grid where it has to fight a bright texture.

   The caller samples the image; this decides what the numbers are, so the
   decision is testable without a canvas. */

const byte = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('');

// Above this the floor is treated as bright. 110 of 255 is where a dark grid
// line starts reading better than a pale one.
export const BRIGHT_FLOOR = 110;

export function themeNumbersFor(sample) {
  const s = sample && typeof sample === 'object' ? sample : {};
  const r = byte(s.r), g = byte(s.g), b = byte(s.b);
  const lum = Number.isFinite(Number(s.luminance)) ? Number(s.luminance) : (r + g + b) / 3;
  const bright = lum >= BRIGHT_FLOOR;
  return {
    fallback: hex(r, g, b),
    grid: bright ? hex(r * 0.22, g * 0.24, b * 0.3) : hex(132 + r * 0.34, 142 + g * 0.34, 118 + b * 0.34),
    accent: bright ? hex(r * 0.5, g * 0.46, b * 0.42) : hex(92 + r * 0.5, 96 + g * 0.5, 78 + b * 0.5),
    wash: bright ? 0.14 : 0.22,
    gridAlpha: bright ? 0.52 : 0.34
  };
}

/* An environment the GM generated and kept. It is a theme like any other
   except that its texture is a data URL on the saved record rather than a
   file in public/maps \u2014 there is no build to drop a file into at the
   table. */
export function readCustomTheme(x) {
  const src = x && typeof x === 'object' ? x : null;
  if (!src) return null;
  const texture = typeof src.texture === 'string'
    && /^data:image\/(png|jpeg|webp);base64,/.test(src.texture)
    && src.texture.length <= MAX_CUSTOM_TEXTURE ? src.texture : null;
  if (!texture) return null;          // a theme with no floor is not a theme
  const n = themeNumbersFor({});
  const col = (v, fallback) =>
    (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v : fallback;
  const num = (v, fallback, lo, hi) => {
    const x2 = Number(v);
    return Number.isFinite(x2) ? Math.min(hi, Math.max(lo, x2)) : fallback;
  };
  return {
    id: (typeof src.id === 'string' && src.id) || newThemeId(),
    name: String(src.name || '').slice(0, 60) || 'Saved ground',
    subtitle: String(src.subtitle || '').slice(0, 120),
    desc: String(src.desc || '').slice(0, 300),
    // What it was asked for, kept so it can be generated again or adjusted.
    prompt: String(src.prompt || '').slice(0, 800),
    texture,
    /* The ground's sixteen props, as one 4x4 sheet, already keyed to
       transparency by the browser that made it. A string when this ground has
       props and null when it has none, and null is the ordinary case: every
       ground saved before props existed has none, and uploading a floor does
       not generate any. The index entry carries a boolean instead (see
       api/grounds.js) so the picker can say which grounds are dressed without
       hauling the sheets about. */
    sprites: typeof src.sprites === 'string'
      && /^data:image\/(png|jpeg|webp);base64,/.test(src.sprites)
      && src.sprites.length <= MAX_CUSTOM_SPRITES ? src.sprites : null,
    custom: true,
    grid: col(src.grid, n.grid),
    accent: col(src.accent, n.accent),
    fallback: col(src.fallback, n.fallback),
    wash: num(src.wash, 0.2, 0, 0.5),
    gridAlpha: num(src.gridAlpha, 0.35, 0.11, 1)
  };
}

let themeSeq = 0;
const newThemeId = () => 'env-' + Date.now().toString(36) + '-' + (themeSeq++).toString(36);

export const readThemeLibrary = (list) =>
  (Array.isArray(list) ? list : []).map(readCustomTheme).filter(Boolean);

/* The theme a map is using, built-in or saved. A saved one that has since
   been deleted falls back to a built-in rather than leaving the renderer
   without colours. */
export const resolveTheme = (id, custom) =>
  (Array.isArray(custom) ? custom.find((t) => t.id === id) : null) || themeById(id);


// Falls back to the default rather than returning undefined: the renderer
// reads theme.grid straight off this, and an undefined would crash the canvas
// rather than merely looking wrong.
export const themeById = (id) =>
  MAP_THEMES.find((t) => t.id === id) ||
  MAP_THEMES.find((t) => t.id === DEFAULT_THEME) ||
  MAP_THEMES[0];

/* --------------------------- the tile catalogue --------------------------- */

const TL = (id, name, category, w, h, kind) => ({ id, name, category, w, h, kind });

export const TILE_CATALOG = [
  TL('corridor_1x1', 'Corridor Cell', 'Corridors', 1, 1, 'floor'),
  TL('corridor_1x2', 'Corridor, short', 'Corridors', 1, 2, 'floor'),
  TL('corridor_1x3', 'Corridor', 'Corridors', 1, 3, 'floor'),
  TL('corridor_1x5', 'Corridor, long', 'Corridors', 1, 5, 'floor'),
  TL('corner_1x1', 'L-turn corner', 'Junctions', 1, 1, 'floor'),
  TL('t_junction_1x1', 'T-junction', 'Junctions', 1, 1, 'floor'),
  TL('cross_1x1', 'Crossroads', 'Junctions', 1, 1, 'floor'),
  TL('dead_end_1x1', 'Dead end', 'Junctions', 1, 1, 'floor'),
  TL('room_2x2', 'Cell', 'Rooms', 2, 2, 'floor'),
  TL('room_3x3', 'Chamber', 'Rooms', 3, 3, 'floor'),
  TL('room_3x4', 'Barracks', 'Rooms', 3, 4, 'floor'),
  TL('room_5x5', 'Great hall', 'Rooms', 5, 5, 'floor'),
  TL('collapse_1x1', 'Collapsed passage', 'Special', 1, 1, 'floor'),
  TL('alcove_1x1', 'Alcove', 'Special', 1, 1, 'floor'),
  TL('stairs_1x1', 'Stairs', 'Special', 1, 1, 'floor')
];

export const tileById = (id) => TILE_CATALOG.find((t) => t.id === id) || null;

export const TILE_CATEGORIES = [...new Set(TILE_CATALOG.map((t) => t.category))];

/* ------------------------------ the map ------------------------------ */

// feetPerSquare is the calibration knob, and it is deliberately a knob rather
// than a constant. Five feet is the grid the books are written for; ten suits a
// cavern that would otherwise need a 60-square map. Every distance this module
// reports runs through it.
export const EMPTY_MAP = {
  theme: DEFAULT_THEME,
  cols: 30,
  rows: 20,
  feetPerSquare: FEET_PER_SQUARE,
  /* A generated ground, as a data URL, overriding the theme's own texture.
     Kept ON THE DECK rather than in public/maps because it is made at the
     table: there is no build to drop a file into, and a GM who generates a
     fen for tonight should not have to deploy to use it. The theme's five
     numbers still apply \u2014 switch theme to re-tune the grid over it. */
  customTexture: null,
  // 25mm is a standard base, and an inch is the five-foot square most terrain
  // is cut to. This is the real-world size of a square, and it is what the
  // projector is calibrated against — see calibrationBar.
  mmPerSquare: 25,
  pxPerSquare: 40,      // screen pixels per square, adjusted until it matches
  floor: {},            // { 'x,y': true } — the single source of truth for deck
  /* PER-CELL GROUND. One deck is rarely one terrain: a dungeon crawl runs
     from the ice outside to the deck plate inside, and an agri-world fight
     crosses ploughed soil, an irrigation ditch and the rockcrete apron.

     A cell named here is drawn with that ground instead of the deck's own.
     It is PAINT, nothing more: the floor stays binary, so the walls derived
     from it, the regions flood-filled over it and the fog that follows them
     are all untouched by what a square looks like. That is the whole reason
     this is a separate layer and not a second kind of floor. */
  ground: {},           // { 'x,y': themeId }
  doors: {},            // { 'x,y': { kind, state } }
  cover: {},            // { 'x,y': coverTypeId } — things standing on the deck
  hazards: {},          // { 'x,y': hazardTypeId } — dangerous to stand in
  obscuring: {},        // { 'x,y': densityId } — foliage and smoke, see OBSCURING
  lighting: 'bright',   // see LIGHTING_PRESETS
  markers: {},          // { 'x,y': { type, label } } — scenery
  // Fog of war. `explored` is what the party has seen; `fog` is whether the
  // map is drawn with it. The two are separate so turning fog off to check
  // something does not throw away what was explored.
  explored: {},         // { 'x,y': true } — everywhere the party has EVER seen
  // Where they are now, set by the last reveal. What is DRAWN is `explored`
  // narrowed to what can still be walked to from here through open doors, so
  // shutting a door takes the room beyond it off the board and opening
  // it again brings the room back. Nothing is forgotten to do that — see
  // visibleExplored.
  viewpoint: null,
  fog: false,
  /* Monsters the DM has hidden on the map. THESE ARE NOT TOKENS: the fight is
     played with miniatures, and a model standing on a square the party has not
     reached would give the position away. A contact is the DM's own note of
     what is out there, and the one thing fog is allowed to leak — a sense
     sweep turns a hidden contact into a ping, which says something is there
     without saying what, or opening the map around it. */
  contacts: {}          // { 'x,y': { name, state } }
};

// ~1.5MB of base64, which is a 768px JPEG with room to spare. Past this a
// generated ground is costing more to load than the deck it decorates.
export const MAX_CUSTOM_TEXTURE = 1_500_000;
// A prop sheet is sixteen tokens in one 1024px image, and mostly transparent,
// which WebP packs hard. Its own ceiling rather than the floor's: the two are
// stored apart and a sheet going over should not cost a ground its floor.
export const MAX_CUSTOM_SPRITES = 1_500_000;

/* The largest grid a deck may be.

   Not a canvas limit any more: the map is drawn a window at a time (see
   BattleMap.jsx), so a deck can be far wider than any browser could hold as
   one image, and a square keeps the size the projector was calibrated to.
   What bounds it now is the cost of the per-square records the editor works
   on, and the size a saved deck may take once packed (packMap). 500 x 500 is
   a quarter of a million squares: a district, a hive spire's footprint, a
   forest. */
/* Zoom is a VIEW control: it scales what is already drawn so the GM can read
   a corner or take in a whole deck. It is deliberately not stored on the map
   — px/square is the projector's calibration and must not move — and it is
   bounded because a canvas scaled past a few hundred per cent is a wall of
   blur, and one scaled under a fiftieth is a dot. */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;
export const clampZoom = (z) => {
  // An empty box means "nothing typed yet", not zero. Number('') is 0 and
  // Number(null) is 0, and reading either as a zoom clamps the map to its
  // smallest size while the GM is halfway through typing a number.
  if (z === null || z === undefined) return 1;
  if (typeof z === 'string' && z.trim() === '') return 1;
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
};

export const MAX_GRID = 500;
export const MIN_GRID = 5;

export const cellKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;
export const parseKey = (k) => {
  const parts = String(k).split(',');
  // Both halves must actually be there. Number('') is 0, so a truncated key
  // like "3," would otherwise read as the cell (3, 0) and put floor down in
  // a square nobody painted.
  if (parts.length !== 2 || parts.some((p) => p.trim() === '')) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

const int = (v, fallback, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const DOOR_STATES = ['closed', 'open', 'jammed'];
// Closed -> open -> jammed -> closed. A jammed door still blocks, which is
// the whole reason the state exists: stuck, barred or locked.
export const nextDoorState = (s) => {
  const i = DOOR_STATES.indexOf(s);
  return DOOR_STATES[(i < 0 ? 0 : i + 1) % DOOR_STATES.length];
};
export const doorBlocks = (state) => state !== 'open';

/* What a door is made of decides what it takes to get through it. The AC is
   the object's, from the DMG's table of object armour class: wood 15, stone 17,
   iron 19. A trapdoor is a door you cross on your hands and knees, which is why
   it has its own picture and its own kind. */
export const DOOR_KINDS = [
  { id: 'wooden', name: 'Wooden door', ac: 15,
    note: 'Bars and bolts decide whether it is a lock to pick or a door to break.' },
  { id: 'iron', name: 'Iron door', ac: 19,
    note: 'Banded or solid. Breaking one is a job, not an action.' },
  { id: 'trapdoor', name: 'Trapdoor', ac: 15,
    note: 'A hatch in floor or ceiling: cellars, shafts, thieves’ ways.' }
];
export const doorKindById = (id) =>
  DOOR_KINDS.find((d) => d.id === id) || DOOR_KINDS[0];

/* A door may be stored as the bare state string. Both shapes are read, and a
   bare one is a wooden door, the commonest kind. */
export function readDoor(v) {
  if (typeof v === 'string') {
    return DOOR_STATES.includes(v) ? { kind: 'wooden', state: v } : null;
  }
  if (!v || typeof v !== 'object' || !DOOR_STATES.includes(v.state)) return null;
  return { kind: doorKindById(v.kind).id, state: v.state };
}

/* ---------------------------- cover ----------------------------
   Something standing ON a square rather than the floor itself. `degree` is the
   5e cover it gives a target behind it (rules.js COVER_DEGREES): half is +2 to
   AC and Dexterity saves, three-quarters +5, total cannot be targeted. The one
   that stops a lane outright is blocksSight: a pillar is a wall you cannot see
   past, a low wall is a thing you crouch behind and shoot over, and treating
   them alike would either seal a hallway or make a hall transparent. */
/* `directional` is cover that RUNS one way across its square rather than
   filling it: a low wall has a length and two sides, and the DM says which way
   it lies. The others are bulk — a stack of barrels occupies its square from
   every approach — so they have no angle to choose, do not record one, and are
   scattered by position instead (see spriteTurn in spritesheet.js, whose
   `turn` flag is the same fact seen from the art's side: a picture that may be
   freely turned is a picture with no front). */
export const COVER_TYPES = [
  { id: 'low', name: 'Low wall or fence', degree: 'half', blocksSight: false, directional: true,
    note: 'Crouch behind it and shoot over it.' },
  { id: 'furniture', name: 'Furniture or rubble', degree: 'half', blocksSight: false, directional: false,
    note: 'A table, an altar, a heap of fallen masonry.' },
  { id: 'barrels', name: 'Barrels and crates', degree: 'three_quarters', blocksSight: false, directional: false,
    note: 'Stacked high enough that only a head shows over them.' },
  { id: 'pillar', name: 'Pillar or statue', degree: 'total', blocksSight: true, directional: false,
    note: 'Part of the building. It does not move and it does not break.' }
];
export const coverById = (id) => COVER_TYPES.find((c) => c.id === id) || null;

/* WHICH WAY THE COVER LIES.

   A low wall has a direction. It runs along one edge of a square and you
   crouch on one side of it, and the art for it is drawn running left to right.
   Laid down the length of a corridor that runs north, every one of them is
   across the corridor rather than along it, which is not what the DM drew and
   not what the table will read.

   So a wall is stored as one of TWO states: 0 lying across its square as the
   art is drawn, 1 standing up it, which is the same picture turned a quarter.
   Two and not four quarter turns, because a wall turned a half turn is the
   same wall seen from the other side — the DM is choosing between — and |, and
   a control offering four of them would offer two pairs of identical pictures.

   A cover square may be the bare type id, and is WRITTEN as one unless it is
   turned — writeCover gives back the plain string for turn 0 — so a map of a
   thousand untouched barrels stores a thousand short strings rather than a
   thousand little objects.

   Only DIRECTIONAL cover keeps an angle, and both of these enforce that rather
   than leaving it to the callers. A stack of barrels has no front, so recording
   which way round it is would be a fiction — and an expensive one. */
// 0 across, 1 standing up. Anything else folds into one of the two, so a
// deck turned twice or a hand-edited record cannot hold a third state.
const lie = (v) => {
  const t = Math.round(Number(v));
  return Number.isFinite(t) ? ((t % 2) + 2) % 2 : 0;
};

export function readCover(v) {
  const raw = typeof v === 'string' ? { id: v, turn: 0 }
    : (v && typeof v === 'object' ? v : null);
  const type = raw && coverById(raw.id);
  if (!type) return null;
  return { id: raw.id, turn: type.directional ? lie(raw.turn) : 0 };
}

export const writeCover = (id, turn = 0) => {
  const type = coverById(id);
  if (!type || !type.directional) return id;
  return lie(turn) ? { id, turn: 1 } : id;
};


// The cover type on a square, whichever form the square is stored in. Most
// callers want the type and not the angle: it is the type that blocks sight
// and sets the degree of cover.
export const coverAt = (v) => {
  const rec = readCover(v);
  return rec ? coverById(rec.id) : null;
};

/* ---------------------------- hazards ----------------------------
   A square that is dangerous to stand in. These block nothing and stop
   nothing — they are information, drawn so the table can see where not to
   walk. The notes are table aids, not rulings: the DMG gives a few of these a
   number (lava), and where it does not, the DM sets the toll. */
export const HAZARD_TYPES = [
  { id: 'fire', name: 'Fire', colour: '#ff6b2c',
    note: 'Fire damage to whatever enters or starts its turn here. Flammable things ignite.' },
  { id: 'poison', name: 'Poison gas', colour: '#5fe06a',
    note: 'A Constitution saving throw each round, or poisoned and damaged as the DM rules.' },
  { id: 'acid', name: 'Acid', colour: '#c8e03c',
    note: 'Acid damage on contact, and it eats gear. A pool, a spray or a dripping ceiling.' },
  { id: 'lava', name: 'Lava', colour: '#ff3d1a',
    note: 'Falling into lava deals 10d10 fire damage (DMG). Standing next to it is merely hot.' },
  { id: 'spikes', name: 'Pit or spikes', colour: '#b0b4bc',
    note: 'A fall, and what is at the bottom. A Dexterity saving throw to catch the edge.' },
  { id: 'arcane', name: 'Magic glyph', colour: '#b98cff',
    note: 'A ward or a trap that goes off when it is crossed. The DM decides what it casts.' }
];
export const hazardById = (id) => HAZARD_TYPES.find((h) => h.id === id) || null;

/* ---------------------------- obscuring terrain ----------------------------
   Foliage, fog and the like: not cover (nobody crouches behind it for a bonus
   to AC) but it eats sight. The PHB has two states, lightly obscured
   (disadvantage on sight-based Perception) and heavily obscured (as if
   blinded), and gives no distance for either — so sight is carried this far
   INTO the stuff before it stops dead, and the denser it is the sooner. The
   distances are house numbers and the DM can edit the table. Folded into
   lineBlocked, so the ruler, the line-of-sight overlay and the fog reveal all
   see it. */
export const OBSCURING = [
  { id: 'light', name: 'Light foliage / thin mist', blocksAfterFt: 30, colour: '#7fbf6a', alpha: 0.18 },
  { id: 'medium', name: 'Thick brush / fog', blocksAfterFt: 15, colour: '#5f9f55', alpha: 0.3 },
  { id: 'heavy', name: 'Dense thicket / heavy smoke', blocksAfterFt: 5, colour: '#3f7f40', alpha: 0.45 }
];
export const obscuringById = (id) => OBSCURING.find((o) => o.id === id) || null;

/* The light a map is fought in. Each preset names what it does to sight, in the
   PHB's own terms: dim light and thin weather are lightly obscured, darkness
   is heavily obscured. A table aid for the DM, not a roll. */
export const LIGHTING_PRESETS = [
  { id: 'bright', name: 'Bright light', effect: 'No effect on sight.' },
  { id: 'dim', name: 'Dim light or shadow', effect: 'Lightly obscured: disadvantage on sight-based Perception.' },
  { id: 'fog', name: 'Fog or smoke', effect: 'Lightly obscured, heavily where it is thick.' },
  { id: 'rain', name: 'Heavy rain or ash storm', effect: 'Lightly obscured: disadvantage on Perception, open flames gutter.' },
  { id: 'dark', name: 'Darkness', effect: 'Heavily obscured: a creature without darkvision is effectively blinded.' }
];
export const lightingById = (id) => LIGHTING_PRESETS.find((p) => p.id === id) || LIGHTING_PRESETS[0];

export const MARKER_TYPES = [
  { id: 'trap', name: 'Trap', colour: '#e74c3c' },
  { id: 'objective', name: 'Objective', colour: '#f1c40f' },
  { id: 'treasure', name: 'Treasure', colour: '#d4af37' },
  { id: 'start', name: 'Party start', colour: '#3498db' }
];
export const markerTypeById = (id) => MARKER_TYPES.find((m) => m.id === id) || MARKER_TYPES[0];

/* ----------------------- big decks: clean layers, packed storage -----------------------

   A deck is a record per square, and a big one is a quarter of a million of
   them. Two things follow, and both live here so the rest of the code does not
   have to know.

   CLEAN LAYERS. readMap used to walk every square of every layer on every
   call, and it is called on every render and every edit. A layer it has already
   walked is remembered (by identity, never by contents) and handed straight
   back, so reading a map costs what changed rather than what exists. Layers
   are never mutated in place anywhere, so identity is a safe key. A layer a
   caller builds from a clean one with only well-formed squares (paintCells,
   keepClean) joins the set without a second walk.

   PACKED STORAGE. Saved to the library, a layer is written as runs along its rows instead of a
   key per square — a filled 500 x 500 floor is a few kilobytes, not three
   megabytes. readMap accepts either form, so a deck saved before this was
   written still opens, and nothing that reads a map needs to ask which it is. */
const CLEAN = new WeakSet();

export function keepClean(base, next) {
  if (base && typeof base === 'object' && CLEAN.has(base)) CLEAN.add(next);
  return next;
}

const isPackedLayer = (v) => Boolean(v) && typeof v === 'object' && v.rle === 1
  && Array.isArray(v.runs) && Array.isArray(v.vals);

// A packed layer back to { 'x,y': value }. Bounded by the largest grid, so a
// hostile or corrupt runs array cannot ask for a billion squares.
function unpackLayer(raw) {
  if (!isPackedLayer(raw)) return raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const { runs, vals } = raw;
  let y = 0, end = -1;
  for (let i = 0; i + 3 < runs.length; i += 4) {
    const dy = Math.round(Number(runs[i]));
    const dx = Math.round(Number(runs[i + 1]));
    const len = Math.round(Number(runs[i + 2]));
    const v = vals[Number(runs[i + 3])];
    if (!Number.isFinite(dy) || !Number.isFinite(dx) || !Number.isFinite(len)) continue;
    y += dy;
    const x0 = dy > 0 ? dx : end + 1 + dx;
    const x1 = x0 + Math.max(0, len);
    end = x1;
    if (v === undefined || y < 0 || y >= MAX_GRID) continue;
    const lo = Math.max(0, x0);
    const hi = Math.min(MAX_GRID - 1, x1);
    for (let x = lo; x <= hi; x++) out[x + ',' + y] = v;
  }
  return out;
}

function layer(raw, build) {
  const plain = unpackLayer(raw);
  if (CLEAN.has(plain)) return plain;
  const out = build(plain);
  CLEAN.add(out);
  return out;
}

/* One layer as runs, four numbers each: how many rows down from the last run,
   how far along (from the left edge for the first run on a row, from the end of
   the previous run after that), how many squares past the first it covers, and
   which of the distinct values (listed once in `vals`) it holds. Sorted by row
   then column. A run is a row-wise stretch of neighbours holding one value.
   Differences rather than positions, because small numbers are short ones: a
   big deck's layers come out about half the size they would otherwise. */
export function packLayer(layerObj) {
  const cells = [];
  for (const [k, v] of Object.entries(layerObj || {})) {
    const p = parseKey(k);
    if (p) cells.push([p.y, p.x, v]);
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const vals = [];
  const index = new Map();
  const runs = [];
  let cur = null;
  let py = 0, pend = -1;
  const flush = () => {
    if (!cur) return;
    const dy = cur.y - py;
    runs.push(dy, dy > 0 ? cur.x0 : cur.x0 - pend - 1, cur.x1 - cur.x0, cur.vi);
    py = cur.y; pend = cur.x1;
  };
  for (const [y, x, v] of cells) {
    const id = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    let vi = index.get(id);
    if (vi === undefined) { vi = vals.length; vals.push(v); index.set(id, vi); }
    if (cur && cur.y === y && cur.x1 + 1 === x && cur.vi === vi) {
      cur.x1 = x;
    } else {
      flush();
      cur = { y, x0: x, x1: x, vi };
    }
  }
  flush();
  return { rle: 1, vals, runs };
}

// Layers that run into the thousands on a big deck. Doors, markers and
// contacts are a handful of records each and stay as they are.
const PACKED_LAYERS = ['floor', 'ground', 'cover', 'hazards', 'obscuring', 'explored'];
const PACK_FROM = 64;     // below this a plain layer is smaller and easier to read

/* The map as it should be stored. Round-trips exactly through readMap.
   Remembered per map object: the autosave and the library write both ask for
   the same map within a second of each other, and packing a big one is the
   slowest thing here. */
const PACKED = new WeakMap();
export function packMap(map) {
  if (map && typeof map === 'object' && PACKED.has(map)) return PACKED.get(map);
  const m = readMap(map);
  const out = { ...m };
  for (const key of PACKED_LAYERS) {
    if (Object.keys(m[key]).length >= PACK_FROM) out[key] = packLayer(m[key]);
  }
  if (map && typeof map === 'object') PACKED.set(map, out);
  return out;
}

// A saved deck with its map packed. Anything else about the entry, and an
// entry with no map yet, is left exactly as it was.
export const packSavedMap = (x) => (x && typeof x === 'object' && x.map && typeof x.map === 'object'
  ? { ...x, map: packMap(x.map) } : x);

// Anything absent is defaulted rather than trusted, the same way readBlueprint
// treats a blueprint saved before a field existed.
export function readMap(m) {
  const src = m && typeof m === 'object' ? m : {};

  const floor = layer(src.floor, (raw) => {
    const out = {};
    for (const k of Object.keys(raw)) if (raw[k] && parseKey(k)) out[k] = true;
    return out;
  });
  const doors = layer(src.doors, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!parseKey(k)) continue;
      const d = readDoor(v);
      if (d) out[k] = d;
    }
    return out;
  });
  const cover = layer(src.cover, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      // Canonical, not normalised: a turned square keeps its object and an
      // untouched one keeps its bare string, so reading a map and writing it
      // back does not inflate every crate on the deck into a record.
      const c = readCover(v);
      if (parseKey(k) && c) out[k] = writeCover(c.id, c.turn);
    }
    return out;
  });
  const hazards = layer(src.hazards, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) if (parseKey(k) && hazardById(v)) out[k] = v;
    return out;
  });
  const obscuring = layer(src.obscuring, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) if (parseKey(k) && obscuringById(v)) out[k] = v;
    return out;
  });
  /* Ground ids are KEPT AS WRITTEN, exactly as the deck's own theme is: a
     saved ground's id is unknown to this module, and matching against the
     built-in list here is the bug that silently moved every deck built on a
     generated floor back to the default. resolveTheme decides, at the point
     of drawing, where the library is actually in hand. */
  const ground = layer(src.ground, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (parseKey(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 64);
    }
    return out;
  });
  const explored = layer(src.explored, (raw) => {
    const out = {};
    for (const k of Object.keys(raw)) if (raw[k] && parseKey(k)) out[k] = true;
    return out;
  });
  const contacts = layer(src.contacts, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!parseKey(k)) continue;
      const c = readContact(v);
      if (c) out[k] = c;
    }
    return out;
  });
  const markers = layer(src.markers, (raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!parseKey(k) || !v || typeof v !== 'object') continue;
      out[k] = { type: markerTypeById(v.type).id, label: String(v.label || '') };
    }
    return out;
  });
  return {
    /* KEPT AS WRITTEN, not matched against the built-in list. A saved
       ground's id is unknown to this module by design, and coercing it here
       silently moved every deck built on one back to the default theme.
       resolveTheme() is what makes an unresolvable id safe, at the point of
       drawing, where the saved library is actually in hand. */
    theme: (typeof src.theme === 'string' && src.theme.trim())
      ? src.theme.trim().slice(0, 64) : DEFAULT_THEME,
    cols: int(src.cols, EMPTY_MAP.cols, MIN_GRID, MAX_GRID),
    rows: int(src.rows, EMPTY_MAP.rows, MIN_GRID, MAX_GRID),
    // Two-and-a-half-foot squares are legitimate (a cramped crawlway), so this
    // one is not rounded to an integer like the rest.
    feetPerSquare: (() => {
      const n = Number(src.feetPerSquare);
      return Number.isFinite(n) && n > 0 ? Math.min(50, n) : EMPTY_MAP.feetPerSquare;
    })(),
    pxPerSquare: int(src.pxPerSquare, EMPTY_MAP.pxPerSquare, 10, 200),
    mmPerSquare: int(src.mmPerSquare, EMPTY_MAP.mmPerSquare, 5, 100),
    fog: Boolean(src.fog),
    lighting: lightingById(src.lighting).id,
    /* Only ever an image data URL, and bounded. It rides along in the saved
       deck, so an oversized one would quietly bloat every read and write of
       the GM's library; and a non-data URL here would let a saved document
       point the renderer at an arbitrary address. */
    customTexture: (() => {
      const v = src.customTexture;
      if (typeof v !== 'string') return null;
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(v)) return null;
      return v.length <= MAX_CUSTOM_TEXTURE ? v : null;
    })(),
    viewpoint: (() => {
      const v = src.viewpoint;
      if (!v || typeof v !== 'object') return null;
      const x = Math.round(Number(v.x)), y = Math.round(Number(v.y));
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })(),
    floor, doors, cover, hazards, obscuring, markers, explored, contacts, ground
  };
}

/* Every ground a deck actually draws with, the deck's own first. What the
   renderer has to have loaded before it can paint, and nothing more — a deck
   that uses two grounds should not fetch the other seven. */
export function groundsUsed(map) {
  const m = map && typeof map === 'object' ? map : EMPTY_MAP;
  const out = [];
  const add = (id) => { if (id && !out.includes(id)) out.push(id); };
  add(typeof m.theme === 'string' ? m.theme : DEFAULT_THEME);
  for (const k of Object.keys(m.ground || {})) {
    // Only where there is deck to paint: a ground left behind on an erased
    // square is not drawn, so it should not be fetched either.
    if (!m.floor || m.floor[k]) add(m.ground[k]);
  }
  return out;
}

/* Which prop pictures a deck needs, as "<ground>/<role>" strings.

   Worked out from what is actually ON the deck rather than loaded wholesale:
   each ground has sixteen tokens weighing about half a megabyte together, and
   a deck with two doors and no cover has no business fetching the crates, the
   fire and the foliage. The ground is per square, so a crate standing on a
   square painted with ice is an ICE crate — the props follow the floor they
   are standing on, which is the whole point of having a set per ground.

   Expects a map already through readMap. Returns a sorted array so callers can
   join it into a cache key and compare two of them cheaply. */
export function tokensNeeded(map) {
  const m = map && typeof map === 'object' ? map : EMPTY_MAP;
  const base = typeof m.theme === 'string' ? m.theme : DEFAULT_THEME;
  const out = new Set();
  const want = (k, kind, id, state) => {
    const at = parseKey(k);
    if (!at) return;
    const role = spriteRole(kind, id, state, at);
    if (!role) return;
    out.add(((m.ground || {})[k] || base) + '/' + role);
  };
  for (const [k, v] of Object.entries(m.doors || {})) {
    if (v) want(k, 'door', v.kind, v.state);
  }
  for (const [k, v] of Object.entries(m.cover || {})) {
    const c = readCover(v);
    if (c) want(k, 'cover', c.id);
  }
  for (const [k, v] of Object.entries(m.hazards || {})) want(k, 'hazard', v);
  for (const [k, v] of Object.entries(m.obscuring || {})) want(k, 'obscure', v);
  return [...out].sort();
}

/* --------------------------- projector calibration ---------------------------

   A projected square has to match the miniatures standing on it, and no
   amount of arithmetic can work out how far the projector is from the table.
   So the map draws a bar of known real-world length and the GM stretches
   pxPerSquare until a ruler laid on the table agrees with it. That is the
   calibration knob; everything else about the projection follows from it.

   The bar spans whole squares, because a fractional square is impossible to
   line a ruler up against. */
export function calibrationBar(map, { targetMm = 100 } = {}) {
  const m = readMap(map);
  const squares = Math.max(1, Math.min(m.cols, Math.round(targetMm / m.mmPerSquare)));
  return {
    squares,
    mm: squares * m.mmPerSquare,
    px: squares * m.pxPerSquare,
    label: `${squares} squares = ${squares * m.mmPerSquare} mm`
  };
}

export const isFloor = (floor, x, y) => Boolean(floor && floor[cellKey(x, y)]);

// Cheaper than Object.keys(o).length on a big object: stops at the first key.
const isEmpty = (o) => { for (const _k in o) return false; return true; };

/* ---------------------------- contacts ----------------------------
   hidden : the party has no idea it is there.
   ping   : a sense has it — something is there, at that bearing. The map
            around it stays dark; only the contact shows.
   seen   : they have laid eyes on it, and the square is open. */
export const CONTACT_STATES = ['hidden', 'ping', 'seen'];
export const nextContactState = (st) => {
  const i = CONTACT_STATES.indexOf(st);
  return CONTACT_STATES[(i < 0 ? 0 : i + 1) % CONTACT_STATES.length];
};

export function readContact(v) {
  if (!v || typeof v !== 'object') return null;
  const name = String(v.name == null ? '' : v.name).slice(0, 60);
  if (!name) return null;      // a blip with no name is one nobody can act on
  const out = {
    name,
    state: CONTACT_STATES.includes(v.state) ? v.state : 'hidden'
  };
  // Squares across, from the creature's size. Written only when it is more than
  // one: most contacts are Medium, and a record per goblin should stay short.
  const size = Math.round(Number(v.size));
  if (Number.isFinite(size) && size > 1) out.size = Math.min(6, size);
  return out;
}

// Detect Evil and Good, Detect Magic and Detect Thoughts all reach thirty feet.
// A default, not a law — a DM with another sense in mind changes it.
export const SENSE_RANGE_FT = 30;

/* A sense sweep from a square. Everything in range that was hidden becomes a
   ping; what has already been seen stays seen, because a sense does not un-see
   a thing.

   A sweep is NOT line of sight: Detect Magic reads through a wall, which is
   most of why it is worth casting. Range alone bounds it. */
export function senseSweep(map, from, rangeFt = SENSE_RANGE_FT) {
  const m = readMap(map);
  if (!from) return m.contacts;
  const reach = (Number(rangeFt) || 0) / (m.feetPerSquare || 1);
  if (reach <= 0) return m.contacts;
  const out = {};
  for (const [k, c] of Object.entries(m.contacts)) {
    const p = parseKey(k);
    if (!p) continue;
    const near = Math.hypot(p.x - from.x, p.y - from.y) <= reach;
    out[k] = (near && c.state === 'hidden') ? { ...c, state: 'ping' } : c;
  }
  return out;
}

/* What the projection shows of a square once fog is on. The GM's own window
   draws the deck regardless; this is about what the table may see. */
export function fogStateAt(map, x, y) {
  const m = readMap(map);
  if (!m.fog) return 'open';
  return m.explored[cellKey(x, y)] ? 'open' : 'dark';
}

/* How many squares fit across a given number of screen pixels.

   PX PER SQUARE IS NOT THE THING TO CHANGE HERE. It is the projector's
   calibration — a square has to stay the size of the miniature bases
   standing on it — so filling a bigger screen means MORE SQUARES, not
   bigger ones. Scaling the squares to fit instead would silently decalibrate
   the table every time the window changed size. */
export const fitGrid = (availablePx, pxPerSquare) => {
  const px = Number(pxPerSquare) || EMPTY_MAP.pxPerSquare;
  const n = Math.floor((Number(availablePx) || 0) / px);
  return Math.max(MIN_GRID, Math.min(MAX_GRID, n));
};

/* --------------------------- revealing an area ---------------------------
   A deck is revealed a PLACE at a time, not a square at a time: the party
   steps into a hall and the hall is there, all of it.

   A DOOR IS A BOUNDARY, whatever state it is in. That is what makes the
   reveal behave the way a crawl should — a room lights up to its doorways
   and stops, and opening a door is what brings the next room in. If open
   doors let the flood through instead, the first one opened would cascade
   through every connected compartment on the deck and there would be no fog
   left to lift. The door's own square belongs to every region it touches,
   because you can see a door from either side of it. */

const isDoorAt = (m, x, y) => Boolean(m.doors[cellKey(x, y)]);

export function regionAt(map, pos) {
  const m = readMap(map);
  if (!pos) return [];
  const start = cellKey(pos.x, pos.y);
  if (!m.floor[start]) return [];
  // Clicking the door itself asks for what it joins, not for the doorway.
  if (m.doors[start]) return regionsAroundDoor(m, pos);

  const seen = new Set([start]);
  const out = [{ x: pos.x, y: pos.y }];
  const queue = [pos];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = cur.x + dx, y = cur.y + dy;
      const k = cellKey(x, y);
      if (seen.has(k) || !m.floor[k]) continue;
      seen.add(k);
      out.push({ x, y });
      // A doorway is shown but not walked through: the room stops there.
      if (!isDoorAt(m, x, y)) queue.push({ x, y });
    }
  }
  return out;
}

/* What a door joins: the door, and every region that touches it. Both sides,
   not just the far one — a DM opening a door from an unexplored
   corridor should not have to click twice to see where they are standing. */
export function regionsAroundDoor(map, pos) {
  const m = readMap(map);
  if (!pos || !m.floor[cellKey(pos.x, pos.y)]) return [];
  const out = [{ x: pos.x, y: pos.y }];
  const seen = new Set([cellKey(pos.x, pos.y)]);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const x = pos.x + dx, y = pos.y + dy;
    const k = cellKey(x, y);
    if (!m.floor[k] || isDoorAt(m, x, y)) continue;
    for (const c of regionAt(m, { x, y })) {
      const ck = cellKey(c.x, c.y);
      if (seen.has(ck)) continue;
      seen.add(ck);
      out.push(c);
    }
  }
  return out;
}

/* The explored set with that area added. Revealing is additive — a deck is
   uncovered, never covered back up by accident. */
export function revealArea(map, pos) {
  const m = readMap(map);
  const explored = { ...m.explored };
  for (const c of regionAt(m, pos)) explored[cellKey(c.x, c.y)] = true;
  return explored;
}

/* ----------------------- what is still in view -----------------------
   `explored` is everywhere the party has ever seen, and it is never taken
   away. What the map DRAWS is that set narrowed to what can still be reached
   from where they are standing, passing through doors only while those doors
   are open.

   So shutting a door takes the room beyond it off the board, and opening
   it again brings the room back exactly as it was. Doing this by deleting
   squares from `explored` would work once and then lose the deck: reopening
   the door would show a room nobody had ever been in. Derived, it is free
   and reversible.

   With no viewpoint set — a deck being built, or one revealed by hand —
   everything explored is drawn, because there is nobody to be cut off from. */

export function openReach(map, from) {
  const m = readMap(map);
  const out = new Set();
  if (!from) return out;
  const start = cellKey(from.x, from.y);
  if (!m.floor[start]) return out;
  out.add(start);
  const queue = [from];
  // The square they stand on may itself be a doorway; they can still see out
  // of it either way, so the walk starts regardless of that door's state.
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = cur.x + dx, y = cur.y + dy;
      const k = cellKey(x, y);
      if (out.has(k) || !m.floor[k]) continue;
      out.add(k);
      const d = m.doors[k];
      // A shut door is seen from the side you are on and goes no further.
      if (!d || d.state === 'open') queue.push({ x, y });
    }
  }
  return out;
}

export function visibleExplored(map) {
  const m = readMap(map);
  if (!m.viewpoint) return m.explored;
  const reach = openReach(m, m.viewpoint);
  const out = {};
  for (const k of Object.keys(m.explored)) if (reach.has(k)) out[k] = true;
  return out;
}

/* The mirror of revealArea, for a place the GM wants taken back by hand. */
export function concealArea(map, pos) {
  const m = readMap(map);
  const explored = { ...m.explored };
  for (const c of regionAt(m, pos)) delete explored[cellKey(c.x, c.y)];
  return explored;
}

/* ------------------------- the saved map library -------------------------
   A GM builds decks between sessions and plays them later, so a map is a
   thing you keep, not a thing you have. The library is the DM's own.

   Publishing is what turns a drawing into a game: fog goes ON, what was
   explored is wiped, and every contact goes back to hidden. A map pushed
   with last session's fog still lifted would hand the party the floorplan. */
export const readSavedMap = (x) => {
  const src = x && typeof x === 'object' ? x : null;
  return {
    id: (src && typeof src.id === 'string' && src.id) || newMapId(),
    name: String((src && src.name) || '').slice(0, 80),
    map: readMap(src && src.map)
  };
};
export const readMapLibrary = (list) =>
  (Array.isArray(list) ? list : []).map(readSavedMap);
export const packMapLibrary = (list) =>
  (Array.isArray(list) ? list : []).map(packSavedMap);

let mapSeq = 0;
const newMapId = () => 'bmap-' + Date.now().toString(36) + '-' + (mapSeq++).toString(36);

export const newBattleMap = (name = 'New map') => readSavedMap({ name, map: EMPTY_MAP });

/* --------------------------- building the deck --------------------------- */

/* The cells a stamp covers. Rotating by 90 or 270 swaps the footprint, which
   is the whole point of rotating a 1x5 corridor. Cells outside the map are
   dropped rather than clamped — clamping would fold a corridor back on itself
   into a stack of cells at the edge. */
export function stampCells(tile, pos, rotation = 0, map = EMPTY_MAP) {
  const t = typeof tile === 'string' ? tileById(tile) : tile;
  if (!t) return [];
  const turned = Math.abs(Math.round(Number(rotation) || 0) / 90) % 2 === 1;
  const w = turned ? t.h : t.w;
  const h = turned ? t.w : t.h;
  const x0 = Math.round(Number(pos && pos.x) || 0);
  const y0 = Math.round(Number(pos && pos.y) || 0);
  const out = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= 0 && x < map.cols && y >= 0 && y < map.rows) out.push({ x, y });
    }
  }
  return out;
}

/* The cells a brush covers, centred on the cursor. Size 1 is a single
   square, which is what every tool did before; a bigger brush is how you
   clear a hall without a hundred clicks.

   An odd size is centred on the cursor. An even one has no true centre, so
   the cursor is the block's top-left corner — a 2-brush at (5,5) covers
   (5,5)..(6,6), and you paint away from where you clicked. The alternative
   is a block whose centre shifts with the direction of the drag, which is
   worse than a fixed bias you can learn in one stroke. */
export function brushCells(pos, size, map) {
  const m = map || EMPTY_MAP;
  if (!pos) return [];
  const n = Math.max(1, Math.min(25, Math.round(Number(size) || 1)));
  const back = Math.floor((n - 1) / 2);
  const out = [];
  for (let dx = 0; dx < n; dx++) {
    for (let dy = 0; dy < n; dy++) {
      const x = Math.round(pos.x) - back + dx;
      const y = Math.round(pos.y) - back + dy;
      if (x >= 0 && y >= 0 && x < m.cols && y < m.rows) out.push({ x, y });
    }
  }
  return out;
}

/* Paint cells on or off. THE FLOOR IS THE ONLY RECORD OF THE DECK: a stamped
   tile writes its cells here and is then forgotten. Keeping a separate list
   of placed tiles alongside it would mean two sources of truth for the same
   squares, and the next stamp rebuilding the floor from that list would
   silently erase everything painted by hand. */
export function paintCells(floor, cells, on = true) {
  const next = { ...(floor || {}) };
  for (const c of cells || []) {
    const k = cellKey(c.x, c.y);
    if (on) next[k] = true; else delete next[k];
  }
  return keepClean(floor, next);
}

/* ---------------------------- expanding a deck ----------------------------

   Growing a deck used to mean typing a bigger number into Cols, which added
   bare grid: a 20x20 dungeon crawl became a 20x20 dungeon crawl with a
   lot of void east of it, and the GM painted the rest by hand.

   This repeats what is already built instead. The CURRENT GRID is the tile —
   not the floor's bounding box — so the repeat keeps whatever margin was
   designed around the deck, and the number of copies is just the new size
   over the old.

   MIRRORED AT THE SEAMS by default, which is the whole reason this is worth
   doing: butt two copies of a deck together and every corridor that ran to
   the east edge dies against the west wall of its neighbour. Flip the odd
   blocks and those corridors meet their own mouths, so the repeat reads as
   one larger complex rather than as a deck photocopied four times.

   WHAT DOES NOT REPEAT, and why:
   - contacts: a contact is one creature the DM hid. Copying it makes three
     more that they never placed and a sense sweep would ping.
   - explored: fog is a record of where the party has BEEN. Copying it reveals
     rooms nobody has walked into.
   Both are kept where they are and cropped to the new grid.

   Shrinking falls out of the same arithmetic — with a target smaller than the
   source, the modulo never wraps and the result is a plain crop. */
export function expandMap(map, cols, rows, { mirror = true } = {}) {
  const src = readMap(map);
  const w = int(cols, src.cols, MIN_GRID, MAX_GRID);
  const h = int(rows, src.rows, MIN_GRID, MAX_GRID);
  const sw = src.cols, sh = src.rows;

  const floor = {}, cover = {}, hazards = {}, doors = {}, markers = {}, ground = {}, obscuring = {};
  for (let x = 0; x < w; x++) {
    // Which copy this column falls in, and whether that copy is flipped.
    const lx = (mirror && Math.floor(x / sw) % 2) ? sw - 1 - (x % sw) : x % sw;
    for (let y = 0; y < h; y++) {
      const ly = (mirror && Math.floor(y / sh) % 2) ? sh - 1 - (y % sh) : y % sh;
      const from = cellKey(lx, ly);
      const to = cellKey(x, y);
      // Each layer is copied on its own rather than gated on the floor: a
      // marker may legitimately sit off the deck, and gating would drop it.
      if (src.floor[from]) floor[to] = true;
      if (src.cover[from]) cover[to] = src.cover[from];
      if (src.hazards[from]) hazards[to] = src.hazards[from];
      if (src.doors[from]) doors[to] = { ...src.doors[from] };
      if (src.markers[from]) markers[to] = { ...src.markers[from] };
      // The terrain repeats with the deck it is painted on, or an expanded
      // ice shelf would come back as deck plate.
      if (src.ground[from]) ground[to] = src.ground[from];
      // Foliage and smoke belong to the terrain, and repeat with it.
      if (src.obscuring[from]) obscuring[to] = src.obscuring[from];
    }
  }

  const inside = (k) => {
    const p = parseKey(k);
    return Boolean(p) && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  };
  const explored = {};
  for (const k of Object.keys(src.explored)) if (inside(k)) explored[k] = true;
  const contacts = {};
  for (const [k, v] of Object.entries(src.contacts)) if (inside(k)) contacts[k] = v;
  const viewpoint = src.viewpoint && inside(cellKey(src.viewpoint.x, src.viewpoint.y))
    ? src.viewpoint : null;

  return {
    ...src,
    cols: w, rows: h,
    floor, cover, hazards, doors, markers, ground, obscuring,
    explored, contacts, viewpoint
  };
}

/* The layers a GM paints (deck, terrain, cover, hazards, foliage, doors,
   markers, contacts) — the "created map", as opposed to the grid it sits in. */
const PAINT_LAYERS = ['floor', 'ground', 'cover', 'hazards', 'obscuring', 'doors', 'markers', 'contacts'];

/* The smallest box holding everything painted, or null for an empty deck. */
export function paintBounds(map) {
  const m = readMap(map);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layer of PAINT_LAYERS) {
    for (const k of Object.keys(m[layer] || {})) {
      const p = parseKey(k);
      if (!p) continue;
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/* Turns what has been painted a quarter turn at a time, clockwise for a
   positive count and anticlockwise for a negative one, and leaves the grid
   alone. The map's columns, rows, scale and texture are the container; deck,
   terrain, doors, cover, hazards, foliage, markers, fog and contacts are the
   content, and they turn together about the middle of the painted area, so a
   corridor laid east-west can be stood north-south without rebuilding it.
   Walls are derived from the floor, so they come out right on their own.

   A turn that would push the painted area past the edge of the grid (a
   corridor 30 wide cannot stand up in 20 rows) is not made: the map comes
   back unchanged, and rotationFits says so beforehand. */
export function rotateMap(map, turns = 1) {
  const src = readMap(map);
  const t = quarterCount(turns);
  if (t === 0) return src;
  return turnContent(src, t) || src;
}

export function rotationFits(map, turns = 1) {
  const src = readMap(map);
  const t = quarterCount(turns);
  return t === 0 || turnContent(src, t) !== null;
}

const quarterCount = (turns) => (((Math.round(Number(turns)) || 0) % 4) + 4) % 4;

// Rounds halves away from zero, so a turn and its reverse shift the box by
// exactly opposite amounts and four turns bring the deck back to where it was.
const roundHalf = (v) => Math.sign(v) * Math.floor(Math.abs(v) + 0.5);

// t is 1 (clockwise), 2 (half turn) or 3 (anticlockwise). Null if the turned
// content would not fit the grid.
function turnContent(m, t) {
  const b = paintBounds(m);
  if (!b) return m;
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  const nw = t === 2 ? w : h, nh = t === 2 ? h : w;
  if (nw > m.cols || nh > m.rows) return null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nx0 = clamp(b.x0 + roundHalf((w - nw) / 2), 0, m.cols - nw);
  const ny0 = clamp(b.y0 + roundHalf((h - nh) / 2), 0, m.rows - nh);
  const at = (x, y) => {
    const rx = x - b.x0, ry = y - b.y0;
    const q = t === 1 ? { x: h - 1 - ry, y: rx }
      : t === 3 ? { x: ry, y: w - 1 - rx }
        : { x: w - 1 - rx, y: h - 1 - ry };
    return { x: nx0 + q.x, y: ny0 + q.y };
  };
  const inGrid = (p) => p.x >= 0 && p.y >= 0 && p.x < m.cols && p.y < m.rows;
  const move = (layer, copy = (v) => v) => {
    const out = {};
    for (const [k, v] of Object.entries(layer || {})) {
      const p = parseKey(k);
      if (!p) continue;
      const q = at(p.x, p.y);
      if (inGrid(q)) out[cellKey(q.x, q.y)] = copy(v);
    }
    return out;
  };
  const vp = m.viewpoint ? at(m.viewpoint.x, m.viewpoint.y) : null;
  return {
    ...m,
    floor: move(m.floor),
    /* Cover turns WITH the deck. A barrier laid across a corridor has to stay
       across it after the deck is turned a quarter, and it is the only thing
       on the map that both has a direction and is stored per square — the
       walls are derived from the floor, and the props that have no front do
       not care. Without this, turning a deck left every railing on it facing
       the way it faced before, at right angles to the corridor it was drawn
       along. */
    cover: move(m.cover, (v) => {
      const c = readCover(v);
      return c ? writeCover(c.id, c.turn + t) : v;
    }),
    hazards: move(m.hazards),
    obscuring: move(m.obscuring), ground: move(m.ground), explored: move(m.explored),
    doors: move(m.doors, (d) => ({ ...d })),
    markers: move(m.markers, (v) => ({ ...v })),
    contacts: move(m.contacts, (c) => ({ ...c })),
    viewpoint: vp && inGrid(vp) ? vp : null
  };
}

/* What expanding to this size would do, for the button to say so before it is
   pressed. A GM about to turn one deck into nine should be told that. */
export function expandPlan(map, cols, rows) {
  const src = readMap(map);
  const w = int(cols, src.cols, MIN_GRID, MAX_GRID);
  const h = int(rows, src.rows, MIN_GRID, MAX_GRID);
  const across = Math.ceil(w / src.cols);
  const down = Math.ceil(h / src.rows);
  const copies = across * down;
  return {
    cols: w, rows: h, across, down, copies,
    // A partial copy is the normal case — 50 wide off a 30-wide deck is one
    // whole copy and two thirds of another — and it is worth saying, because
    // it is the one that cuts a room in half.
    partial: w % src.cols !== 0 || h % src.rows !== 0,
    shrinking: w < src.cols || h < src.rows
  };
}

/* --------------------------- walls, derived --------------------------- */

export const WALL_N = 1, WALL_E = 2, WALL_S = 4, WALL_W = 8;

/* Which sides of a floor cell face the void. Walls are never stored — a
   stored wall drifts out of step with the floor the moment a cell is erased,
   and then the map shows a wall edging nothing. A void cell has no walls
   of its own; the wall belongs to the floor beside it. */
export function wallMask(floor, x, y) {
  if (!isFloor(floor, x, y)) return 0;
  return (isFloor(floor, x, y - 1) ? 0 : WALL_N)
    | (isFloor(floor, x + 1, y) ? 0 : WALL_E)
    | (isFloor(floor, x, y + 1) ? 0 : WALL_S)
    | (isFloor(floor, x - 1, y) ? 0 : WALL_W);
}

/* A corner pillar sits where two walls meet, and also where the diagonal
   alone is void — the inner corner of an L-shaped room, which a four-sided
   mask cannot see. dx/dy pick the corner (-1/-1 is north-west). */
export function cornerPillar(floor, x, y, dx, dy) {
  if (!isFloor(floor, x, y)) return false;
  return !isFloor(floor, x + dx, y)
    || !isFloor(floor, x, y + dy)
    || !isFloor(floor, x + dx, y + dy);
}

/* The painted extent of the deck, for centring and for export. Null when
   nothing is painted — an empty map has no bounds, and returning 0,0,0,0
   would centre the view on a corner. */
export function floorBounds(floor) {
  const keys = Object.keys(floor || {});
  if (!keys.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    const p = parseKey(k);
    if (!p) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
}

/* ------------------------------ distance ------------------------------ */

// Straight-line, not squares-walked. The PHB's true-distance variant: counting
// a diagonal as one square (the Chebyshev shortcut most VTTs use) would make a
// diagonal shot 40% shorter than the same shot along a wall, and a 20-foot
// sphere an oddly square thing.
export const distanceSquares = (a, b) =>
  Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));

export const distanceFeet = (a, b, feetPerSquare = FEET_PER_SQUARE) =>
  Math.round(distanceSquares(a, b) * (Number(feetPerSquare) || FEET_PER_SQUARE));

/* Does the shot have a lane? Walks the cells between the two points and
   reports the first thing in the way: a closed or jammed door, or void where
   there is no floor at all.

   This is a straight line between cell centres, NOT true line of sight — it
   has no notion of cover, corner cases or firing around a doorframe, and the
   GM overrules it freely. It answers one question honestly: is there a wall
   or a shut door between these two. */
export function lineBlocked(map, from, to) {
  return walkLine(readMap(map), from, to);
}

/* A sentence for what stopped a lane, for the ruler and the overlays. */
export function blockedText(b) {
  if (!b) return '';
  if (b.reason === 'door') return `a ${b.state} door`;
  if (b.reason === 'obscured') return 'foliage or fog';
  if (b.reason === 'cover') return 'a pillar or statue';
  return 'a wall';
}

/* The same walk, on a map that has ALREADY been read. visibleCells asks this
   once per square on the board, and readMap rebuilds the whole floor, door
   and marker set each time it is called — re-reading inside the loop made a
   single redraw rebuild the map several hundred times and stalled the tab. */
function walkLine(m, from, to, { sight = true } = {}) {
  if (!from || !to) return null;
  const steps = Math.ceil(distanceSquares(from, to) * 2);
  if (steps === 0) return null;
  // Whether a deck has been painted at all is a property of the MAP, not of
  // the step: asking Object.keys(floor).length inside the loop walked every
  // key in the map on every square of every line, which on a large deck is
  // billions of operations for one redraw and freezes the tab.
  const built = !isEmpty(m.floor);
  // Sight carried into foliage or fog so far, in feet, and the shortest
  // reach of any density crossed on the way (a thin screen then a thick one
  // is stopped by the thick one's limit). Templates — a blast, a flame cone
  // — pass `sight: false`: a Fireball is not stopped by fog.
  const hasObscuring = sight && !isEmpty(m.obscuring);
  const feetPerStep = (distanceSquares(from, to) / steps) * (m.feetPerSquare || FEET_PER_SQUARE);
  let through = 0;
  let limit = Infinity;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * t);
    const y = Math.round(from.y + (to.y - from.y) * t);
    const isTarget = x === to.x && y === to.y;
    const k = cellKey(x, y);
    if (hasObscuring && !(x === from.x && y === from.y)) {
      // The target's own square counts: something crouched in the reeds is
      // hidden by them. The firer's own square does not.
      const o = obscuringById(m.obscuring[k]);
      if (o) {
        through += feetPerStep;
        limit = Math.min(limit, o.blocksAfterFt);
        if (through > limit) return { x, y, reason: 'obscured', density: o.id };
      }
    }
    if (isTarget) break;                       // the target's own square is not cover
    if (x === from.x && y === from.y) continue;
    const door = m.doors[k];
    if (door && doorBlocks(door.state)) {
      return { x, y, reason: 'door', state: door.state, kind: door.kind };
    }
    // Cover that stands head-high stops the lane; a low wall does not, which
    // is the whole point of keeping the two apart.
    const cov = coverAt(m.cover[k]);
    if (cov && cov.blocksSight) return { x, y, reason: 'cover', cover: cov.id };
    // Void only blocks on a map that has a deck painted at all; an unbuilt
    // map is open ground, not a solid block of rock.
    if (built && !m.floor[k]) return { x, y, reason: 'void' };
  }
  return null;
}

/* What the shot is worth: the distance, the band it falls in, what that band
   does to the attack, and anything in the way. `ov` is rules.js overlayOf().

   A melee weapon has no range figure, so its normal range IS its reach, and a
   thrown one is 'normal' within reach and then by its own bands. A spell has
   one number and no long band. Out of range is no attack at all. */
export function reachBetween({ from, to, map, ov = null } = {}) {
  if (!from || !to) return null;
  const m = map ? readMap(map) : EMPTY_MAP;
  const squares = distanceSquares(from, to);
  const feet = distanceFeet(from, to, m.feetPerSquare);
  let band = 'normal';
  if (ov) {
    band = ov.range === null
      ? rangeBand(feet, ov.reach)
      : (!ov.isSpell && feet <= ov.reach ? 'normal' : rangeBand(feet, ov.range, ov.longRange));
  }
  return {
    squares: Math.round(squares * 10) / 10,
    feet,
    band,
    // null for a normal shot: an effect of "no change" would read as a note.
    effect: RANGE_EFFECT[band],
    blocked: map ? walkLine(m, from, to) : null,
    // What the target is crouched behind, if anything.
    cover: map ? coverBetween(m, from, to) : null
  };
}

/* ============================ OVERLAYS ============================
   What the projector casts over the models: range bands, burst radii, cones,
   auras and what can actually be seen from a square. These are the reason the
   map is worth projecting at all — a template that would otherwise be a
   cardboard cut-out laid on the table and argued over.

   Every one of them returns plain geometry in grid squares. None of them knows
   or cares which model is standing where; the DM lines the overlay up on the
   table and reads off who is caught in it. */

/* The band boundaries for a weapon or spell, as radii in squares, outermost
   first so they paint back-to-front without the near bands being buried.

   A ranged weapon gets normal and long; a spell gets its reach; a melee weapon
   gets its reach. A thrown weapon gets all three, with reach inside. */
export function rangeRings(ov, map) {
  const m = readMap(map);
  if (!ov) return [];
  const toSquares = (ft) => ft / (m.feetPerSquare || FEET_PER_SQUARE);
  const rings = [];
  if (ov.longRange) rings.push({ band: 'long', feet: ov.longRange });
  if (ov.range) rings.push({ band: 'normal', feet: ov.range });
  // Reach is its own ring for a weapon, and for a spell only when touch is all
  // there is: a 120-foot spell has no use for a 5-foot circle drawn inside it.
  if (!ov.isSpell && (ov.range === null || ov.reach < ov.range)) rings.push({ band: 'reach', feet: ov.reach });
  return rings
    .map((x) => ({ ...x, effect: RANGE_EFFECT[x.band === 'reach' ? 'normal' : x.band], radius: toSquares(x.feet) }))
    .filter((x) => x.radius > 0)
    .sort((a, b) => b.radius - a.radius);
}

/* Every square within a radius in feet of a centre — a Fireball's burst or a
   Spirit Guardians aura. A square counts as caught if its CENTRE is inside the
   radius, which is the same measurement the DM would make with a tape and
   keeps the shape symmetrical. */
export function areaCells(map, centre, radiusFt) {
  const m = readMap(map);
  if (!centre) return [];
  const perSquare = m.feetPerSquare || FEET_PER_SQUARE;
  const radius = (Number(radiusFt) || 0) / perSquare;
  if (radius <= 0) return [];
  const out = [];
  const lo = Math.floor(-radius), hi = Math.ceil(radius);
  for (let dx = lo; dx <= hi; dx++) {
    for (let dy = lo; dy <= hi; dy++) {
      const x = centre.x + dx, y = centre.y + dy;
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
      if (Math.hypot(dx, dy) <= radius) out.push({ x, y });
    }
  }
  return out;
}

/* A cone: everything within its length, in a wedge pointing at the target. A
   5e cone is as wide at its far end as it is long, which is about 26.6 degrees
   either side of the aim, so that is the default; it stays a knob for a table
   that plays the cone narrower. The origin square is always included: you are
   standing in your own fire. */
export function coneCells(map, origin, towards, lengthFt, halfAngleDeg = CONE_HALF_ANGLE_DEG) {
  const m = readMap(map);
  if (!origin || !towards) return [];
  const perSquare = m.feetPerSquare || FEET_PER_SQUARE;
  const reach = (Number(lengthFt) || 0) / perSquare;
  if (reach <= 0) return [];
  const aim = Math.atan2(towards.y - origin.y, towards.x - origin.x);
  if (!Number.isFinite(aim)) return [];
  const half = (Math.abs(Number(halfAngleDeg)) || 30) * Math.PI / 180;
  const out = [];
  const span = Math.ceil(reach);
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      const x = origin.x + dx, y = origin.y + dy;
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
      if (dx === 0 && dy === 0) { out.push({ x, y }); continue; }
      // Measured ALONG the aim, not out from the origin: a 5e cone ends in a
      // flat edge as wide as the cone is long, so a rounded end would clip the
      // two far corners off every cone.
      if (dx * Math.cos(aim) + dy * Math.sin(aim) > reach) continue;
      // The smallest angle between the aim and this square, wrapped so a
      // cone pointing west does not split at the +/-pi seam and lose half of
      // itself.
      let delta = Math.atan2(dy, dx) - aim;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      if (Math.abs(delta) <= half) out.push({ x, y });
    }
  }
  return out;
}

/* A cube: a square block `sizeFt` on a side. Thrown at a target it is centred
   on that square; from the caster it is the block that starts at the caster's
   edge and runs the way they are facing, along whichever axis the aim leans
   toward — a cube has no diagonal, which is what makes it a cube. */
export function cubeCells(map, anchor, towards, sizeFt, fromSelf = false) {
  const m = readMap(map);
  if (!anchor) return [];
  const side = Math.max(1, Math.round((Number(sizeFt) || 0) / (m.feetPerSquare || FEET_PER_SQUARE)));
  let x0, y0;
  if (fromSelf && towards) {
    const dx = towards.x - anchor.x, dy = towards.y - anchor.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
    // The face of the cube sits against the caster: its far edge is `side`
    // squares out, and it is centred across the other axis.
    const across = -Math.floor((side - 1) / 2);
    x0 = horizontal ? (sx > 0 ? anchor.x + 1 : anchor.x - side) : anchor.x + across;
    y0 = horizontal ? anchor.y + across : (sy > 0 ? anchor.y + 1 : anchor.y - side);
  } else {
    x0 = anchor.x - Math.floor((side - 1) / 2);
    y0 = anchor.y - Math.floor((side - 1) / 2);
  }
  const out = [];
  for (let x = x0; x < x0 + side; x++) {
    for (let y = y0; y < y0 + side; y++) {
      if (x >= 0 && y >= 0 && x < m.cols && y < m.rows) out.push({ x, y });
    }
  }
  return out;
}

/* A line: `lengthFt` long and `widthFt` wide, out from the caster toward the
   aim. A square is caught if its centre is within half the width of the
   line's axis, and never less than the middle of a square, or a five-foot
   bolt would catch nothing off the diagonal. The origin square is included. */
export function lineCells(map, origin, towards, lengthFt, widthFt = FEET_PER_SQUARE) {
  const m = readMap(map);
  if (!origin || !towards) return [];
  const perSquare = m.feetPerSquare || FEET_PER_SQUARE;
  const length = (Number(lengthFt) || 0) / perSquare;
  if (length <= 0) return [];
  const half = Math.max(0.5, (Number(widthFt) || FEET_PER_SQUARE) / perSquare / 2);
  const ax = towards.x - origin.x, ay = towards.y - origin.y;
  const norm = Math.hypot(ax, ay);
  if (!norm) return [{ x: origin.x, y: origin.y }];
  const ux = ax / norm, uy = ay / norm;
  const out = [];
  const span = Math.ceil(length + half);
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      const x = origin.x + dx, y = origin.y + dy;
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
      const along = dx * ux + dy * uy;
      const across = Math.abs(-dx * uy + dy * ux);
      if (along >= -0.5 && along <= length + 0.5 && across <= half) out.push({ x, y });
    }
  }
  return out;
}

/* The squares a spell's area catches, whatever its shape. A self area is
   anchored on the caster and a ranged one on the target, and a template is
   trimmed to what it can reach — fire does not cross a shut door, and a
   Fireball "spreads around corners" only by going round them, which a straight
   line from the burst centre will not do (so the DM overrules it freely).
   Returns [] for a weapon or a spell with no area. */
export function areaFor(map, ov, origin, target) {
  if (!ov || !ov.area || !origin) return [];
  const { shape, size, width } = ov.area;
  const at = ov.self ? origin : target;
  if (!at) return [];
  const toward = target || origin;
  let cells;
  if (shape === 'sphere') cells = areaCells(map, at, size);
  else if (shape === 'cone') cells = coneCells(map, origin, toward, size);
  else if (shape === 'cube') cells = cubeCells(map, at, toward, size, ov.self);
  else if (shape === 'line') cells = lineCells(map, origin, toward, size, width);
  else return [];
  return onDeck(map, unobstructed(map, ov.self ? origin : at, cells));
}

/* Trims a template to what it can actually reach. Fire does not cross a
   shut door and a Fireball does not blast through a wall, so a cone or a
   burst radius is filtered against the same lineBlocked() the measuring
   tape uses. The centre is always kept — a template is always on its own
   square, and dropping it would leave the thrower standing in a hole in
   their own Fireball. */
export function unobstructed(map, centre, cells) {
  const m = readMap(map);
  if (!centre) return [];
  return (cells || []).filter((c) =>
    (c.x === centre.x && c.y === centre.y) || !walkLine(m, centre, c, { sight: false }));
}

/* The cover a shot has to cross, as a 5e degree. Sight-blocking cover never
   reaches here — a pillar stops the lane outright, which is total cover — so
   this reports the low stuff a target crouches behind, including cover on the
   target's own square, which is where most of it is. The best degree wins;
   cover does not stack. Returns { ...coverType, ac } where ac is the bonus to
   AC and Dexterity saves. */
export function coverBetween(map, from, to) {
  const m = readMap(map);
  if (!from || !to) return null;
  const steps = Math.ceil(distanceSquares(from, to) * 2);
  let best = null;
  const consider = (x, y) => {
    const c = coverAt(m.cover[cellKey(x, y)]);
    const d = c && coverDegree(c.degree);
    if (d && (!best || d.ac > best.ac)) best = { ...c, ac: d.ac, degreeName: d.name };
  };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * t);
    const y = Math.round(from.y + (to.y - from.y) * t);
    consider(x, y);
  }
  consider(to.x, to.y);
  return best;
}

/* Keeps a template on the deck. A blast or a field spilling into the void
   beside a corridor is drawn over squares that are not part of the map at
   all, which on a projector reads as the template covering a wall. On an
   unpainted map there is no deck to stay on, so everything passes. */
export function onDeck(map, cells) {
  const m = readMap(map);
  if (isEmpty(m.floor)) return cells || [];
  return (cells || []).filter((c) => m.floor[cellKey(c.x, c.y)]);
}

/* What can be seen from a square: every cell within a radius that has an
   unblocked lane to the origin. Uses the same lineBlocked() the measuring
   tape does, so the overlay and the ruler can never disagree about whether a
   door is in the way.

   Still a straight line between centres, not true line of sight — no cover,
   no corner cases. It answers "is there a wall between these two", which is
   the question that actually comes up at the table. */
/* How far a sight check reaches when nothing says otherwise. A deck can be
   500 squares across now, and asking "what can be seen from here" of every
   square on it is a quarter of a million lines walked. Eighty squares is far
   past anything a line of sight is used for at the table (a long gallery, a
   firing lane) and keeps the answer to a fraction of a second. */
export const LOS_MAX_SQUARES = 80;

export function visibleCells(map, origin, radiusFt = null) {
  const m = readMap(map);
  if (!origin) return [];
  const perSquare = m.feetPerSquare || FEET_PER_SQUARE;
  const asked = radiusFt === null ? Infinity : (Number(radiusFt) || 0) / perSquare;
  if (asked <= 0) return [];
  const limit = Math.min(asked, LOS_MAX_SQUARES);
  // Only the box the circle fits in, not the whole grid.
  const x0 = Math.max(0, Math.floor(origin.x - limit)), x1 = Math.min(m.cols - 1, Math.ceil(origin.x + limit));
  const y0 = Math.max(0, Math.floor(origin.y - limit)), y1 = Math.min(m.rows - 1, Math.ceil(origin.y + limit));
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (Math.hypot(x - origin.x, y - origin.y) > limit) continue;
      if (!walkLine(m, origin, { x, y })) out.push({ x, y });
    }
  }
  return out;
}

/* Start zones are drawn, not occupied: a shaded band at each end of the map
   telling the players where to set their models down. The map never knows which
   model is where — that is what the models are for. */
export function deploymentRows(map, depth = 1) {
  const m = readMap(map);
  const d = Math.max(1, Math.min(Math.floor(m.rows / 2), Math.round(depth)));
  return {
    monsters: { y0: 0, y1: d - 1 },
    party: { y0: m.rows - d, y1: m.rows - 1 }
  };
}
