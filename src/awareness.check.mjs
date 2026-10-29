import assert from 'node:assert/strict';
import { noisePing, NOISE, noiseById } from './awareness.js';

// noise rings
const map = { feetPerSquare: 5, contacts: {
  '0,2': { name: 'near', state: 'hidden' },
  '0,10': { name: 'mid', state: 'hidden' },
  '0,100': { name: 'far', state: 'hidden' },
  '3,0': { name: 'seen', state: 'seen' }
} };
// 5 ft squares: 25 ft is 5 squares, 60 ft is 12, 150 ft is 30.
const steps = noisePing(map, { x: 0, y: 0 }, 'footsteps');
assert.equal(steps['0,2'].state, 'ping', 'footsteps carry 25 ft');
assert.equal(steps['0,10'].state, 'hidden', 'but not 50');
const fight = noisePing(map, { x: 0, y: 0 }, 'melee');
assert.equal(fight['0,10'].state, 'ping', 'a clash of arms carries 60 ft');
assert.equal(fight['0,100'].state, 'hidden');
const shout = noisePing(map, { x: 0, y: 0 }, 'shout');
assert.equal(shout['0,100'].state, 'hidden', 'a shout is 30 squares, not 100');
assert.equal(shout['3,0'].state, 'seen', 'seen stays seen');
// Squares scale the radius: at 10 ft a square, footsteps (25 ft) reach 2.5 squares.
const coarse = noisePing({ ...map, feetPerSquare: 10 }, { x: 0, y: 0 }, 'footsteps');
assert.equal(coarse['0,2'].state, 'ping', '2 squares is 20 ft');
assert.equal(coarse['0,10'].state, 'hidden', '10 squares is 100 ft');
assert.ok(noiseById('door').radiusFt > noiseById('footsteps').radiusFt);
assert.equal(noisePing(map, { x: 0, y: 0 }, 'nope')['0,2'].state, 'hidden');
assert.ok(NOISE.every((n) => n.radiusFt > 0));
assert.equal(noiseById('thunder').radiusFt, 300, 'Thunderwave is audible 300 feet away');

console.log('awareness.check.mjs: all assertions passed');

/* ---- obscuring terrain folded into the line of sight (battlemap.js) ---- */
{
  const { lineBlocked, readMap, visibleCells, unobstructed, reachBetween, blockedText, lightingById } =
    await import('./battlemap.js');
  const open = (extra) => ({ cols: 30, rows: 10, feetPerSquare: 5, ...extra });
  const row = (cells) => Object.fromEntries(cells.map(([x, y, d]) => [`${x},${y}`, d]));
  const run = (d, n, from = 5) => row(Array.from({ length: n }, (_, i) => [from + i, 5, d]));
  const A = { x: 0, y: 5 }, B = { x: 20, y: 5 };

  assert.equal(lineBlocked(open({}), A, B), null, 'open ground blocks nothing');

  // Heavy stops sight after 5 ft: one square of it is fine, two are too much.
  const hit = lineBlocked(open({ obscuring: run('heavy', 2) }), A, B);
  assert.equal(hit.reason, 'obscured');
  assert.equal(hit.density, 'heavy');
  assert.equal(blockedText(hit), 'foliage or fog');
  assert.equal(lineBlocked(open({ obscuring: run('heavy', 1) }), A, B), null, 'a thin screen can be seen through');

  // Light reaches further than heavy: 6 squares (30 ft) of light is fine, of heavy is not.
  assert.equal(lineBlocked(open({ obscuring: run('light', 6) }), A, B), null);
  assert.equal(lineBlocked(open({ obscuring: run('heavy', 6) }), A, B).reason, 'obscured');
  assert.equal(lineBlocked(open({ obscuring: run('light', 7) }), A, B).reason, 'obscured', 'light stops sight past 30 ft');

  // Mixed densities: the thicker stuff's limit applies to everything crossed so far
  // (two light then two heavy is 20 ft through, past heavy's 5 ft, though light alone is fine).
  const mixed = open({ obscuring: { ...run('light', 2), ...run('heavy', 2, 7) } });
  assert.equal(lineBlocked(mixed, A, B).reason, 'obscured');

  // The target's own square counts (hiding in the reeds); the firer's does not.
  const hidden = open({ obscuring: run('heavy', 5, 12) });
  assert.equal(lineBlocked(hidden, { x: 10, y: 5 }, { x: 16, y: 5 }).reason, 'obscured');
  assert.equal(lineBlocked(hidden, { x: 12, y: 5 }, { x: 0, y: 5 }), null, 'shooting out of cover is not blind');

  // Square size scales it: at 10 ft a square, one square of heavy is 10 ft through.
  assert.equal(lineBlocked(open({ feetPerSquare: 10, obscuring: run('heavy', 1) }), A, B).reason, 'obscured');

  // Templates are not stopped by fog; the ruler and the sight overlay are.
  const heavy = open({ obscuring: run('heavy', 5) });
  assert.equal(unobstructed(heavy, A, [B]).length, 1, 'a Fireball crosses fog');
  assert.equal(visibleCells(heavy, A, null).some((c) => c.x === 20 && c.y === 5), false, 'but the eye does not');
  assert.equal(reachBetween({ from: A, to: B, map: heavy }).blocked.reason, 'obscured');

  // The map keeps what it is given, and drops junk.
  const kept = readMap({ obscuring: { '1,1': 'heavy', '2,2': 'nonsense', bad: 'light' }, lighting: 'rain' });
  assert.deepEqual(kept.obscuring, { '1,1': 'heavy' });
  assert.equal(kept.lighting, 'rain');
  assert.equal(readMap({ lighting: 'nonsense' }).lighting, 'bright');
  assert.match(lightingById('dark').effect, /heavily obscured/i);
}
console.log('awareness.check.mjs: obscuring terrain in lineBlocked passed');
