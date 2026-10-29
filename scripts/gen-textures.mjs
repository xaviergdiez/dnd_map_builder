/* Procedural floor textures for the ten built-in grounds.

     npm run textures              # -> public/maps/<id>.jpg, 1024px
     npm run textures -- --size 512 --only dungeon,cavern

   WHY THESE ARE MADE IN CODE. The grounds a DM generates in the app come from an
   image model (see TEXTURES.md); the built-in ten have to exist before there is
   a key, a network or a budget, and they have to tile, which a model cannot be
   trusted to do. Everything here is PERIODIC by construction — noise lattices
   and Voronoi points wrap at the tile edge — so a seam is impossible rather
   than merely unlikely, and scripts/gen-textures.check.mjs measures it anyway.

   They are stand-ins in the sense that a painted floor will beat them. Replace
   any of them with scripts/add-map-texture.sh and nothing else changes: the
   theme's five numbers (battlemap.js) were tuned to the AVERAGE of these, and
   `npm run textures -- --report` prints that average for a replacement.

   Seeded, so the same command writes the same files. */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------ randomness ------------------------------ */

// Integer hash to [0,1). Pure, so a lattice point always has the same value
// however it is reached — which is what lets the lattice wrap.
function hash(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

/* Value noise that repeats every `per` lattice cells (`perY` on y, if it is
   different, for grain stretched along a board), in [0,1). x and y are in
   lattice units, so a tile coordinate u in [0,1) is passed as u * per. */
export function vnoise(x, y, per, seed = 0, perY = per) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const px = (i) => mod(i, per), py = (i) => mod(i, perY);
  const a = hash(px(x0), py(y0), seed), b = hash(px(x0 + 1), py(y0), seed);
  const c = hash(px(x0), py(y0 + 1), seed), d = hash(px(x0 + 1), py(y0 + 1), seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

/* Fractal noise: octaves double the period each time, so it still wraps. */
export function fbm(u, v, per, oct = 4, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0, p = per;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * p, v * p, p, seed + o * 17);
    norm += amp; amp *= 0.5; p *= 2;
  }
  return sum / norm;
}

/* Worley (cellular) noise with `n` cells a side, wrapping. Returns the nearest
   and second-nearest feature distances (in cell units), the nearest cell's
   coordinates, and a per-cell random in [0,1). f2 - f1 is zero ON a cell edge,
   which is how mortar lines and cracks are drawn. `jitter` 0 is a regular grid,
   1 is fully irregular. */
export function worley(u, v, n, seed = 0, jitter = 1) {
  const x = u * n, y = v * n;
  const cx = Math.floor(x), cy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, nx = 0, ny = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = mod(gx, n), wy = mod(gy, n);
      const px = gx + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter;
      const py = gy + 0.5 + (hash(wx, wy, seed + 101) - 0.5) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = hash(wx, wy, seed + 202); nx = px - x; ny = py - y; }
      else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, edge: f2 - f1, id, nx, ny };
}

/* ------------------------------- colour ------------------------------- */

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lerpC = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scaleC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/* ------------------------------- grounds ------------------------------- */

/* Each returns [r,g,b] for a point (u,v) in [0,1)^2. They are written for the
   whole tile at once, never per-pixel state, so they wrap by construction.

   Values are held in the middle of the range on purpose (see TEXTURES.md): the
   grid, the tokens and the templates are drawn over these, and pure black
   loses the walls while pure white glares on a projector. */
export const GROUNDS = {
  dungeon(u, v) {
    // Flagstones: irregular Voronoi slabs, each its own grey, mortar on the seams.
    const w = worley(u, v, 7, 3, 0.8);
    const tone = 0.78 + 0.22 * w.id;
    const grain = fbm(u, v, 48, 3, 9);
    const stain = fbm(u, v, 5, 3, 21);
    let c = scaleC(lerpC(rgb('#4a4640'), rgb('#6c675d'), w.id), 0.8 + 0.4 * grain);
    c = lerpC(c, scaleC(rgb('#2a2a24'), 1), clamp01((stain - 0.55) * 1.6) * 0.5);   // damp
    const seam = clamp01(1 - w.edge / 0.09);
    c = lerpC(c, rgb('#1d1b17'), seam * 0.85);
    // a chipped, lighter lip just inside the seam
    c = lerpC(c, rgb('#8a8475'), clamp01(1 - Math.abs(w.edge - 0.13) / 0.04) * 0.18 * tone);
    return c;
  },

  catacombs(u, v) {
    // Marble slabs on a loose grid, veined, with bone dust in the joints.
    const w = worley(u, v, 5, 11, 0.25);
    const warp = fbm(u, v, 6, 3, 31);
    const vein = Math.abs(Math.sin((u * 9 + warp * 9) * Math.PI));
    const veins = clamp01(1 - vein * 6) * clamp01(fbm(u, v, 9, 2, 41) * 1.6 - 0.3);
    let c = lerpC(rgb('#8d9087'), rgb('#b3b4aa'), 0.35 + 0.5 * w.id);
    c = scaleC(c, 0.82 + 0.3 * fbm(u, v, 40, 3, 5));
    c = lerpC(c, rgb('#5f6660'), veins * 0.55);
    const seam = clamp01(1 - w.edge / 0.07);
    c = lerpC(c, rgb('#4b4a42'), seam * 0.8);
    c = lerpC(c, rgb('#c9c3ad'), clamp01(1 - Math.abs(w.edge - 0.1) / 0.05) * 0.2 * fbm(u, v, 30, 2, 51));
    return c;
  },

  cavern(u, v) {
    // Damp rock: ridged noise for crevices, smooth dark patches for wet stone.
    const r = 1 - Math.abs(fbm(u, v, 7, 5, 61) * 2 - 1);
    const rock = fbm(u, v, 24, 4, 71);
    let c = lerpC(rgb('#3f3a33'), rgb('#7d7467'), 0.25 + 0.6 * rock);
    c = scaleC(c, 0.75 + 0.4 * r);
    const crack = clamp01((r - 0.82) * 6);
    c = lerpC(c, rgb('#1c1915'), crack * 0.7);
    const wet = clamp01((fbm(u, v, 4, 3, 81) - 0.58) * 5);
    c = lerpC(c, rgb('#2e3a3c'), wet * 0.6);
    return c;
  },

  volcanic(u, v) {
    // Black basalt plates; the cracks between them glow.
    const w = worley(u, v, 6, 91, 0.95);
    const crust = fbm(u, v, 32, 4, 101);
    let c = lerpC(rgb('#241f1f'), rgb('#4a4240'), crust);
    c = scaleC(c, 0.8 + 0.4 * w.id);
    const glow = clamp01(1 - w.edge / 0.06);
    const hot = lerpC(rgb('#c2410c'), rgb('#ffb347'), clamp01(1 - w.edge / 0.025));
    c = lerpC(c, hot, glow * (0.6 + 0.4 * fbm(u, v, 14, 2, 111)));
    // ash drifted into the low ground
    c = lerpC(c, rgb('#6b6764'), clamp01((fbm(u, v, 5, 3, 121) - 0.6) * 3) * 0.35);
    return c;
  },

  tavern(u, v) {
    // Planks: eight to a tile, each its own tone, grain run along the board.
    const rows = 8;
    const row = mod(Math.floor(v * rows), rows);       // wrapped, or the tile is not periodic
    const t = hash(row, 0, 131);
    const stagger = hash(row, 1, 133);
    const bu = mod(u + stagger, 1);                       // boards are staggered
    const along = fbm(bu, v, 4, 2, 140 + row);
    // Grain runs along the board: slow across it, fast down its length. The y
    // period is the lattice's own (v * 192 wraps at 192), not the x one.
    const grain = vnoise(bu * 18, v * 192, 18, 150 + row, 192) * 0.6 + vnoise(bu * 42, v * 480, 42, 160 + row, 480) * 0.4;
    let c = lerpC(rgb('#4d321b'), rgb('#7d5a37'), 0.2 + 0.7 * t);
    c = scaleC(c, 0.8 + 0.35 * grain + 0.15 * along);
    // wear: pale down the middle of each board, where boots go
    const within = mod(v * rows, 1);
    c = lerpC(c, rgb('#a9835a'), clamp01(1 - Math.abs(within - 0.5) * 2.4) * 0.12 * along);
    // the gap between boards, and the butt joint at each end
    c = lerpC(c, rgb('#17100a'), clamp01((Math.abs(within - 0.5) - 0.455) * 40) * 0.9);
    const joint = Math.abs(bu - 0.5) * 2;
    c = lerpC(c, rgb('#17100a'), clamp01((joint - 0.985) * 80) * 0.9);
    // nail heads near each end
    for (const nx of [0.05, 0.95]) {
      // tile units: a board is 1/rows tall, so `within` is scaled back to them
      if (Math.hypot(bu - nx, (within - 0.5) / rows) < 0.003) c = lerpC(c, rgb('#2a2018'), 0.8);
    }
    return c;
  },

  forest(u, v) {
    // Soil under leaf litter: dark earth, scattered leaves, moss where it is damp.
    const soil = fbm(u, v, 14, 5, 171);
    let c = lerpC(rgb('#2a2118'), rgb('#4d3b27'), soil);
    // leaves: a dense small Voronoi, each cell a leaf-coloured blob with a soft edge
    const w = worley(u, v, 20, 181, 1);
    const leaf = clamp01(1 - w.f1 / (0.34 + 0.26 * w.id));
    const autumn = [rgb('#7a4a1e'), rgb('#6b5a22'), rgb('#4e5a26'), rgb('#5b3a1a')][Math.floor(w.id * 4) % 4];
    c = lerpC(c, scaleC(autumn, 0.75 + 0.5 * hash(Math.floor(w.id * 997), 7, 191)), leaf * 0.7);
    // moss
    const moss = clamp01((fbm(u, v, 5, 4, 201) - 0.5) * 3.2);
    c = lerpC(c, rgb('#3d5a2a'), moss * 0.55);
    return scaleC(c, 0.85 + 0.3 * fbm(u, v, 60, 2, 211));
  },

  swamp(u, v) {
    // Peat and standing water; the water is dark, smooth and slightly cold.
    const peat = fbm(u, v, 18, 5, 221);
    let c = lerpC(rgb('#22200f'), rgb('#56562f'), peat);
    const water = clamp01((fbm(u, v, 4, 4, 231) - 0.52) * 6);
    const sheen = 0.9 + 0.2 * fbm(u, v, 12, 2, 241);
    c = lerpC(c, scaleC(rgb('#2c3b38'), sheen), water * 0.88);
    // algae on the water, reed stubble on the land
    c = lerpC(c, rgb('#58703a'), water * clamp01((fbm(u, v, 16, 3, 251) - 0.55) * 4) * 0.6);
    const reeds = worley(u, v, 46, 261, 1);
    c = lerpC(c, rgb('#6b6a3a'), (1 - water) * clamp01(1 - reeds.f1 / 0.12) * 0.35);
    return c;
  },

  desert(u, v) {
    // Wind ripples over sand, with hardpan cracking through where it is thin.
    const warp = fbm(u, v, 5, 3, 271);
    const ripple = 0.5 + 0.5 * Math.sin((v * 26 + warp * 14) * Math.PI * 2 / 2);
    const grain = fbm(u, v, 80, 2, 281);
    let c = lerpC(rgb('#b98e57'), rgb('#dcb67c'), ripple * 0.7 + 0.3 * fbm(u, v, 10, 3, 291));
    c = scaleC(c, 0.9 + 0.2 * grain);
    const pan = clamp01((fbm(u, v, 3, 3, 301) - 0.58) * 4);
    const w = worley(u, v, 9, 311, 0.9);
    const crack = clamp01(1 - w.edge / 0.05);
    c = lerpC(c, lerpC(rgb('#9c7a4e'), rgb('#7a5c38'), w.id), pan * 0.8);
    c = lerpC(c, rgb('#4a3820'), pan * crack * 0.7);
    return c;
  },

  tundra(u, v) {
    // Pack snow with blue ice showing through, and frost cracks.
    const snow = fbm(u, v, 12, 5, 321);
    let c = lerpC(rgb('#c9d6dc'), rgb('#eef3f5'), snow);
    const ice = clamp01((fbm(u, v, 4, 4, 331) - 0.56) * 4.5);
    const w = worley(u, v, 8, 341, 0.9);
    c = lerpC(c, lerpC(rgb('#8fb3c4'), rgb('#6f9bb0'), w.id), ice * 0.85);
    c = lerpC(c, rgb('#d9eaf2'), ice * clamp01(1 - w.edge / 0.04) * 0.7);
    c = scaleC(c, 0.94 + 0.12 * fbm(u, v, 90, 2, 351));
    // wind-blown dark grit
    c = lerpC(c, rgb('#6a6f72'), clamp01((fbm(u, v, 70, 2, 361) - 0.72) * 5) * 0.4);
    return c;
  },

  cobbles(u, v) {
    // Rounded setts: each Voronoi cell is a domed stone, dirt packs the gaps.
    const w = worley(u, v, 11, 371, 0.6);
    const dome = clamp01(w.edge / 0.5);
    const tone = lerpC(rgb('#58544c'), rgb('#8c8678'), w.id);
    let c = scaleC(tone, 0.7 + 0.4 * Math.sqrt(dome) + 0.12 * (w.ny - w.nx) * 0.5);
    c = scaleC(c, 0.86 + 0.28 * fbm(u, v, 64, 3, 381));
    const gap = clamp01(1 - w.edge / 0.11);
    c = lerpC(c, lerpC(rgb('#2c261d'), rgb('#4a3d2c'), fbm(u, v, 40, 2, 391)), gap * 0.92);
    c = lerpC(c, rgb('#4b6a34'), gap * clamp01((fbm(u, v, 8, 3, 401) - 0.6) * 4) * 0.4);   // moss in the joints
    return c;
  }
};

/* ------------------------------ rendering ------------------------------ */

/* The whole tile as raw RGB, plus its mean colour — what themeNumbersFor() reads. */
export function render(id, size = 1024) {
  const fn = GROUNDS[id];
  if (!fn) throw new Error('no such ground: ' + id);
  const buf = Buffer.alloc(size * size * 3);
  let r = 0, g = 0, b = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = fn(x / size, y / size);
      const o = (y * size + x) * 3;
      buf[o] = Math.max(0, Math.min(255, c[0] | 0));
      buf[o + 1] = Math.max(0, Math.min(255, c[1] | 0));
      buf[o + 2] = Math.max(0, Math.min(255, c[2] | 0));
      r += buf[o]; g += buf[o + 1]; b += buf[o + 2];
    }
  }
  const n = size * size;
  return { buf, size, mean: { r: r / n, g: g / n, b: b / n } };
}

async function main() {
  const arg = (name, fb) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; };
  const size = Math.max(128, Math.min(2048, Number(arg('size', 1024))));
  const only = arg('only', '').split(',').filter(Boolean);
  const report = process.argv.includes('--report');
  const out = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'maps');
  await mkdir(out, { recursive: true });
  for (const id of Object.keys(GROUNDS)) {
    if (only.length && !only.includes(id)) continue;
    const t = render(id, size);
    const hex = '#' + [t.mean.r, t.mean.g, t.mean.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    console.log(`${id.padEnd(10)} mean ${hex}`);
    if (report) continue;
    await sharp(t.buf, { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality: 84, mozjpeg: true }).toFile(join(out, id + '.jpg'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
