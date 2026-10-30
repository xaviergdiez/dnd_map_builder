/* ---------------------------------------------------------------------------
   SPRITE SHEETS: sixteen tokens on one square image.

   Every environment ships as ONE 4x4 sheet rather than sixteen files, because
   that is how they are made: a single image generation lays all sixteen out
   together, so the crates and the door and the pillar share a palette, a light
   direction and a degree of wear. Generated one at a time they drift, and a
   deck dressed with drifted props looks like a collage.

   The same reason applies at the other end, which is why this module exists at
   all: a sheet the GM generates during a session has to be cut up in the
   browser, and the nine that ship with the app are cut up by a tool on a
   desktop (tools/slice-sprites.mjs). Two callers, one set of rules — the grid,
   the slot order, and how the black goes away.

   ---- the black ----
   The art is generated on a pitch-black background with no frame, which makes
   every sheet a PREMULTIPLIED image: a wisp of smoke at 30% is not grey smoke,
   it is the smoke's own colour already faded toward black. So the alpha is
   recovered from brightness and the colour is divided back out, rather than
   the brightness merely being thresholded. Threshold alone leaves every token
   ringed in the dark fringe where it met the background — which on a dark deck
   reads as a drop shadow nobody asked for, and on pale ice reads as dirt. */

export const SHEET_COLS = 4;
export const SHEET_ROWS = 4;
export const SHEET_CELLS = SHEET_COLS * SHEET_ROWS;

/* Where the background ends and the art begins, as a max-of-RGB.

   Below LO is background and goes fully transparent; above HI is art and is
   left alone; between the two the pixel is part background, which is what an
   edge IS.

   LO is not 1. The sheets measure 0-6 in their corners, but several carry
   faint grid lines around 21 where the generator remembered it was drawing for
   a battle map, and at a threshold of 18 those survive at about 9% opacity —
   invisible on a dark deck, a ghostly box ruled across pale ice. Sitting the
   floor above them costs the outermost wisp of the smoke and gas cells, which
   was at a tenth of an opacity nobody can see anyway. */
export const BLACK_LO = 24;
/* HI is low, and deliberately. It started at 52 on the reasoning that a wider
   band gives a softer edge, and a wider band is exactly what made a dark
   set see-through: this art is DARK, so an iron-banded door's own recessed
   panels sit in the 24-52 range and came out part-transparent with the floor
   showing through them. Narrowed to 34 and checked against the art
   rather than reasoned about — the doors, hatches, machinery and crates all
   read solid at 34, the smoke and gas clouds are still soft, and nothing
   gained the dark outline a hard cut would have given it. */
export const BLACK_HI = 34;

/* ---- the slots ----
   Fixed, and the same on all nine sheets, because the prompt that makes a
   sheet asks for them in this order. Read row by row: four doors and barriers,
   four solid props, four atmospherics, four pieces of ground clutter.

   `role` is this module's name for the cell. What the APP calls it is a
   separate question answered by spriteRole() below, because one role can serve
   several of the app's elements (a closed door and a jammed one are the same
   picture) and some of the app's elements have no picture at all.

   `turn` says whether the picture may be drawn at a quarter turn to break up
   a run of them. Sixteen crates in a hold all facing the same way read as one
   stamp repeated, which is the thing that makes tile art look like tile art.
   A door may not turn — it is a way through a wall and it faces the way the
   wall does — and neither may a barrier, which has a side you crouch on. A
   pile of crates, a fire and a bank of smoke have no front. */
export const SPRITE_SLOTS = [
  { slot: 0, role: 'door_closed', name: 'Door, closed', turn: false },
  { slot: 1, role: 'door_open', name: 'Doorway, open', turn: false },
  { slot: 2, role: 'trapdoor', name: 'Trapdoor', turn: false },
  { slot: 3, role: 'barrier', name: 'Low wall or fence', turn: false },
  { slot: 4, role: 'barrels', name: 'Barrels and crates', turn: true },
  { slot: 5, role: 'furniture', name: 'Furniture or rubble', turn: true },
  { slot: 6, role: 'pillar', name: 'Pillar or statue', turn: true },
  { slot: 7, role: 'fire', name: 'Fire', turn: true },
  { slot: 8, role: 'gas', name: 'Poison gas', turn: true },
  { slot: 9, role: 'arcane', name: 'Magic glyph', turn: true },
  { slot: 10, role: 'smoke', name: 'Fog or smoke', turn: true },
  { slot: 11, role: 'scrub', name: 'Light foliage', turn: true },
  { slot: 12, role: 'thicket', name: 'Dense foliage', turn: true },
  { slot: 13, role: 'tangle', name: 'Vines or webs', turn: true },
  { slot: 14, role: 'grate', name: 'Floor grate or drain', turn: false },
  { slot: 15, role: 'wall_low', name: 'Low broken wall', turn: false }
];

/* How far to turn the picture on this square: 0, 1, 2 or 3 quarter turns.
   Derived from the square so a deck draws the same way every time it opens —
   a prop that span to a new angle on every redraw would be unusable. */
export function spriteTurn(role, at) {
  const hit = SPRITE_SLOTS.find((s) => s.role === role);
  if (!hit || !hit.turn || !at) return 0;
  const x = Math.round(Number(at.x));
  const y = Math.round(Number(at.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  // Two coprime multipliers, so neighbours in a row and neighbours in a
  // column both get different angles rather than the grid banding into
  // diagonal stripes of one angle.
  return (((x * 3 + y * 7) % 4) + 4) % 4;
}

export const SPRITE_ROLES = SPRITE_SLOTS.map((s) => s.role);
export const slotOfRole = (role) => {
  const hit = SPRITE_SLOTS.find((s) => s.role === role);
  return hit ? hit.slot : -1;
};

/* Which sheet belongs to which ground. The sheets are named for the place and
   the themes for the fiction, so the two lists have to be married somewhere;
   here, once, rather than by a filename convention that would break the first
   time a theme was renamed.

   Empty until art arrives: the built-in grounds draw their props with the flat
   shapes and stripes a square always falls back to, and a ground the DM
   generates carries its own sheet. Drop a sheet in art/sprites, add the line
   here and run tools/slice-sprites.mjs. */
export const SHEET_FOR_THEME = {
  catacombs: 'crypt', cavern: 'cavern', cobbles: 'cobblestones', desert: 'desert',
  dungeon: 'dungeon', forest: 'forest', swamp: 'swamp', tavern: 'tavern',
  tundra: 'tundra', volcanic: 'embers'
};

/* ---- which picture an element gets ----

   Returns a role, or null to mean "draw it the way it was drawn before". Null
   is not a failure: Acid, Lava and Pit have no token on the sheets,
   and a flat wash with a label is a perfectly good way to show a square that
   is dangerous rather than occupied. Anything that returns a role still falls
   back to the flat drawing when that sheet has not loaded, so the map never
   waits on an image.

   `at` is the square's own coordinate and only decides between two pictures of
   the same thing — the sheets carry a fence AND a low wall, and alternating
   them by position keeps a long barrier from looking stamped. Position rather
   than random so the same deck draws the same way every time it opens. */
export function spriteRole(kind, id, state = null, at = null) {
  if (kind === 'door') {
    if (id === 'trapdoor') return 'trapdoor';
    return state === 'open' ? 'door_open' : 'door_closed';
  }
  if (kind === 'cover') {
    if (id === 'barrels') return 'barrels';
    if (id === 'furniture') return 'furniture';
    if (id === 'pillar') return 'pillar';
    /* ONE picture for every barrier, so a run of them is one barrier.

       The sheets carry two low-cover pictures — a railing and a low wall —
       and this used to alternate between them by position, on the reasoning
       that repeating one picture looks stamped. That reasoning is wrong for
       this prop in particular: a barrier is laid square by square to make a
       LINE, and alternating two different barriers along it reads as a
       railing that changes into a wall and back. Cohesion beats variety for
       the one prop whose whole purpose is to join up with itself.

       That leaves wall_low cut and shipped but unasked for, like the smoke
       cell: it wants to be a cover type of its own, with its own Armour
       Points, rather than a second skin for this one. */
    if (id === 'low') return 'barrier';
    return null;
  }
  if (kind === 'hazard') {
    if (id === 'fire') return 'fire';
    if (id === 'poison') return 'gas';
    if (id === 'arcane') return 'arcane';
    // Acid, lava and pits: no token, and inventing one would lie about what
    // the square is. The grate is a drain in the floor, not a pit.
    return null;
  }
  /* Obscuring terrain is stored as a density — light, medium, heavy — and the
     sheets carry four pictures that could serve it: three kinds of greenery
     and a bank of smoke. Density picks the greenery, because that is the axis
     the map actually records. The smoke cell is cut and shipped but nothing
     asks for it yet: choosing smoke over foliage for a square would mean
     storing that choice, and the map format is not being changed for a
     picture. */
  if (kind === 'obscure') {
    if (id === 'light') return 'scrub';
    if (id === 'medium') return 'tangle';
    if (id === 'heavy') return 'thicket';
    return null;
  }
  return null;
}

/* ---- the grid ----
   Where a cell sits on a sheet of any size. The shipped sheets are 2048 and a
   generated one may be 1024, so nothing here may assume 512px cells; the only
   fixed thing is that there are four of them across. A sheet whose sides are
   not divisible by four loses the odd pixel at the far edge rather than
   smearing a seam of the next cell into this one. */
export function cellRect(index, sheetW, sheetH = sheetW) {
  const i = Math.max(0, Math.min(SHEET_CELLS - 1, Math.round(Number(index) || 0)));
  const w = Math.floor(Number(sheetW) / SHEET_COLS);
  const h = Math.floor(Number(sheetH) / SHEET_ROWS);
  return { x: (i % SHEET_COLS) * w, y: Math.floor(i / SHEET_COLS) * h, w, h };
}

/* ---- the black into alpha ----

   Works on a plain RGBA array — a canvas ImageData's `data` in the browser, a
   sharp raw buffer in the tool — in place, because these are megabytes and
   copying them twice to be tidy is not tidy.

   Alpha comes from the brightest channel, not from a luminance weighting: a
   pure blue warp glow and a pure yellow arc are both fully present art, and
   weighting the channels the way the eye does would call the blue one
   half-transparent for being blue.

   WHY THE BAND NEEDS TO KNOW WHERE IT IS.

   Brightness alone cannot tell dark ART from half-transparent BACKGROUND, and
   a dark dungeon set is mostly dark art. Judged on brightness alone, two thirds
   of an iron-banded door's own panels came out see-through, and the floor
   showed straight through the door — measured, not guessed. The pale snow
   tokens were fine at 12%, which is exactly why it looked like a theme problem.

   So the band is resolved by CONNECTIVITY. The background is the dark region
   that reaches the edge of the cell; a dark pixel walled in by art is art, and
   stays solid. Only a pixel that something could reach from outside is faded,
   which is what an edge is.

   Pure black is still cleared wherever it is found, connected or not. That is
   what keeps an open doorway open, and the gaps between a railing's balusters
   and a grating's bars clear: those are holes, and a hole is rendered as true
   #000 while a shadow inside a door is merely dark. */
export function keyBlack(rgba, { lo = BLACK_LO, hi = BLACK_HI, w = 0, h = 0 } = {}) {
  const span = Math.max(1, hi - lo);
  const n = rgba.length / 4;
  /* No dimensions given means a strip of pixels with no inside — every one of
     them is on the edge, so every one is reachable, which is the old
     brightness-only behaviour. That is what the pixel-level checks want and
     it is the right reading of "I did not tell you the shape". */
  const width = w > 0 && h > 0 && w * h === n ? w : n;
  const height = width === n ? 1 : h;

  // Which pixels the background can reach, walking only through pixels dark
  // enough to be background or its edge. A stack rather than recursion: a
  // 512-square cell of near-black would blow the call stack.
  const open = new Uint8Array(n);
  const stack = [];
  const maxAt = (p) => {
    const i = p * 4;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    return r > g ? (r > b ? r : b) : (g > b ? g : b);
  };
  const push = (p) => { if (!open[p] && maxAt(p) < hi) { open[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width, y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const m = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (m <= lo) {
      /* True black, wherever it sits: the background, and the holes in the
         art — an open doorway, the gaps in a railing, the slots of a grate.

         Zero the colour as well. An invisible pixel's colour still shows up
         once anything scales the image: the filter mixes it with its visible
         neighbours, and black leaking in that way is exactly the fringe this
         whole routine exists to avoid. */
      rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
      continue;
    }
    // Dark, but walled in by art: this is the art's own shadow, not the
    // background showing through it.
    if (m >= hi || !open[p]) { rgba[i + 3] = 255; continue; }
    const a = (m - lo) / span;
    // Undo the premultiply: this pixel is the art's own colour faded toward
    // black by `a`, so dividing by `a` recovers the colour it was.
    rgba[i] = Math.min(255, Math.round(r / a));
    rgba[i + 1] = Math.min(255, Math.round(g / a));
    rgba[i + 2] = Math.min(255, Math.round(b / a));
    rgba[i + 3] = Math.round(a * 255);
  }
  return rgba;
}

/* Is there anything in this cell worth keeping? A generated sheet can come
   back with a cell the model left empty, and a blank token drawn over a floor
   is an invisible bug: the GM places cover, nothing appears, and the square
   still blocks sight. Measured as the share of pixels with any opacity at all.
   The threshold is low because a railing is mostly air. */
export function cellCoverage(rgba) {
  let on = 0;
  const n = rgba.length / 4;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 8) on++;
  return n ? on / n : 0;
}
export const MIN_COVERAGE = 0.01;
