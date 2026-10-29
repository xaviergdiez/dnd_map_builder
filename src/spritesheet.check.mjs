/* Checks for spritesheet.js — the grid, the slot table, and the keying.

   The keying is the part worth testing: it is the one piece of this feature
   that runs twice, once in a desktop tool against a 2048px JPEG and once in
   the browser against a canvas the GM just generated, and a difference between
   the two shows up as tokens that look right in the app and wrong on the
   shipped sheets, or the reverse. */

import {
  SHEET_COLS, SHEET_ROWS, SHEET_CELLS, SPRITE_SLOTS, SPRITE_ROLES, slotOfRole,
  SHEET_FOR_THEME, spriteRole, cellRect, keyBlack, cellCoverage, MIN_COVERAGE,
  BLACK_LO, BLACK_HI
} from './spritesheet.js';
import { MAP_THEMES, COVER_TYPES, HAZARD_TYPES, OBSCURING, DOOR_KINDS, DOOR_STATES } from './battlemap.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

/* ---- the slot table ---- */
ok(SPRITE_SLOTS.length === SHEET_CELLS, 'a slot for every cell');
ok(SHEET_COLS * SHEET_ROWS === SHEET_CELLS, 'the grid multiplies out');
ok(new Set(SPRITE_ROLES).size === SHEET_CELLS, 'every role is distinct');
SPRITE_SLOTS.forEach((s, i) => {
  ok(s.slot === i, `slot ${i} is in its own place (reading order is the sheet order)`);
  ok(typeof s.name === 'string' && s.name.length > 2, `slot ${i} has a name for the GM`);
  ok(slotOfRole(s.role) === i, `${s.role} is found by name`);
});
ok(slotOfRole('nonsense') === -1, 'an unknown role is not found');

/* ---- every sheet belongs to a theme ----
   No sheets ship yet, so the map may be empty; what it may never do is name a
   theme that does not exist or share one sheet between two. */
const themeIds = new Set(MAP_THEMES.map((t) => t.id));
for (const id of Object.keys(SHEET_FOR_THEME)) {
  ok(themeIds.has(id), `${id} is a real theme`);
}
ok(new Set(Object.values(SHEET_FOR_THEME)).size === Object.keys(SHEET_FOR_THEME).length,
  'two themes do not share one sheet');

/* ---- what the app asks for, it can get ----
   The point of this block is that the two vocabularies cannot drift apart
   silently. Add a cover type and this says which picture it has not got. */
for (const k of DOOR_KINDS) {
  for (const st of DOOR_STATES) {
    const role = spriteRole('door', k.id, st);
    ok(SPRITE_ROLES.includes(role), `door ${k.id}/${st} -> a real role (got ${role})`);
  }
}
ok(spriteRole('door', 'wooden', 'open') === 'door_open', 'an open door is the open archway');
ok(spriteRole('door', 'iron', 'jammed') === 'door_closed', 'a jammed door still looks shut');
ok(spriteRole('door', 'trapdoor', 'open') === 'trapdoor', 'a trapdoor is a trapdoor either way');

for (const c of COVER_TYPES) {
  const role = spriteRole('cover', c.id, null, { x: 0, y: 0 });
  ok(SPRITE_ROLES.includes(role), `cover ${c.id} -> a real role (got ${role})`);
}
for (const o of OBSCURING) {
  const role = spriteRole('obscure', o.id);
  ok(SPRITE_ROLES.includes(role), `obscuring ${o.id} -> a real role (got ${role})`);
}
// Hazards are the one place a null is correct, so assert WHICH ones are null
// rather than that some are: a new hazard arriving with no art should fail
// this line and be thought about, not silently drawn flat.
const hazardRoles = Object.fromEntries(HAZARD_TYPES.map((h) => [h.id, spriteRole('hazard', h.id)]));
ok(hazardRoles.fire === 'fire' && hazardRoles.poison === 'gas' && hazardRoles.arcane === 'arcane',
  'fire, gas and glyphs have tokens');
ok(hazardRoles.acid === null && hazardRoles.lava === null && hazardRoles.spikes === null,
  'acid, lava and pits are drawn flat, deliberately');
ok(spriteRole('nonsense', 'x') === null, 'an unknown kind asks for nothing');

/* ---- every barrier is the same picture ----
   A barrier is laid square by square to make a LINE, so neighbours must match:
   two different low-cover pictures alternating along a run read as a railing
   that turns into a wall and back. This asserts the cohesion directly, because
   an earlier version did alternate them and it looked like a mistake. */
const lows = [];
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) lows.push(spriteRole('cover', 'low', null, { x, y }));
ok(new Set(lows).size === 1, 'every barrier on the deck is the same picture');
ok(lows[0] === 'barrier', 'and it is the railing, not the low wall');
ok(SPRITE_ROLES.includes(spriteRole('cover', 'low', null, null)), 'and it still works with no position');
// A barrier must not be scattered by position either, or a run of them would
// come apart again at the angles rather than at the artwork.
ok(SPRITE_SLOTS.find((s) => s.role === 'barrier').turn === false,
  'and it is never turned on its own, which would break the run just as badly');

/* ---- the grid ---- */
for (const size of [2048, 1024, 512, 2046]) {
  const seen = [];
  for (let i = 0; i < SHEET_CELLS; i++) {
    const r = cellRect(i, size);
    ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= size && r.y + r.h <= size,
      `cell ${i} of a ${size}px sheet stays on the sheet`);
    seen.push(`${r.x},${r.y}`);
  }
  ok(new Set(seen).size === SHEET_CELLS, `a ${size}px sheet has ${SHEET_CELLS} distinct cells`);
}
// Reading order, because the slot table is written in it.
ok(cellRect(0, 2048).x === 0 && cellRect(0, 2048).y === 0, 'cell 0 is top left');
ok(cellRect(3, 2048).x === 1536 && cellRect(3, 2048).y === 0, 'cell 3 ends the first row');
ok(cellRect(4, 2048).x === 0 && cellRect(4, 2048).y === 512, 'cell 4 begins the second');
ok(cellRect(15, 2048).x === 1536 && cellRect(15, 2048).y === 1536, 'cell 15 is bottom right');
ok(cellRect(99, 2048).x === 1536, 'an index past the end is clamped, not wrapped');
ok(cellRect(-5, 2048).x === 0, 'and so is one before the start');
ok(cellRect(0, 512).w === 128, 'a 512px sheet has 128px cells');

/* ---- the keying ---- */
const px = (r, g, b) => Uint8ClampedArray.from([r, g, b, 255]);

ok(keyBlack(px(0, 0, 0))[3] === 0, 'pitch black goes away');
ok(keyBlack(px(5, 5, 5))[3] === 0, 'and so does the near-black the sheets really have');
ok(keyBlack(px(21, 21, 21))[3] === 0, 'and the faint grid lines at 21, which is why LO is not 1');
ok(keyBlack(px(255, 255, 255))[3] === 255, 'white is solid');
ok(keyBlack(px(BLACK_HI, BLACK_HI, BLACK_HI))[3] === 255, 'and so is anything at HI');
ok(keyBlack(px(0, 0, 200))[3] === 255, 'a saturated blue is solid, not half-there for being blue');
ok(keyBlack(px(200, 0, 0))[3] === 255, 'and so is a saturated red');

// A pixel in between is part background, and its colour is recovered.
{
  const mid = Math.round((BLACK_LO + BLACK_HI) / 2);
  const out = keyBlack(px(mid, mid, mid));
  ok(out[3] > 100 && out[3] < 155, `a half-way pixel is half-way opaque (${out[3]})`);
  ok(out[0] > mid * 1.6, `and brighter than it looked on black (${mid} -> ${out[0]})`);
}
// The transparent ones are zeroed, which is what keeps a dark fringe from
// reappearing the moment the image is scaled down.
{
  const out = keyBlack(px(3, 3, 3));
  ok(out[0] === 0 && out[1] === 0 && out[2] === 0, 'an invisible pixel carries no colour to smear');
}
// Solid art is untouched: a token's interior must come out of this byte for
// byte, or every sheet is quietly recoloured.
{
  const before = [90, 140, 200];
  const out = keyBlack(px(...before));
  ok(out[0] === before[0] && out[1] === before[1] && out[2] === before[2],
    'art above HI keeps its exact colour');
}
// In place, and the same array back, because the callers rely on both.
{
  const buf = px(10, 10, 10);
  ok(keyBlack(buf) === buf, 'the same array is returned');
}
// A custom range, as a sheet with a dirtier background would need.
ok(keyBlack(px(60, 60, 60), { lo: 70, hi: 100 })[3] === 0, 'LO and HI can be moved');

/* ---- dark art is not background ----

   The bug this prevents: judged on brightness alone, a rusted iron door's own
   panels are darker than the edge-feather threshold, so two thirds of the
   door came out see-through and the deck plate showed through it. Measured
   before the fix at 66% of the solid art on one sheet.

   A dark pixel WALLED IN by art is the art's own shadow. A dark pixel the
   background can walk to is an edge. That is the whole rule. */
{
  const W = 9;
  // Inside the feather band, whatever the band currently is: pinning this to a
  // literal is how these checks went stale when HI moved from 52 to 34.
  const DARK = Math.round((BLACK_LO + BLACK_HI) / 2);
  // A ring of bright art with a dark interior, on a dark background.
  const img = new Uint8ClampedArray(W * W * 4);
  const set = (x, y, v) => {
    const i = (y * W + x) * 4;
    img[i] = v; img[i + 1] = v; img[i + 2] = v; img[i + 3] = 255;
  };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) set(x, y, 2);   // background
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) set(x, y, 200); // the art
  // Its inside is dark — the shadow in a door's recess — and sits inside the
  // band, so brightness alone would have called it half-background.
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) set(x, y, DARK);
  keyBlack(img, { w: W, h: W });
  const alphaAt = (x, y) => img[(y * W + x) * 4 + 3];

  ok(alphaAt(0, 0) === 0, 'the background still goes');
  ok(alphaAt(4, 4) === 255, 'but the shadow INSIDE the art stays solid');
  ok(alphaAt(3, 3) === 255, 'all of it, not just the middle');
  ok(alphaAt(2, 2) === 255, 'and the art itself is untouched');

  // The same interior, left open to the outside, is background again: an
  // open doorway is a hole and must show the floor through it.
  const open2 = new Uint8ClampedArray(img.length);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    open2[i] = 2; open2[i + 1] = 2; open2[i + 2] = 2; open2[i + 3] = 255;
  }
  const put = (x, y, v) => {
    const i = (y * W + x) * 4;
    open2[i] = v; open2[i + 1] = v; open2[i + 2] = v; open2[i + 3] = 255;
  };
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) put(x, y, 200);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) put(x, y, DARK);
  for (let y = 3; y <= 5; y++) put(6, y, DARK);      // break the wall open
  keyBlack(open2, { w: W, h: W });
  ok(open2[(4 * W + 4) * 4 + 3] < 255,
    'a dark region the background can reach is still faded');

  /* TRUE BLACK IS A HOLE WHEREVER IT IS. This is what keeps an open doorway
     open and the gaps between a railing's balusters clear, even though both
     are enclosed by the art around them. */
  const holed = new Uint8ClampedArray(W * W * 4);
  const mark = (x, y, v) => {
    const i = (y * W + x) * 4;
    holed[i] = v; holed[i + 1] = v; holed[i + 2] = v; holed[i + 3] = 255;
  };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) mark(x, y, 2);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) mark(x, y, 200);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) mark(x, y, 0);
  keyBlack(holed, { w: W, h: W });
  ok(holed[(4 * W + 4) * 4 + 3] === 0, 'an enclosed pure-black hole is still a hole');
  ok(holed[(2 * W + 2) * 4 + 3] === 255, 'and the frame around it is solid');

  // Without dimensions it is a strip with no inside, so everything is
  // reachable: the old brightness-only behaviour, which is what the
  // pixel-level checks above rely on.
  const strip = Uint8ClampedArray.from([DARK, DARK, DARK, 255]);
  keyBlack(strip);
  ok(strip[3] > 0 && strip[3] < 255, 'with no shape given, a dark pixel still fades');
}

/* ---- coverage ---- */
{
  const empty = new Uint8ClampedArray(64 * 4);
  ok(cellCoverage(empty) === 0, 'an empty cell covers nothing');
  ok(cellCoverage(empty) < MIN_COVERAGE, 'and reads as empty');
  const full = new Uint8ClampedArray(64 * 4).fill(255);
  ok(cellCoverage(full) === 1, 'a full cell covers everything');
  const sparse = new Uint8ClampedArray(1000 * 4);
  for (let i = 0; i < 30; i++) sparse[i * 4 + 3] = 255;
  ok(Math.abs(cellCoverage(sparse) - 0.03) < 1e-9, 'and a sparse one reads in between');
  ok(cellCoverage(sparse) > MIN_COVERAGE, 'a railing is mostly air and still counts as art');
}

console.log(fails === 0 ? 'spritesheet.js: all checks passed' : `spritesheet.js: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
