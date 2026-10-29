// Self-check for the deck generator. Run: node src/mapgen.check.mjs
import assert from 'node:assert/strict';
import {
  generateDeck, DECK_STYLES, styleById, makeRng, hashSeed, newSeed
} from './mapgen.js';
import { cellKey, parseKey, readMap, regionAt, MIN_GRID, MAX_GRID } from './battlemap.js';

const SEEDS = ['ALPHA', 'BRAVO', '12345', 'x', 'KORONUS'];

/* ------------------------------- the seed ------------------------------- */

{
  // Reproducibility is the whole contract. A deck is saved, published to the
  // projector and edited afterwards; one that cannot be made again from what
  // is written on it cannot be recovered when an edit goes wrong.
  const a = makeRng('ALPHA'), b = makeRng('ALPHA'), c = makeRng('BRAVO');
  const draw = (f) => Array.from({ length: 12 }, () => f());
  assert.deepEqual(draw(a), draw(b), 'the same seed draws the same numbers');
  assert.notDeepEqual(draw(makeRng('ALPHA')), draw(c), 'a different seed does not');

  // In [0,1) and never NaN, however it is seeded — these come off a text box.
  for (const s of ['', null, undefined, 0, -1, 'ß', 'a'.repeat(500)]) {
    const r = makeRng(s);
    for (let i = 0; i < 200; i++) {
      const v = r();
      assert.ok(Number.isFinite(v) && v >= 0 && v < 1, `seed ${JSON.stringify(s)} drew ${v}`);
    }
  }
  assert.equal(hashSeed('ALPHA'), hashSeed('ALPHA'));
  assert.notEqual(hashSeed('ALPHA'), hashSeed('ALPHB'));
  assert.ok(Number.isInteger(hashSeed(null)));
  assert.match(newSeed(), /^[A-Z0-9]+$/, 'a fresh seed is typeable');
}

/* --------------------------- the deck is a deck --------------------------- */

const decks = [];
for (const style of DECK_STYLES) {
  for (const seed of SEEDS) {
    decks.push(generateDeck({ cols: 40, rows: 28, style: style.id, seed }));
  }
}

{
  for (const d of decks) {
    const keys = Object.keys(d.floor);
    assert.ok(keys.length > 0, `${d.style}/${d.seed} built nothing`);
    for (const k of keys) {
      const p = parseKey(k);
      assert.ok(p, 'every key parses');
      assert.ok(p.x >= 0 && p.y >= 0 && p.x < d.cols && p.y < d.rows,
        `${d.style}/${d.seed} put a cell at ${k}, off a ${d.cols}x${d.rows} grid`);
    }
    // A deck that is almost the whole rectangle has no walls to speak of and
    // nothing to partition; one that is almost nothing is not a deck.
    const fill = keys.length / (d.cols * d.rows);
    assert.ok(fill > 0.15 && fill < 0.92, `${d.style}/${d.seed} fills ${fill.toFixed(2)}`);
  }
}

/* ------------------------- same seed, same deck ------------------------- */

{
  for (const style of DECK_STYLES) {
    const a = generateDeck({ cols: 40, rows: 28, style: style.id, seed: 'REPEAT' });
    const b = generateDeck({ cols: 40, rows: 28, style: style.id, seed: 'REPEAT' });
    assert.deepEqual(a.floor, b.floor, `${style.id} is not reproducible`);
    assert.deepEqual(a.doors, b.doors, `${style.id} doors are not reproducible`);

    const other = generateDeck({ cols: 40, rows: 28, style: style.id, seed: 'DIFFERENT' });
    assert.notDeepEqual(a.floor, other.floor, `${style.id} ignores its seed`);
  }

  // No seed at all still produces a deck, and says which one it used, so a
  // deck generated on a whim can still be written down afterwards.
  const spon = generateDeck({ cols: 30, rows: 20 });
  assert.ok(spon.seed, 'a generated deck always reports its seed');
  const again = generateDeck({ cols: 30, rows: 20, seed: spon.seed });
  assert.deepEqual(again.floor, spon.floor, 'and that seed reproduces it');
}

/* ------------------------------ connectivity -----------------------------

   A sealed room is the failure that ruins a session rather than merely
   looking wrong: the party cannot reach it and the GM finds out mid-fight. */

const flood = (floor, start) => {
  const seen = new Set([cellKey(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const c = queue.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const k = cellKey(c.x + dx, c.y + dy);
      if (seen.has(k) || !floor[k]) continue;
      seen.add(k);
      queue.push({ x: c.x + dx, y: c.y + dy });
    }
  }
  return seen;
};

{
  for (const d of decks) {
    const keys = Object.keys(d.floor);
    const first = parseKey(keys[0]);
    const reached = flood(d.floor, first);
    assert.equal(reached.size, keys.length,
      `${d.style}/${d.seed}: ${keys.length - reached.size} squares are cut off`);

    // And every room specifically, since that is what the party is coming for.
    for (const r of d.rooms) {
      const mid = { x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) };
      assert.ok(reached.has(cellKey(mid.x, mid.y)),
        `${d.style}/${d.seed}: a room at ${mid.x},${mid.y} cannot be reached`);
    }
  }
}

/* ---------------------- THE REASON THIS IS BSP ----------------------

   The fog is not a radius, it is rooms: regionAt() flood-fills and stops only
   at doors. So the generator has to produce compartments, and this is the
   assertion that says it did. A cave generator passes every test above and
   fails this one — its first fog click reveals the entire deck. */

{
  for (const d of decks) {
    if (d.rooms.length < 2) continue;
    const map = readMap({ cols: d.cols, rows: d.rows, floor: d.floor, doors: d.doors });
    const total = Object.keys(map.floor).length;

    let worst = 0;
    for (const r of d.rooms) {
      const mid = { x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) };
      if (!map.floor[cellKey(mid.x, mid.y)]) continue;
      const region = regionAt(map, mid);
      assert.ok(region.length > 0, 'a room cell is in some region');
      worst = Math.max(worst, region.length / total);
    }
    /* Half the deck, not three quarters. The first threshold here was 0.75
       and it passed a style whose rooms had merged into blobs — a warren
       revealing 36% a click looked fine against a limit that loose. The
       number has to bite to be defending anything. */
    assert.ok(worst < 0.5,
      `${d.style}/${d.seed}: one click reveals ${(worst * 100) | 0}% of the deck`);
  }
}

/* -------------------------------- the doors ------------------------------- */

{
  for (const d of decks) {
    if (d.rooms.length < 2) continue;
    const count = Object.keys(d.doors).length;
    assert.ok(count > 0, `${d.style}/${d.seed} generated no doors at all`);

    for (const [k, door] of Object.entries(d.doors)) {
      const p = parseKey(k);
      assert.ok(p && p.x >= 0 && p.y >= 0 && p.x < d.cols && p.y < d.rows, 'door on the grid');
      // A door off the deck is a door onto nothing. readMap keeps doors and
      // floor apart, so nothing else would notice.
      assert.ok(d.floor[k], `${d.style}/${d.seed}: a door at ${k} is not on the floor`);
      assert.ok(['wooden', 'iron', 'trapdoor'].includes(door.kind), 'a known door kind');
      assert.equal(door.state, 'closed', 'a deck nobody has walked starts shut');
      assert.ok(styleById(d.style).doorKinds.includes(door.kind),
        `${d.style} used a door kind it does not have`);
    }
  }

  // The style actually changes the deck rather than only its name.
  const warren = generateDeck({ cols: 48, rows: 32, style: 'catacombs', seed: 'CMP' });
  const hulk = generateDeck({ cols: 48, rows: 32, style: 'caverns', seed: 'CMP' });
  assert.ok(warren.rooms.length > hulk.rooms.length,
    'catacombs are more rooms than caverns');
}

/* ------------------------------- rubbish in ------------------------------- */

{
  // cols/rows arrive from number inputs and the style from a select, so every
  // one of these is a question of when rather than whether.
  const junk = [
    { cols: NaN, rows: NaN }, { cols: 0, rows: 0 }, { cols: -5, rows: -5 },
    { cols: 1e9, rows: 1e9 }, { cols: '40', rows: '28' },
    { style: 'no-such-style' }, { style: null }, {}, undefined
  ];
  for (const args of junk) {
    const d = generateDeck(args);
    assert.ok(d.cols >= MIN_GRID && d.cols <= MAX_GRID, `cols ${d.cols} from ${JSON.stringify(args)}`);
    assert.ok(d.rows >= MIN_GRID && d.rows <= MAX_GRID, `rows ${d.rows}`);
    assert.ok(Object.keys(d.floor).length > 0, `nothing built from ${JSON.stringify(args)}`);
    // Whatever went in, what comes out has to survive the map reader, or the
    // generator produces decks the app then silently drops.
    const m = readMap({ cols: d.cols, rows: d.rows, floor: d.floor, doors: d.doors });
    assert.equal(Object.keys(m.floor).length, Object.keys(d.floor).length,
      'readMap kept every square');
    assert.equal(Object.keys(m.doors).length, Object.keys(d.doors).length,
      'readMap kept every door');
  }
}

/* --------------------------- the smallest grids --------------------------- */

{
  // MIN_GRID is 5 and minLeaf is 7, so the partition cannot cut at all. It
  // still has to produce a usable room rather than divide by zero.
  for (const style of DECK_STYLES) {
    const d = generateDeck({ cols: MIN_GRID, rows: MIN_GRID, style: style.id, seed: 'TINY' });
    assert.ok(Object.keys(d.floor).length > 0, `${style.id} built nothing on a 5x5`);
    for (const k of Object.keys(d.floor)) {
      const p = parseKey(k);
      assert.ok(p.x < MIN_GRID && p.y < MIN_GRID, 'and kept it on the grid');
    }
  }
}

console.log('mapgen.js: all checks passed');
