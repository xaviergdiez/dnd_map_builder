// Run: node src/rules.check.mjs
import assert from 'node:assert/strict';
import { rangeBand, RANGE_EFFECT, COVER_DEGREES, coverDegree, overlayOf, overlayKindFor,
  CONE_HALF_ANGLE_DEG, FEET_PER_SQUARE, footprintSquares } from './rules.js';

assert.equal(FEET_PER_SQUARE, 5);

/* ---- range bands: normal, long, out ---- */
assert.equal(rangeBand(0, 80, 320), 'normal');
assert.equal(rangeBand(80, 80, 320), 'normal', 'exactly the normal range is normal');
assert.equal(rangeBand(81, 80, 320), 'long');
assert.equal(rangeBand(320, 80, 320), 'long', 'exactly the long range is still a shot');
assert.equal(rangeBand(321, 80, 320), 'out');
assert.equal(rangeBand(150, 120), 'out', 'a spell has no long band');
assert.equal(rangeBand(500, null), 'normal', 'no range at all is the DM\'s call, not a penalty');
assert.equal(rangeBand(500, 0), 'normal');
assert.equal(rangeBand(-3, 30), 'normal');
assert.equal(rangeBand(NaN, 30), 'normal');
assert.deepEqual(RANGE_EFFECT, { normal: null, long: 'disadvantage', out: 'no attack' });

/* ---- cover: PHB values ---- */
assert.deepEqual(COVER_DEGREES.map((c) => [c.id, c.ac]), [['half', 2], ['three_quarters', 5], ['total', null]]);
assert.equal(coverDegree('half').ac, 2);
assert.equal(coverDegree('nonsense'), null);

/* ---- how much room a creature takes ---- */
assert.deepEqual(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'].map((z) => footprintSquares(z)), [1, 1, 1, 2, 3, 4]);
assert.equal(footprintSquares('Large', 10), 1, 'a Large creature on a 10 ft grid is one square');
assert.equal(footprintSquares('Gargantuan', 2.5), 6, 'and capped, or a dragon on a tiny grid covers the map');
assert.equal(footprintSquares('Nonsense'), 1, 'unknown is Medium');
assert.equal(footprintSquares('Huge', 0), 3, 'a bad scale falls back to five feet');

/* ---- a 5e cone is as wide at the end as it is long ---- */
assert.ok(Math.abs(Math.tan((CONE_HALF_ANGLE_DEG * Math.PI) / 180) - 0.5) < 1e-9);

/* ---- what the projector draws for a thing ---- */
const w = overlayOf({ name: 'Longbow', kind: 'ranged', reach: 5, range: [150, 600] });
assert.deepEqual([w.range, w.longRange, w.reach, w.isSpell, w.area], [150, 600, 5, false, null]);
const sword = overlayOf({ name: 'Longsword', kind: 'melee', reach: 5 });
assert.deepEqual([sword.range, sword.longRange, sword.reach], [null, null, 5]);
assert.equal(overlayOf({ name: 'x', kind: 'melee' }).reach, 5, 'every weapon has a reach');

const fire = overlayOf({ name: 'Fireball', level: 3, range: 150, area: { shape: 'sphere', size: 20 }, save: 'Dexterity' });
assert.deepEqual([fire.range, fire.self, fire.isSpell, fire.reach, fire.save], [150, false, true, null, 'Dexterity']);
assert.equal(overlayKindFor(fire), 'beam', 'a burst at a target is a beam and an area');
assert.equal(overlayOf({ name: 'Cure Wounds', level: 1, range: 'touch' }).range, 5, 'touch is five feet');
assert.equal(overlayOf({ name: 'Detect Magic', level: 1, range: 'self' }).self, true);
assert.equal(overlayOf({ name: 'Telepathy', level: 8, range: 'unlimited' }).range, null, 'no ring for unlimited');
assert.equal(overlayKindFor(overlayOf({ name: 'x', level: 1, range: 'self', area: { shape: 'sphere', size: 15 } })), 'field');
assert.equal(overlayKindFor(overlayOf({ name: 'x', level: 1, range: 'self', area: { shape: 'cone', size: 15 } })), 'cone');
assert.equal(overlayKindFor(overlayOf({ name: 'x', level: 1, range: 60, area: { shape: 'cube', size: 20 } })), 'beam',
  'a cube thrown at a target is not from the caster');
assert.equal(overlayOf(null), null);
assert.equal(overlayOf('nonsense'), null);
assert.equal(overlayKindFor(null), null);

// the area is copied, so a caller drawing with it cannot change the data
const row = { name: 'x', level: 1, range: 'self', area: { shape: 'cone', size: 15 } };
overlayOf(row).area.size = 99;
assert.equal(row.area.size, 15);
console.log('rules.check.mjs: all assertions passed');
