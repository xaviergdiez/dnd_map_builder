// Run: node scripts/gen-textures.check.mjs
import assert from 'node:assert/strict';
import { GROUNDS, render, vnoise, fbm, worley } from './gen-textures.mjs';
import { MAP_THEMES } from '../src/battlemap.js';

// Every theme has a generator and every generator a theme: a floor with no
// theme is dead weight, and a theme with no floor 404s on the projector.
assert.deepEqual(Object.keys(GROUNDS).sort(), MAP_THEMES.map((t) => t.id).sort());

// A TILE MUST WRAP. Evaluated one full period apart a ground gives the same
// colour, exactly — which is a stronger statement than "no visible seam", and
// does not depend on where the seam happens to fall on a stone floor.
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const [id, fn] of Object.entries(GROUNDS)) {
  for (let i = 0; i < 200; i++) {
    const u = rnd(), v = rnd();
    const a = fn(u, v);
    for (const b of [fn(u + 1, v), fn(u, v + 1), fn(u - 1, v - 1)]) {
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${id} is not periodic at ${u.toFixed(3)},${v.toFixed(3)}`);
    }
  }
}
// the primitives, since they are what the grounds are built from
for (const [u, v] of [[0.13, 0.77], [0.5, 0.5]]) {
  assert.ok(Math.abs(vnoise(u * 8, v * 8, 8) - vnoise((u + 1) * 8, v * 8, 8)) < 1e-9);
  assert.ok(Math.abs(fbm(u, v, 6, 4, 3) - fbm(u + 1, v + 1, 6, 4, 3)) < 1e-9);
  assert.ok(Math.abs(worley(u, v, 7, 1).f1 - worley(u + 1, v, 7, 1).f1) < 1e-9);
}

// Mid-tones, and not flat. Pure black loses the walls drawn over it, pure
// white glares on a projector, and a flat colour is not a texture.
for (const id of Object.keys(GROUNDS)) {
  const { buf, mean } = render(id, 96);
  const lum = 0.3 * mean.r + 0.59 * mean.g + 0.11 * mean.b;
  assert.ok(lum > 40 && lum < 225, `${id}: mean luminance ${lum.toFixed(0)} is not a mid-tone`);
  let min = 255, max = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const l = 0.3 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  assert.ok(max - min > 40, `${id}: only ${Math.round(max - min)} levels of contrast`);
}
console.log('gen-textures.check.mjs: all grounds tile, and sit in the mid-tones');
