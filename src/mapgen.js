/* Generating a deck.

   WHY BSP AND NOT A CAVE. The fog of war in this app is not a radius — it is
   rooms. regionAt() flood-fills the floor and stops only at doors, so one
   click reveals one room and shutting a door takes the room beyond it off the
   board. A generator that produces one undivided blob of floor
   therefore produces a deck where the first fog click reveals everything.

   Binary space partitioning is the generator whose output IS that structure:
   it cuts the grid into non-overlapping boxes, drops a room in each, and the
   places where the connecting corridors meet the rooms are exactly where a
   door belongs. It also happens to be what a dungeon is — chambers behind
   doors — so the bias of the algorithm is the thing being modelled rather
   than something to fight.

   THE RANDOM WALK IS STILL HERE, demoted to the job it is good at: carving
   the corridor between two rooms. Biased toward its target so it always
   arrives, but free to take the other axis on the way, which is what gives a
   corridor its kink instead of a drawn L.

   CELLULAR AUTOMATA IS DELIBERATELY ABSENT. Caves belong to the natural
   grounds, and they need their own answer to the fog problem before they are
   worth adding — an undivided cavern wants chokepoints found and turned into
   doors, or a radius fog, and neither is this module's business yet.

   Pure, and seeded. See mapgen.check.mjs. */

import { cellKey, parseKey, readMap, keepClean, MIN_GRID, MAX_GRID } from './battlemap.js';

/* ------------------------------- the seed -------------------------------

   SEEDED, NEVER Math.random. A deck is saved, published to the projector
   window and edited afterwards. A deck that cannot be produced again from
   what is written on it is a deck that cannot be recovered when an edit goes
   wrong, and "generate until it looks right again" is not recovery. */

// FNV-1a over the text form, so a seed may be typed. Any string, any number,
// and nothing — which still has to give a usable generator rather than NaN.
export function hashSeed(v) {
  const s = String(v == null ? '' : v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small, fast, and good enough for laying out rooms. The point
// is reproducibility, not cryptography.
export function makeRng(seed) {
  let a = hashSeed(seed);
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A fresh seed for the UI. Short and typeable, because it is meant to be
   written on a scrap of paper beside the map and typed back in. */
export function newSeed() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ------------------------------- the styles ------------------------------

   Not decoration: each one is a different shape of fight. Compartments the
   size of a great hall play nothing like a warren of burial cells, and the door
   kind decides whether getting through is an action or a job. */
export const DECK_STYLES = [
  {
    id: 'dungeon', name: 'Dungeon',
    note: 'Regular rooms behind wooden and iron doors. The standard crawl.',
    minLeaf: 7, margin: [1, 2], depth: 4, doorKinds: ['wooden', 'wooden', 'iron'],
    straightness: 0.82
  },
  {
    id: 'catacombs', name: 'Catacombs',
    note: 'Many small burial cells and crawlways. Trapdoors and low doors — it is all shortcuts.',
    /* THE MARGIN IS NEVER ZERO. At [0,1] the rooms either side of a cut
       touched, merged into one blob of floor, and a warren of cells became a
       warren-shaped open plan: one fog click took a third of the deck. The
       margin is the wall, and a compartment without one is not a
       compartment. */
    minLeaf: 5, margin: [1, 1], depth: 5, doorKinds: ['trapdoor', 'wooden', 'wooden'],
    straightness: 0.55
  },
  {
    id: 'caverns', name: 'Caverns',
    note: 'Few large chambers joined by long wandering runs. Open ground and dead ends.',
    minLeaf: 11, margin: [1, 3], depth: 3, doorKinds: ['wooden', 'trapdoor'],
    straightness: 0.6
  }
];

export const styleById = (id) =>
  DECK_STYLES.find((s) => s.id === id) || DECK_STYLES[0];

const clampGrid = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_GRID, Math.max(MIN_GRID, n)) : fallback;
};

/* How many times to cut. The style's own depth suits a deck of ordinary size
   and is what a 30 x 20 grid has always got; a bigger grid needs more cuts
   or it comes out as sixteen enormous rooms however large it is. Enough that
   a leaf stays about the size the style likes: this only ever adds cuts, so
   an ordinary deck is generated exactly as it was. */
const depthFor = (st, w, h) => {
  const target = st.minLeaf * 2.2;
  const levels = Math.ceil(Math.log2(Math.max(1, (w / target) * (h / target))));
  return Math.max(st.depth, levels);
};

/* ------------------------------ partitioning -----------------------------

   Rectangles are inclusive of both corners, because every other piece of
   grid arithmetic in this app is and mixing the two conventions is how off-
   by-one walls appear. */

function partition(rect, rng, style, depth, out) {
  const w = rect.x1 - rect.x0 + 1;
  const h = rect.y1 - rect.y0 + 1;
  const min = style.minLeaf;

  // Too small to halve, or deep enough: this is a leaf.
  if (depth <= 0 || (w < min * 2 && h < min * 2)) {
    out.push(rect);
    return out;
  }

  // Cut the long way, so compartments stay roughly square rather than
  // degenerating into corridors that are accidentally rooms.
  const canV = w >= min * 2;
  const canH = h >= min * 2;
  const vertical = canV && canH
    ? (w > h * 1.25 ? true : h > w * 1.25 ? false : rng() < 0.5)
    : canV;

  if (vertical) {
    const at = randInt(rng, rect.x0 + min - 1, rect.x1 - min);
    partition({ ...rect, x1: at }, rng, style, depth - 1, out);
    partition({ ...rect, x0: at + 1 }, rng, style, depth - 1, out);
  } else {
    const at = randInt(rng, rect.y0 + min - 1, rect.y1 - min);
    partition({ ...rect, y1: at }, rng, style, depth - 1, out);
    partition({ ...rect, y0: at + 1 }, rng, style, depth - 1, out);
  }
  return out;
}

// A room inside its box, inset by a margin. The margin is what leaves the
// void between compartments that the walls are derived from — with no margin
// the rooms meet and the deck is one rectangle again.
function roomIn(rect, rng, style) {
  const [lo, hi] = style.margin;
  const inset = () => randInt(rng, lo, hi);
  let x0 = rect.x0 + inset(), x1 = rect.x1 - inset();
  let y0 = rect.y0 + inset(), y1 = rect.y1 - inset();
  // A margin that ate the room gives it back: a 1x1 compartment is a
  // cupboard, not a room, and it still has to be connectable.
  if (x1 - x0 < 1) { x0 = rect.x0; x1 = Math.min(rect.x1, rect.x0 + 1); }
  if (y1 - y0 < 1) { y0 = rect.y0; y1 = Math.min(rect.y1, rect.y0 + 1); }
  return { x0, y0, x1, y1 };
}

const centreOf = (r) => ({
  x: Math.floor((r.x0 + r.x1) / 2),
  y: Math.floor((r.y0 + r.y1) / 2)
});

/* The random walk, doing the one job it is good at. Biased toward the target
   so it always arrives — an unbiased drunkard's walk between two points on a
   200-square deck is a very long wait — but free to take the other axis,
   which is the difference between a corridor and a drawn L. */
function carveWalk(floor, from, to, rng, straightness, steer = null) {
  let x = from.x, y = from.y;
  let guard = 0;
  const limit = 4 * (MAX_GRID * 2);
  const path = [];
  while ((x !== to.x || y !== to.y) && guard++ < limit) {
    floor[cellKey(x, y)] = true;
    path.push({ x, y });
    const dx = Math.sign(to.x - x);
    const dy = Math.sign(to.y - y);
    // With one axis already satisfied there is no choice to make, which is
    // also what guarantees this terminates: every step closes the distance.
    let moveX = dx === 0 ? false : dy === 0 ? true : rng() < straightness;
    // Growing a deck, a corridor must not run along the wall of what is
    // already there: that opens the old room into it for its whole length.
    // Both candidate steps close the distance, so taking the other one when
    // the first is hugging something costs nothing and still arrives.
    if (steer && dx !== 0 && dy !== 0) {
      const cx = moveX ? x + dx : x, cy = moveX ? y : y + dy;
      const ox = moveX ? x : x + dx, oy = moveX ? y + dy : y;
      if (steer(cx, cy) && !steer(ox, oy)) moveX = !moveX;
    }
    if (moveX) x += dx; else y += dy;
  }
  floor[cellKey(to.x, to.y)] = true;
  path.push({ x: to.x, y: to.y });
  return path;
}

/* ------------------------------- the doors -------------------------------

   This is the part that makes the deck playable rather than merely drawn.
   Every place a corridor meets a room gets exactly one door, so regionAt()
   stops there and the room is its own region.

   Found by walking the ring just outside each room: a cell out there that is
   floor, with floor directly inside it, is an opening. Consecutive openings
   along one side are ONE doorway, not three, so the middle of each run is
   where the door goes. */
function placeDoors(floor, rooms, rng, style) {
  const doors = {};
  const isFloor = (x, y) => Boolean(floor[cellKey(x, y)]);

  for (const r of rooms) {
    const sides = [
      // along the top, standing one above it
      { fixed: r.y0 - 1, from: r.x0, to: r.x1, horizontal: true, inward: 1 },
      { fixed: r.y1 + 1, from: r.x0, to: r.x1, horizontal: true, inward: -1 },
      { fixed: r.x0 - 1, from: r.y0, to: r.y1, horizontal: false, inward: 1 },
      { fixed: r.x1 + 1, from: r.y0, to: r.y1, horizontal: false, inward: -1 }
    ];
    for (const s of sides) {
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const mid = run[Math.floor(run.length / 2)];
        doors[cellKey(mid.x, mid.y)] = {
          kind: pick(rng, style.doorKinds),
          // Closed, because a generated deck is one nobody has walked yet.
          state: 'closed'
        };
        run = [];
      };
      for (let i = s.from; i <= s.to; i++) {
        const x = s.horizontal ? i : s.fixed;
        const y = s.horizontal ? s.fixed : i;
        const ix = s.horizontal ? x : x + s.inward;
        const iy = s.horizontal ? y + s.inward : y;
        if (isFloor(x, y) && isFloor(ix, iy)) run.push({ x, y });
        else flush();
      }
      flush();
    }
  }
  return doors;
}

/* --------------------------------- the deck -------------------------------

   Returns the layers to merge into a map, never a whole map: the caller owns
   the theme, the calibration and everything else on the deck it is replacing,
   and a generator that returned those too would quietly reset them. */
export function generateDeck({ cols, rows, style, seed } = {}) {
  const st = styleById(style);
  const w = clampGrid(cols, 30);
  const h = clampGrid(rows, 20);
  const s = seed == null || seed === '' ? newSeed() : seed;
  const rng = makeRng(s);

  // One square of margin all round, so the outermost rooms have a wall
  // rather than running off the edge of the grid.
  const leaves = partition({ x0: 1, y0: 1, x1: w - 2, y1: h - 2 }, rng, st, depthFor(st, w, h), []);
  const rooms = leaves.map((r) => roomIn(r, rng, st));

  const floor = {};
  for (const r of rooms) {
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        if (x >= 0 && y >= 0 && x < w && y < h) floor[cellKey(x, y)] = true;
      }
    }
  }

  /* Connected in a chain through the leaf order. BSP emits leaves in
     depth-first order, so neighbours in that list are neighbours on the
     deck, and a chain over them is a spanning tree — every room reachable,
     no room sealed. Checked, because "generated a room nobody can enter" is
     the failure that ruins a session rather than looking wrong. */
  for (let i = 1; i < rooms.length; i++) {
    carveWalk(floor, centreOf(rooms[i - 1]), centreOf(rooms[i]), rng, st.straightness);
  }

  const doors = placeDoors(floor, rooms, rng, st);
  return { floor, doors, rooms, seed: s, style: st.id, cols: w, rows: h };
}

/* ----------------------------- building around ----------------------------

   GROWING A DECK IS NOT REPEATING IT. Expand used to tile the current grid
   across the new one, flipped at the seams, and on a deck that did not fill
   its grid that meant two copies of the same rooms with a void between them:
   a deck with a mirror image of itself bolted on. It could not know what was
   already built, so everything it added ignored it.

   This starts from what IS built. The painted deck stays exactly where it is,
   untouched, and the generator fills the rest of the grid — the new space
   and any empty ground inside the old — with rooms cut by the same binary
   partition the plain generator uses, each kept clear of the old walls. Every
   new room is then joined, nearest first, to the nearest thing already
   connected, beginning with the old deck's own outline, so the new deck grows
   off the old one the way a wing is added to a keep rather than starting beside it.

   WHAT IS PAINTED IS CARRIED ON. A new room takes the ground of whatever it
   was joined to, so a map laid on an ice shelf grows more ice shelf and a
   fen grows more fen, and a door goes wherever a new corridor meets an old
   room, which is what the fog of war needs to treat it as a room of its own.

   Pure and seeded, like generateDeck, and it returns a whole map because it
   has to: it changes the grid, the deck, the doors and the ground together. */

// How many squares of void a new room keeps from the old deck. Two, so the
// walls between them are walls rather than one fat wall.
const BUILD_GAP = 2;

export function growDeck(map, { cols, rows, style, seed } = {}) {
  const src = readMap(map);
  // Growing only. A grid that would shrink is the caller's old crop, and
  // building around something that is being cut off makes no sense.
  const w = Math.max(src.cols, clampGrid(cols, src.cols));
  const h = Math.max(src.rows, clampGrid(rows, src.rows));
  const st = styleById(style);
  const s = seed == null || seed === '' ? newSeed() : seed;
  const rng = makeRng(s);

  const old = src.floor;
  const oldCount = Object.keys(old).length;
  if (!oldCount) {
    // Nothing to build around, so this is just a deck.
    const g = generateDeck({ cols: w, rows: h, style: st.id, seed: s });
    return {
      map: {
        ...src, cols: w, rows: h,
        floor: keepClean(src.floor, g.floor),
        doors: keepClean(src.doors, { ...src.doors, ...g.doors })
      },
      seed: s, style: st.id, rooms: g.rooms.length, joined: 0, added: Object.keys(g.floor).length
    };
  }

  const isOld = (x, y) => Boolean(old[x + ',' + y]);
  // Anything of the old deck within `r` squares (Chebyshev) of this square.
  const nearOld = (x, y, r) => {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) if (isOld(x + dx, y + dy)) return true;
    }
    return false;
  };
  const rectNearOld = (r, gap) => {
    for (let x = r.x0 - gap; x <= r.x1 + gap; x++) {
      for (let y = r.y0 - gap; y <= r.y1 + gap; y++) if (isOld(x, y)) return true;
    }
    return false;
  };

  // The rooms: the plain BSP over the whole new grid, minus any that would
  // sit on or against the old deck. A room that is too close is shrunk a few
  // times before it is given up on, so the new deck reaches right up to the
  // old one rather than leaving a ring of nothing round it.
  const leaves = partition({ x0: 1, y0: 1, x1: w - 2, y1: h - 2 }, rng, st, depthFor(st, w, h), []);
  const rooms = [];
  for (const leaf of leaves) {
    let r = roomIn(leaf, rng, st);
    for (let shrink = 0; shrink <= 3 && rectNearOld(r, BUILD_GAP); shrink++) {
      r = { x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 };
      if (r.x1 - r.x0 < 1 || r.y1 - r.y0 < 1) { r = null; break; }
    }
    if (r && !rectNearOld(r, BUILD_GAP)) rooms.push(r);
  }

  // The old deck's outline: the squares of floor with void beside them. These
  // are what a new corridor can attach to. Thinned on a very big deck, since
  // the nearest of four thousand is as good as the nearest of forty thousand.
  let outline = [];
  for (const k of Object.keys(old)) {
    const p = parseKey(k);
    if (!p) continue;
    if (!isOld(p.x + 1, p.y) || !isOld(p.x - 1, p.y) || !isOld(p.x, p.y + 1) || !isOld(p.x, p.y - 1)) {
      outline.push({ x: p.x, y: p.y });
    }
  }
  if (outline.length > 4000) {
    const stride = Math.ceil(outline.length / 4000);
    outline = outline.filter((_, i) => i % stride === 0);
  }

  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const floor = { ...old };
  const ground = { ...src.ground };
  const junctions = [];      // where a corridor meets the old deck
  const roomGround = new Array(rooms.length);
  const centres = rooms.map(centreOf);

  // Nearest-first joining. Each unjoined room remembers the closest thing it
  // could be joined to; when a room is joined it offers itself (its middle and
  // the middle of each side) to the rest. Cheap enough for a thousand rooms.
  const best = centres.map((c) => {
    let b = null;
    for (const t of outline) {
      const d = dist(c, t);
      if (!b || d < b.d) b = { d, t, old: true };
    }
    return b;
  });
  const joinedFlag = new Array(rooms.length).fill(false);
  let joined = 0;
  const steer = (x, y) => nearOld(x, y, 1);

  for (let n = 0; n < rooms.length; n++) {
    let pick = -1;
    for (let i = 0; i < rooms.length; i++) {
      if (joinedFlag[i] || !best[i]) continue;
      if (pick < 0 || best[i].d < best[pick].d) pick = i;
    }
    if (pick < 0) break;
    const b = best[pick];
    const from = centres[pick];
    // A corridor that has to leave a room goes from its middle; the walk is
    // steered off the old walls everywhere except right at its target.
    const near = (x, y) => (Math.abs(x - b.t.x) + Math.abs(y - b.t.y) > 2) && steer(x, y);
    const path = carveWalk(floor, from, b.t, rng, st.straightness, near);

    // The room fills in, and takes the ground of what it was joined to.
    const r = rooms[pick];
    const gid = b.old ? src.ground[b.t.x + ',' + b.t.y] : roomGround[b.room];
    roomGround[pick] = gid;
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        floor[x + ',' + y] = true;
        if (gid) ground[x + ',' + y] = gid;
      }
    }
    if (gid) for (const c of path) if (!isOld(c.x, c.y)) ground[c.x + ',' + c.y] = gid;
    if (b.old) {
      // The last square before the corridor walks onto old floor is the
      // doorway into it.
      const i = path.findIndex((c) => isOld(c.x, c.y));
      if (i > 0) junctions.push(path[i - 1]);
    }

    joinedFlag[pick] = true;
    joined++;
    // Offer this room, as it now stands, to every room still waiting.
    const offers = [centres[pick],
      { x: r.x0, y: centres[pick].y }, { x: r.x1, y: centres[pick].y },
      { x: centres[pick].x, y: r.y0 }, { x: centres[pick].x, y: r.y1 }];
    for (let i = 0; i < rooms.length; i++) {
      if (joinedFlag[i]) continue;
      for (const t of offers) {
        const d = dist(centres[i], t);
        if (!best[i] || d < best[i].d) best[i] = { d, t, old: false, room: pick };
      }
    }
  }

  const doors = { ...src.doors, ...placeDoors(floor, rooms.filter((_, i) => joinedFlag[i]), rng, st) };
  for (const j of junctions) {
    const k = j.x + ',' + j.y;
    if (doors[k]) continue;
    // One door per doorway: not if one is already beside it.
    const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => doors[(j.x + dx) + ',' + (j.y + dy)]);
    if (!beside) doors[k] = { kind: pick(rng, st.doorKinds), state: 'closed' };
  }

  return {
    map: {
      ...src, cols: w, rows: h,
      floor: keepClean(src.floor, floor),
      doors: keepClean(src.doors, doors),
      ground: keepClean(src.ground, ground)
    },
    seed: s, style: st.id,
    rooms: joined, joined,
    added: Object.keys(floor).length - oldCount
  };
}
