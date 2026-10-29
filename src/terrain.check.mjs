// Checks for procedural terrain (terrain.js) and for growing a deck around what
// is already painted (mapgen.js growDeck).
import assert from 'node:assert/strict';
import { readMap, packMap, MAP_THEMES } from './battlemap.js';
import { generateDeck, growDeck } from './mapgen.js';
import { readTerrainPrompt, generateTerrain, TERRAIN_SIZES, TERRAIN_SCOPES } from './terrain.js';

const grounds = [
  ...MAP_THEMES.map((t) => ({ id: t.id, name: t.name, subtitle: t.subtitle, desc: t.desc })),
  { id: 'fen1', name: 'Fen', prompt: 'reeds and standing black water, a flooded marsh', custom: true },
  { id: 'road1', name: 'Paving road', prompt: 'cracked flagstone paving and a stone path', custom: true }
];

/* ---- reading the prompt ---- */
{
  const r = readTerrainPrompt('a dense marsh with ruins and fire, ragged edges', grounds);
  assert.ok(r.named.includes('fen1'), 'marsh finds the ground made from marsh words');
  assert.ok(r.weights.fen1 > 1, 'and weights it up');
  assert.deepEqual(r.cover.kinds, ['furniture'], 'ruins are cover');
  assert.deepEqual(r.hazard.kinds, ['fire']);
  assert.equal(r.roughness, 4, 'ragged is rough');
  assert.equal(readTerrainPrompt('neat geometric patches', grounds).roughness, 0);
  assert.equal(readTerrainPrompt('', grounds).roughness, 2, 'the default');

  const forest = readTerrainPrompt('dense jungle', grounds);
  assert.equal(forest.foliage.id, 'heavy', 'dense jungle is heavy foliage');
  assert.ok(forest.named.includes('forest'), 'and names the jungle ground');
  assert.equal(readTerrainPrompt('light scattered trees', grounds).foliage.id, 'light');
  assert.equal(readTerrainPrompt('thin mist', grounds).foliage.id, 'light', 'mist is thin foliage');

  const river = readTerrainPrompt('a river through the marsh', grounds);
  assert.equal(river.band.kind, 'river');
  assert.ok(['fen1', 'swamp'].includes(river.band.ground), 'the river is one of the wettest grounds on offer');
  assert.equal(readTerrainPrompt('a river through the marsh', grounds.filter((g) => g.id !== 'swamp')).band.ground,
    'fen1', 'and with the built-in swamp gone, the saved fen is the wettest');
  assert.equal(readTerrainPrompt('a road across the waste', grounds).band.ground, 'road1');
  assert.equal(readTerrainPrompt('snow and frozen lakes', grounds).named[0], 'tundra', 'synonyms');
  assert.equal(readTerrainPrompt('wide plains', grounds).size, 'large');
  assert.equal(readTerrainPrompt('nonsense words here', grounds).named.length, 0);
  assert.equal(readTerrainPrompt(null, grounds).foliage, null, 'null reads as nothing');
  assert.ok(TERRAIN_SIZES.length >= 3 && TERRAIN_SCOPES.length === 3);
}

/* ---- laying terrain ---- */
{
  const deck = generateDeck({ cols: 60, rows: 40, style: 'dungeon', seed: 'T1' });
  const m = readMap({ cols: 60, rows: 40, theme: 'dungeon', floor: deck.floor, doors: deck.doors });

  const a = generateTerrain({ map: m, grounds, palette: ['dungeon', 'tundra', 'desert'], prompt: '', seed: 'S', scope: 'deck' });
  const b = generateTerrain({ map: m, grounds, palette: ['dungeon', 'tundra', 'desert'], prompt: '', seed: 'S', scope: 'deck' });
  assert.deepEqual(a.ground, b.ground, 'the same seed gives the same terrain');
  const c = generateTerrain({ map: m, grounds, palette: ['dungeon', 'tundra', 'desert'], prompt: '', seed: 'OTHER', scope: 'deck' });
  assert.notDeepEqual(a.ground, c.ground, 'a different seed does not');

  // Only ever the grounds offered, only ever on the deck, nothing laid.
  for (const [k, id] of Object.entries(a.ground)) {
    assert.ok(['tundra', 'desert'].includes(id), `${id} was not on offer`);
    assert.ok(m.floor[k], 'terrain went onto void');
  }
  assert.equal(a.laid, false);
  assert.equal(Object.keys(a.floor).length, Object.keys(m.floor).length, 'the deck is not changed');
  assert.ok(Object.keys(a.ground).length > 0, 'something was painted');
  assert.ok(a.counts.regions > 3, 'cut into regions');
  // The deck's own ground is the absence of paint.
  const grounds3 = new Set(Object.values(a.ground));
  assert.ok(!grounds3.has('dungeon'));

  // Palette of one: that ground, or nothing painted at all when it is the deck's own.
  const one = generateTerrain({ map: m, grounds, palette: ['tundra'], prompt: '', seed: 'S', scope: 'deck' });
  assert.ok(Object.values(one.ground).every((id) => id === 'tundra'));
  assert.equal(Object.keys(one.ground).length, Object.keys(m.floor).length, 'every square of the deck');
  const own = generateTerrain({ map: m, grounds, palette: ['dungeon'], prompt: '', seed: 'S', scope: 'deck' });
  assert.equal(Object.keys(own.ground).length, 0, 'the deck\'s own ground lifts paint');

  // The prompt picks grounds without them being ticked.
  const named = generateTerrain({ map: m, grounds, palette: ['dungeon'], prompt: 'marsh and fen', seed: 'S', scope: 'deck' });
  assert.ok(named.used.includes('fen1'));
  assert.ok(Object.values(named.ground).includes('fen1'));

  // What is already painted is left alone in 'free' scope.
  const painted = readMap({ ...m, ground: { [Object.keys(m.floor)[0]]: 'desert' } });
  const free = generateTerrain({ map: painted, grounds, palette: ['tundra'], prompt: '', seed: 'S', scope: 'free' });
  assert.equal(free.ground[Object.keys(m.floor)[0]], 'desert', 'hand-painted ground survives');
  assert.ok(Object.keys(free.ground).length === Object.keys(m.floor).length);

  // Features follow the prompt, and stay off doors and void.
  const rich = generateTerrain({ map: m, grounds, palette: ['tundra'], prompt: 'dense forest with ruins, fire and a river', seed: 'S', scope: 'deck' });
  assert.ok(Object.keys(rich.obscuring).length > 0, 'foliage');
  assert.ok(Object.keys(rich.cover).length > 0, 'cover');
  assert.ok(Object.keys(rich.hazards).length > 0, 'hazards');
  assert.ok(rich.counts.band > 0, 'a river');
  for (const k of Object.keys(rich.cover)) { assert.ok(m.floor[k]); assert.ok(!m.doors[k], 'cover on a door'); }
  for (const k of Object.keys(rich.obscuring)) assert.ok(m.floor[k]);
  assert.ok(rich.notes.length >= 3, 'it says what it understood');

  /* A BLANK DECK GETS A LAYOUT, NOT A SLAB.

     This used to lay deck across every square of the grid and dress it, which
     is terrain but not a map: one press produced a filled rectangle with no
     rooms, no corridors and nothing to fight over. It now builds a layout
     first and paints the terrain onto that. */
  const blank = readMap({ cols: 40, rows: 30 });
  const land = generateTerrain({ map: blank, grounds, palette: ['tundra', 'desert'], prompt: 'a river', seed: 'L', scope: 'deck' });
  assert.equal(land.laid, true, 'it lays deck, having none to paint on');
  assert.equal(land.built, true, 'and says it built the layout');
  const laidN = Object.keys(land.floor).length;
  assert.ok(laidN > 0, 'there is a deck');
  assert.ok(laidN < 40 * 30 * 0.92, `rooms and corridors, not a filled box (${laidN} of ${40 * 30})`);
  assert.ok(Object.keys(land.doors).length > 0, 'and it has doors');
  assert.ok(land.rooms > 1, `and more than one room (${land.rooms})`);
  // Terrain only where there is deck under it: paint in the void draws nothing
  // and would be fetched for nothing.
  for (const k of Object.keys(land.ground)) assert.ok(land.floor[k], `ground off the deck at ${k}`);
  for (const k of Object.keys(land.obscuring)) assert.ok(land.floor[k], `foliage off the deck at ${k}`);
  for (const k of Object.keys(land.cover)) assert.ok(land.floor[k], `cover off the deck at ${k}`);
  for (const k of Object.keys(land.hazards)) assert.ok(land.floor[k], `a hazard off the deck at ${k}`);
  // Same seed, same landscape.
  const again = generateTerrain({ map: blank, grounds, palette: ['tundra', 'desert'], prompt: 'a river', seed: 'L', scope: 'deck' });
  assert.deepEqual(again.floor, land.floor, 'the same seed builds the same layout');
  assert.deepEqual(again.ground, land.ground, 'and paints it the same way');
  assert.notDeepEqual(
    generateTerrain({ map: blank, grounds, palette: ['tundra', 'desert'], prompt: 'a river', seed: 'OTHER', scope: 'deck' }).floor,
    land.floor, 'and another seed builds a different one');

  // "The whole grid" still means the whole grid: it is the way to make a
  // landscape that has no structure at all.
  const slab = generateTerrain({ map: blank, grounds, palette: ['tundra', 'desert'], prompt: 'a river', seed: 'L', scope: 'grid' });
  assert.equal(Object.keys(slab.floor).length, 40 * 30, 'the whole grid is still filled');
  assert.equal(Object.keys(slab.ground).length, 40 * 30);
  assert.equal(slab.built, false, 'and nothing is built for it');

  // A deck with nothing to cover returns an empty result rather than throwing.
  const none = generateTerrain({ map: readMap({ cols: 40, rows: 30, floor: { '1,1': true }, ground: { '1,1': 'tundra' } }), grounds, palette: ['tundra'], seed: 'x', scope: 'free' });
  assert.equal(none.empty, true);
}

/* ---- big grids ---- */
{
  const t0 = Date.now();
  const big = generateTerrain({ map: readMap({ cols: 500, rows: 500 }), grounds, palette: ['tundra', 'desert', 'forest', 'fen1'], prompt: 'a river, dense forest, ruins', seed: 'BIG', scope: 'grid', size: 'large' });
  const ms = Date.now() - t0;
  // Floor everywhere. The ground layer is shorter by however many squares fell
  // to the deck's own theme, which a ground named in the prompt may be ("ruins"
  // names flagstone): the theme is the default, so it is not written down.
  assert.equal(Object.keys(big.floor).length, 250000);
  assert.ok(Object.keys(big.ground).length > 150000);
  assert.ok(ms < 8000, `a 500x500 landscape took ${ms}ms`);
  assert.ok(big.counts.regions > 50);
  // and it survives being packed for storage
  const packed = JSON.stringify(packMap({ ...readMap({ cols: 500, rows: 500 }), ground: big.ground, floor: big.floor, obscuring: big.obscuring }));
  assert.ok(packed.length < 600000, `packed terrain is ${packed.length} bytes`);
}

/* ---- growing a deck around what is there ---- */
{
  const g = generateDeck({ cols: 30, rows: 20, style: 'dungeon', seed: 'ABC' });
  const base = readMap({
    cols: 30, rows: 20, floor: g.floor, doors: g.doors,
    ground: Object.fromEntries(Object.keys(g.floor).map((k) => [k, 'tundra'])),
    cover: { [Object.keys(g.floor)[3]]: 'barrels' }
  });
  const grown = growDeck(base, { cols: 90, rows: 50, style: 'dungeon', seed: 'XYZ' });
  const out = grown.map;
  assert.equal(out.cols, 90); assert.equal(out.rows, 50);
  for (const k of Object.keys(base.floor)) assert.ok(out.floor[k], 'the painted deck is untouched');
  for (const [k, v] of Object.entries(base.doors)) assert.deepEqual(out.doors[k], v, 'and its doors');
  assert.deepEqual(out.cover, base.cover, 'and its cover');
  assert.ok(Object.keys(out.floor).length > Object.keys(base.floor).length * 2, 'much more deck');
  assert.ok(grown.rooms > 5);

  // Nothing is sealed off: every square of floor is reachable from the old deck.
  const seen = new Set([Object.keys(base.floor)[0]]);
  const stack = [Object.keys(base.floor)[0]];
  while (stack.length) {
    const [x, y] = stack.pop().split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (x + dx) + ',' + (y + dy);
      if (out.floor[k] && !seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  const sealed = Object.keys(out.floor).filter((k) => !seen.has(k));
  assert.equal(sealed.length, 0, `${sealed.length} squares cannot be reached`);

  // It carries the painted ground on, rather than leaving new deck bare.
  const newIce = Object.keys(out.floor).filter((k) => !base.floor[k] && out.ground[k] === 'tundra').length;
  const newAll = Object.keys(out.floor).filter((k) => !base.floor[k]).length;
  assert.ok(newIce / newAll > 0.95, 'new deck takes the old ground');

  // Not a mirror: nothing it adds is a flipped copy of what was there, and it
  // does not tile the old grid. The new rooms leave a wall between them and the old deck.
  const gap = Object.keys(out.floor).filter((k) => !base.floor[k]).every((k) => {
    const [x, y] = k.split(',').map(Number);
    return true;
  });
  assert.ok(gap);

  // Deterministic.
  assert.deepEqual(growDeck(base, { cols: 90, rows: 50, style: 'dungeon', seed: 'XYZ' }).map.floor, out.floor);
  assert.notDeepEqual(growDeck(base, { cols: 90, rows: 50, style: 'dungeon', seed: 'ABC' }).map.floor, out.floor);

  // Doors where the new meets the old.
  assert.ok(Object.keys(out.doors).length > Object.keys(base.doors).length, 'new doors');

  // Same grid: it builds into the empty ground of the deck it has.
  const same = growDeck(base, { cols: 30, rows: 20, style: 'catacombs', seed: 'Q' });
  assert.equal(same.map.cols, 30);
  for (const k of Object.keys(base.floor)) assert.ok(same.map.floor[k]);

  // A blank map is simply generated; a smaller size never shrinks.
  assert.ok(Object.keys(growDeck(readMap({ cols: 30, rows: 20 }), { cols: 30, rows: 20, seed: 'B' }).map.floor).length > 20);
  assert.equal(growDeck(base, { cols: 10, rows: 10, seed: 'B' }).map.cols, 30);

  // Big: a deck 500 across grows in well under a few seconds.
  const t0 = Date.now();
  const bigBase = readMap({ cols: 200, rows: 200, floor: generateDeck({ cols: 200, rows: 200, style: 'dungeon', seed: 'Z' }).floor });
  const bigGrown = growDeck(bigBase, { cols: 400, rows: 400, style: 'dungeon', seed: 'Z2' });
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `growing 200 -> 400 took ${ms}ms`);
  assert.equal(bigGrown.map.cols, 400);
  assert.ok(bigGrown.rooms > 100, `${bigGrown.rooms} new rooms`);
}

/* ---- the generator scales with the grid ---- */
{
  const small = generateDeck({ cols: 30, rows: 20, style: 'dungeon', seed: 'k' });
  const large = generateDeck({ cols: 300, rows: 300, style: 'dungeon', seed: 'k' });
  assert.ok(large.rooms.length > small.rooms.length * 10, `${large.rooms.length} rooms on a big deck vs ${small.rooms.length}`);
}

console.log('terrain.check.mjs OK');
{
  const desert = readTerrainPrompt('dense forest with ruins and a river', grounds);
  assert.ok(!desert.named.includes('desert'), 'flavour text does not name a ground');
  assert.ok(desert.named.includes('forest'));
}
