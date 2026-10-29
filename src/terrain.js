/* Procedural terrain: ground laid out the way the deck generator lays out
   rooms.

   WHAT IT IS FOR. Paint ground puts one terrain down a brush at a time, which
   is the right tool for a ridge of ice along a cliff and the wrong one for a
   marsh two hundred squares across. This does the large version: it cuts the
   deck into regions with the same binary partition mapgen.js uses for rooms,
   gives each region one of the grounds on offer, roughens the seams so they
   read as terrain rather than as a tiled floor, and then sows the things that
   live on ground — foliage, cover, hazards, a river or a road — according to
   what the GM wrote.

   THE GROUNDS ARE WHATEVER THE GM HAS. The built-in set, and every ground
   saved to their library, whether it was generated or uploaded: a ground is a
   ground by the time it is saved, and this reads only its id, its name and
   the words it was made from.

   THE PROMPT IS READ, NOT SENT ANYWHERE. It is matched against the names and
   descriptions of the grounds on offer (a ground called "Fen" that was made
   from "reeds and standing water" answers to "marsh" and "water") and against
   a short list of words for foliage, cover, hazards, rivers and roads. That is
   deliberate: it works offline and at the table, the same words always mean
   the same thing, and the summary it hands back says exactly what it
   understood, so a GM is never guessing what a sentence did. Seeded, like
   everything else that generates: the seed written beside the result gives the
   same terrain again.

   Pure. See terrain.check.mjs. */

import {
  readMap, parseKey, keepClean, COVER_TYPES, HAZARD_TYPES, OBSCURING
} from './battlemap.js';
import { makeRng, newSeed, generateDeck } from './mapgen.js';

/* How big a patch of one ground tends to be, in squares across. */
export const TERRAIN_SIZES = [
  { id: 'auto', name: 'From the prompt', min: 9, max: 20 },
  { id: 'small', name: 'Small patches', min: 5, max: 10 },
  { id: 'medium', name: 'Medium', min: 9, max: 20 },
  { id: 'large', name: 'Large stretches', min: 18, max: 40 }
];
export const terrainSizeById = (id) => TERRAIN_SIZES.find((s) => s.id === id) || TERRAIN_SIZES[0];

/* Where it goes. `deck` is the squares that already have deck; `free` is the
   squares of deck with no terrain painted on them yet, so what has been
   painted by hand is left alone; `grid` is everywhere, laying deck on the
   empty squares, which is how a whole landscape is made from nothing. */
export const TERRAIN_SCOPES = [
  { id: 'deck', name: 'Over the painted floor' },
  { id: 'free', name: 'Only squares with no terrain yet' },
  { id: 'grid', name: 'The whole grid (lays floor on empty squares)' }
];

/* ------------------------------- the words ------------------------------- */

const STOP = new Set([
  'the', 'and', 'with', 'some', 'many', 'much', 'mostly', 'lots', 'few', 'little', 'big', 'across',
  'around', 'near', 'through', 'over', 'under', 'into', 'from', 'that', 'this', 'there', 'where',
  'very', 'like', 'also', 'then', 'than', 'have', 'has', 'are', 'for', 'its', 'one', 'two', 'three',
  'ground', 'terrain', 'floor', 'area', 'map', 'place', 'make', 'full', 'covered', 'a', 'of', 'in', 'on',
  'to', 'by', 'at', 'an', 'is', 'it', 'as', 'or', 'but'
]);

// Words that mean the same thing for the purpose of finding a ground.
const SYNONYMS = {
  forest: ['jungle', 'wood', 'trees', 'leaf', 'canopy'], woods: ['forest'], woodland: ['forest'],
  trees: ['forest'], jungle: ['forest', 'leaf', 'canopy'],
  snow: ['tundra', 'ice', 'frozen'], frozen: ['tundra', 'ice', 'snow'], glacier: ['tundra', 'ice'], tundra: ['ice', 'snow'],
  sand: ['desert', 'dune'], dunes: ['desert', 'sand'], dune: ['desert', 'sand'], wasteland: ['desert', 'waste'],
  badlands: ['desert', 'waste'], dust: ['desert', 'sand'],
  city: ['cobbles', 'street', 'urban'], urban: ['cobbles', 'street', 'city'], streets: ['cobbles', 'street', 'city'],
  town: ['cobbles', 'street'], courtyard: ['cobbles', 'street'],
  dungeon: ['flagstone', 'stone'], cellar: ['flagstone', 'dungeon'], castle: ['flagstone', 'cobbles'],
  crypt: ['catacombs', 'tomb', 'marble'], tomb: ['catacombs', 'crypt'], graveyard: ['catacombs', 'crypt'],
  cave: ['cavern', 'rock'], caves: ['cavern', 'rock'], cavern: ['cave', 'rock'], mine: ['cavern', 'rock'],
  inn: ['tavern', 'boards', 'plank'], tavern: ['boards', 'plank', 'wood'], deck: ['tavern', 'boards', 'plank'],
  planks: ['tavern', 'boards'], wooden: ['tavern', 'boards'], floorboards: ['tavern', 'boards'],
  lava: ['volcanic', 'obsidian', 'ember'], magma: ['volcanic', 'lava'], volcano: ['volcanic', 'obsidian'],
  basalt: ['volcanic', 'obsidian'], hell: ['volcanic', 'ember'],
  marsh: ['fen', 'swamp', 'bog', 'water', 'mud', 'wet'], swamp: ['marsh', 'fen', 'bog', 'water', 'mud'],
  fen: ['marsh', 'swamp', 'water'], bog: ['marsh', 'swamp', 'mud'], mud: ['marsh', 'swamp', 'wet'],
  water: ['river', 'lake', 'flooded', 'wet', 'marsh'], flooded: ['water', 'wet'], river: ['water', 'stream'],
  rock: ['stone', 'rocky', 'crag'], rocky: ['rock', 'stone'], stone: ['rock', 'flagstone'],
  ruins: ['rubble', 'broken', 'flagstone'], rubble: ['ruins', 'broken'],
  ash: ['cinder', 'burnt'], burnt: ['ash', 'cinder', 'scorched']
};

const words = (text) => String(text == null ? '' : text).toLowerCase().match(/[a-z]{3,}/g) || [];

// "marsh" and "marshland", "forest" and "forests": same word if they agree on
// their first five letters and both have that many. Shorter words must match.
const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/* What a ground answers to: its name, its subtitle, what it was made from, its id. */
function groundWords(g) {
  const out = new Set();
  const add = (t) => { for (const w of words(t)) if (!STOP.has(w)) out.add(w); };
  // The flavour text (`desc`) is left out on purpose: "wherever the rock has
  // broken" is atmosphere, and matching it made "ruins" name the desert.
  add(g.name); add(g.subtitle); add(g.prompt);
  add(String(g.id || '').replace(/[_-]+/g, ' '));
  return [...out];
}

/* How well the prompt names a ground: the number of its words (and their
   synonyms) that the prompt uses. Name words count double, since a ground
   called "Fen" is saying what it is. */
function scoreGround(tokens, g) {
  const own = groundWords(g);
  const nameWords = new Set(words(g.name).filter((w) => !STOP.has(w)));
  let score = 0;
  for (const t of tokens) {
    const set = [t, ...(SYNONYMS[t] || [])];
    let hit = false, inName = false;
    for (const w of own) {
      if (set.some((x) => same(x, w))) { hit = true; if (nameWords.has(w)) inName = true; }
    }
    if (hit) score += inName ? 2 : 1;
  }
  return score;
}

const LIST = (s) => s.split(/\s+/).filter(Boolean);
const FOLIAGE = LIST('forest forests woods woodland trees jungle undergrowth bushes shrubs scrub thicket thickets foliage overgrown canopy reeds grass grassland brush smoke mist fog haze steam spores');
const COVER_WORDS = [
  { cover: 'furniture', words: LIST('ruins ruined rubble debris wreck wreckage furniture tables table benches bench altar altars sarcophagus sarcophagi bookshelves junk') },
  { cover: 'barrels', words: LIST('crates crate cargo supplies stacks barrels barrel casks cask kegs sacks') },
  { cover: 'low', words: LIST('barricades barricade trenches trench fences fence railings low walls wall hedges hedgerows') },
  { cover: 'pillar', words: LIST('boulders boulder rocks pillars pillar columns standing stones statues statue crags outcrops stalagmites') }
];
const COVER_GENERIC = LIST('cover');
const HAZARD_WORDS = [
  { hazard: 'fire', words: LIST('fire fires burning flames blaze inferno ablaze') },
  { hazard: 'poison', words: LIST('poison poisonous gas fumes miasma spores cloudkill stinking') },
  { hazard: 'acid', words: LIST('acid acidic corrosive slime ooze') },
  { hazard: 'lava', words: LIST('lava magma molten') },
  { hazard: 'spikes', words: LIST('pit pits spikes spiked traps trap chasm') },
  { hazard: 'arcane', words: LIST('glyph glyphs runes magic magical arcane warded ward sigil sigils') }
];
const RIVER = LIST('river rivers stream streams creek canal canals brook channel');
const ROAD = LIST('road roads highway path paths trail trails track tracks lane causeway street');
const WATERISH = LIST('water river lake flooded wet marsh swamp fen bog mud stream');
const ROADISH = LIST('road path paving cobbles cobblestone flagstone street track stone');

const DENSE = LIST('dense thick heavy overgrown choked deep lots littered packed');
const SPARSE = LIST('sparse thin light few scattered occasional patchy');
const WIDE = LIST('wide broad vast huge large sprawling great immense');
const FINE = LIST('small tiny fine patchwork mottled speckled');
const RAGGED = LIST('ragged wild natural organic rough irregular jagged');
const NEAT = LIST('neat regular geometric straight tidy clean ordered');

const has = (tokens, list) => tokens.some((t) => list.some((w) => same(t, w)));

/* Reads the prompt against the grounds on offer. Returns what it understood,
   as numbers the generator uses and sentences the GM reads. */
export function readTerrainPrompt(text, grounds = []) {
  const raw = words(text);
  const tokens = raw.filter((w) => !STOP.has(w));
  const dense = has(raw, DENSE), sparse = has(raw, SPARSE);
  const level = dense ? 1 : sparse ? 0.45 : 0.7;     // 1 = full, 0.45 = a third
  const out = {
    weights: {}, named: [], notes: [],
    foliage: null, cover: null, hazard: null, band: null,
    roughness: has(raw, RAGGED) ? 4 : has(raw, NEAT) ? 0 : 2,
    size: has(raw, WIDE) ? 'large' : has(raw, FINE) ? 'small' : null
  };

  // Which grounds the words name.
  for (const g of grounds) {
    const score = scoreGround(tokens, g);
    if (score > 0) { out.weights[g.id] = 1 + 3 * score; out.named.push(g.id); }
  }

  // Foliage, and the density it is laid at. `obscuring` ids are light,
  // medium, heavy.
  const foliageWords = tokens.filter((t) => FOLIAGE.some((w) => same(t, w)));
  if (foliageWords.length) {
    const heavy = dense || foliageWords.some((t) => same(t, 'jungle') || same(t, 'canopy') || same(t, 'overgrown'));
    const thin = sparse || foliageWords.every((t) => ['smoke', 'mist', 'fog', 'haze', 'steam', 'grass', 'reeds'].some((w) => same(t, w)));
    const id = heavy ? 'heavy' : thin ? 'light' : 'medium';
    // How much of the ground it covers: the bigger the word, the bigger the
    // share. Never all of it, or there is no ground left to see.
    out.foliage = { id, share: dense ? 0.34 : sparse ? 0.1 : 0.2 };
    out.notes.push(`Foliage: ${OBSCURING.find((o) => o.id === id).name.toLowerCase()}, about ${Math.round(out.foliage.share * 100)}% of the ground.`);
  }

  // Cover: which kind, and how thick. Several kinds named gives a mix.
  const coverKinds = [];
  for (const c of COVER_WORDS) if (has(tokens, c.words)) coverKinds.push(c.cover);
  if (!coverKinds.length && has(tokens, COVER_GENERIC)) coverKinds.push('barrels', 'low');
  if (coverKinds.length) {
    out.cover = { kinds: coverKinds, share: dense ? 0.12 : sparse ? 0.02 : 0.05 };
    out.notes.push(`Cover: ${coverKinds.map((id) => COVER_TYPES.find((c) => c.id === id).name.toLowerCase()).join(', ')}, about ${Math.round(out.cover.share * 100)}% of the squares.`);
  }

  // Hazards, in small patches.
  const hazards = [];
  for (const h of HAZARD_WORDS) if (has(tokens, h.words)) hazards.push(h.hazard);
  if (hazards.length) {
    out.hazard = { kinds: hazards, share: dense ? 0.07 : sparse ? 0.01 : 0.03 };
    out.notes.push(`Hazards: ${hazards.map((id) => HAZARD_TYPES.find((h) => h.id === id).name.toLowerCase()).join(', ')}.`);
  }

  // A winding band across the whole area.
  const river = has(tokens, RIVER), road = !river && has(tokens, ROAD);
  if (river || road) {
    const lexicon = river ? WATERISH : ROADISH;
    let pickId = null, top = 0;
    for (const g of grounds) {
      const s = scoreGround(lexicon, g);
      if (s > top) { top = s; pickId = g.id; }
    }
    out.band = { kind: river ? 'river' : 'road', ground: pickId, width: has(raw, WIDE) ? 4 : 2 };
  }

  if (out.named.length) {
    const names = out.named.map((id) => (grounds.find((g) => g.id === id) || {}).name || id);
    out.notes.unshift(`Grounds it names: ${names.join(', ')}.`);
  }
  return out;
}

/* ------------------------------ the generator ------------------------------ */

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// Cuts a box into regions by repeated halving, stopping at a size that varies
// from leaf to leaf, so the patches are uneven rather than a chessboard.
function carve(box, rng, min, max, out) {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const tooBig = w > max || h > max;
  const canV = w >= min * 2, canH = h >= min * 2;
  // Below the maximum a region is split now and then anyway, which is what
  // gives a range of sizes instead of every patch being the same.
  if (!(canV || canH) || (!tooBig && rng() < 0.45)) { out.push(box); return out; }
  const vertical = canV && canH ? (w > h * 1.2 ? true : h > w * 1.2 ? false : rng() < 0.5) : canV;
  if (vertical) {
    const at = randInt(rng, box.x0 + min - 1, box.x1 - min);
    carve({ ...box, x1: at }, rng, min, max, out);
    carve({ ...box, x0: at + 1 }, rng, min, max, out);
  } else {
    const at = randInt(rng, box.y0 + min - 1, box.y1 - min);
    carve({ ...box, y1: at }, rng, min, max, out);
    carve({ ...box, y0: at + 1 }, rng, min, max, out);
  }
  return out;
}

const weightedPick = (rng, weights) => {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
};

/* Lays terrain over a map. Returns the layers to merge into it, with the new
   ones already merged over the old (so the caller can write them straight in),
   never a whole map: the deck, the doors and the calibration are not this
   module's to touch.

   grounds   every ground on offer: [{ id, name, subtitle?, desc?, prompt? }]
   palette   the ids the GM ticked
   prompt    what they wrote
   seed, size ('auto' | 'small' | 'medium' | 'large'), scope (see above) */
export function generateTerrain({ map, grounds = [], palette = [], prompt = '', seed, size = 'auto', scope = 'deck', style = 'dungeon' } = {}) {
  const m = readMap(map);
  const s = seed == null || seed === '' ? newSeed() : seed;
  const rng = makeRng(s);
  const read = readTerrainPrompt(prompt, grounds);
  const sizing = terrainSizeById(size === 'auto' ? (read.size || 'auto') : size);

  // The grounds in play: those ticked, plus any the prompt names, or just the
  // deck's own when there is nothing else to choose from.
  const known = new Set([m.theme, ...grounds.map((g) => g.id)]);
  const ids = [];
  for (const id of [...palette, ...read.named]) if (known.has(id) && !ids.includes(id)) ids.push(id);
  if (!ids.length) ids.push(m.theme);
  // The river or road is made of a ground too, which may not be one of those.
  if (read.band && read.band.ground && !ids.includes(read.band.ground)) ids.push(read.band.ground);
  const weights = ids.map((id) => read.weights[id] || 1);

  // Where it goes.
  const W = m.cols, H = m.rows;
  const hasFloor = Object.keys(m.floor).length > 0;

  /* A BLANK DECK USED TO COME BACK AS A SOLID RECTANGLE.

     With nothing painted there was nothing to paint ON, so this laid deck
     across every square of the grid and dressed it — which is terrain, but it
     is not a MAP: no rooms, no corridors, no doors, nothing to fight over.
     One press of Generate terrain produced a filled box.

     So a blank deck gets a layout first, from the same binary partition the
     Deck panel uses, and the terrain is painted onto THAT. The regions, the
     roughened seams, the river and the sowing all work exactly as before;
     they are simply laid over rooms and corridors instead of over a slab.

     "The whole grid" still fills everything, because that is what it says and
     it is how a landscape with no structure at all is made. */
  const built = !hasFloor && scope !== 'grid'
    ? generateDeck({ cols: W, rows: H, style, seed: s })
    : null;
  const base = built ? built.floor : m.floor;
  const lay = scope === 'grid';
  const wants = lay ? () => true
    : (k) => Boolean(base[k]) && (scope !== 'free' || !m.ground[k]);
  let box = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  if (!lay) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of Object.keys(base)) {
      const p = parseKey(k);
      if (!p || !wants(k)) continue;
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    if (!Number.isFinite(x0)) return { empty: true, seed: s, notes: read.notes, floor: m.floor, doors: m.doors, ground: m.ground, obscuring: m.obscuring, cover: m.cover, hazards: m.hazards, laid: false, built: false };
    box = { x0, y0, x1, y1 };
  }

  // Regions, each given a ground by weight.
  const cell = new Int16Array(W * H).fill(-1);
  const regions = carve(box, rng, sizing.min, sizing.max, []);
  let area = 0;
  for (const r of regions) {
    const g = weightedPick(rng, weights);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (!lay && !wants(x + ',' + y)) continue;
        cell[y * W + x] = g;
        area++;
      }
    }
  }

  // Roughen the seams: a few passes in which squares sometimes take the
  // ground of a neighbour. Only ever between squares that are in the area.
  for (let pass = 0; pass < read.roughness; pass++) {
    const next = cell.slice();
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const i = y * W + x;
        if (cell[i] < 0 || rng() > 0.32) continue;
        const d = Math.floor(rng() * 4);
        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (cell[j] >= 0) next[i] = cell[j];
      }
    }
    cell.set(next);
  }

  // A river or a road: a winding walk from one side of the area to the other,
  // painted a few squares wide.
  let band = 0;
  if (read.band) {
    const bi = ids.indexOf(read.band.ground);
    // With no ground that answers to "river", the band is the ground least
    // likely elsewhere, so that it shows.
    const fallback = weights.indexOf(Math.min(...weights));
    const g = bi >= 0 ? bi : fallback;
    const horizontal = (box.x1 - box.x0) >= (box.y1 - box.y0);
    let x = horizontal ? box.x0 : randInt(rng, box.x0, box.x1);
    let y = horizontal ? randInt(rng, box.y0, box.y1) : box.y0;
    const r = Math.max(1, Math.floor(read.band.width / 2));
    const stop = horizontal ? box.x1 : box.y1;
    let guard = 0;
    while ((horizontal ? x : y) <= stop && guard++ < (W + H) * 6) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx * dx + dy * dy > r * r + 1) continue;
          const px = x + dx, py = y + dy;
          if (px < box.x0 || py < box.y0 || px > box.x1 || py > box.y1) continue;
          if (cell[py * W + px] >= 0) { cell[py * W + px] = g; band++; }
        }
      }
      // Mostly onward, sometimes sideways: a bend, never a drawn line.
      const side = rng() < 0.45;
      if (horizontal) { if (side) y = Math.max(box.y0, Math.min(box.y1, y + (rng() < 0.5 ? -1 : 1))); else x++; }
      else if (side) x = Math.max(box.x0, Math.min(box.x1, x + (rng() < 0.5 ? -1 : 1)));
      else y++;
    }
  }

  // The layers, merged over what was there.
  const ground = { ...m.ground };
  const floor = lay ? { ...m.floor } : built ? { ...built.floor } : null;
  const cells = [];                 // [x, y] of every square in play, for the sowing below
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const g = cell[y * W + x];
      if (g < 0) continue;
      const k = x + ',' + y;
      if (ids[g] === m.theme) delete ground[k]; else ground[k] = ids[g];
      if (floor) floor[k] = true;
      cells.push(x, y);
    }
  }
  const n = cells.length / 2;

  const obscuring = { ...m.obscuring };
  const cover = { ...m.cover };
  const hazards = { ...m.hazards };
  const free = (k) => !m.doors[k] && !m.markers[k];
  const randomCell = () => { const i = Math.floor(rng() * n) * 2; return { x: cells[i], y: cells[i + 1] }; };
  const inPlay = (x, y) => x >= 0 && y >= 0 && x < W && y < H && cell[y * W + x] >= 0;

  // Foliage in blobs, drawn toward ground that answers to the same words.
  let foliageSquares = 0;
  if (read.foliage && n) {
    const target = n * read.foliage.share;
    let guard = 0;
    while (foliageSquares < target && guard++ < 4000) {
      const c = randomCell();
      const r = randInt(rng, 2, 5);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx * dx + dy * dy > r * r * (0.55 + 0.7 * rng())) continue;
          const x = c.x + dx, y = c.y + dy;
          if (!inPlay(x, y)) continue;
          const k = x + ',' + y;
          if (!free(k) || obscuring[k]) continue;
          obscuring[k] = read.foliage.id;
          foliageSquares++;
        }
      }
    }
  }

  // Cover: single squares and short runs, never on a door or a marker.
  let coverSquares = 0;
  if (read.cover && n) {
    const target = Math.round(n * read.cover.share);
    let guard = 0;
    while (coverSquares < target && guard++ < target * 6 + 50) {
      let { x, y } = randomCell();
      const kind = read.cover.kinds[Math.floor(rng() * read.cover.kinds.length)];
      const run = randInt(rng, 1, 3);
      for (let i = 0; i < run; i++) {
        const k = x + ',' + y;
        if (inPlay(x, y) && free(k) && !cover[k]) { cover[k] = kind; coverSquares++; }
        if (rng() < 0.5) x += rng() < 0.5 ? 1 : -1; else y += rng() < 0.5 ? 1 : -1;
      }
    }
  }

  // Hazards in small patches.
  let hazardSquares = 0;
  if (read.hazard && n) {
    const target = Math.max(1, Math.round(n * read.hazard.share));
    let guard = 0;
    while (hazardSquares < target && guard++ < 2000) {
      const c = randomCell();
      const kind = read.hazard.kinds[Math.floor(rng() * read.hazard.kinds.length)];
      const r = randInt(rng, 1, 3);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = c.x + dx, y = c.y + dy;
          const k = x + ',' + y;
          if (inPlay(x, y) && free(k) && !hazards[k]) { hazards[k] = kind; hazardSquares++; }
        }
      }
    }
  }

  return {
    seed: s, empty: false, laid: Boolean(floor), built: Boolean(built),
    ground: keepClean(m.ground, ground),
    floor: floor ? keepClean(m.floor, floor) : m.floor,
    // The doors of the layout this built, if it built one. A deck's doors are
    // part of its structure, not its terrain, so they only ever come from here
    // when there was no structure to begin with.
    doors: built ? built.doors : m.doors,
    // A COUNT, not the rooms themselves: generateDeck hands back the room
    // boxes and only the number of them is wanted here.
    rooms: built && Array.isArray(built.rooms) ? built.rooms.length : 0,
    obscuring: keepClean(m.obscuring, obscuring),
    cover: keepClean(m.cover, cover),
    hazards: keepClean(m.hazards, hazards),
    notes: read.notes,
    counts: { squares: n, regions: regions.length, grounds: ids.length, foliage: foliageSquares, cover: coverSquares, hazards: hazardSquares, band },
    used: ids
  };
}

