/* The 5e rules the map needs, and nothing else.

   The map is projected under miniatures and answers four questions the table
   would otherwise settle with a tape measure: how far is it, is it in range,
   what does the template catch, and what is in the way. This file is what
   "in range" and "in the way" MEAN in the fifth edition; battlemap.js does the
   geometry.

   Everything is in FEET, because that is what every weapon, spell and speed
   in the books is written in. A square is five feet unless the deck says
   otherwise.

   WHAT IT DOES NOT DO. No attack rolls, no hit points, no initiative. The
   miniatures and the dice are on the table already.

   Pure. See rules.check.mjs. */

export const FEET_PER_SQUARE = 5;

/* ------------------------------ range bands ------------------------------ */

/* A ranged weapon has two numbers, normal and long ("80/320"). Out to normal
   is an ordinary shot; between normal and long the attack is made with
   disadvantage; past long there is no attack. A spell has one number, so it
   has no long band and everything past it is out.

   A thing with no range at all (a melee weapon, a spell with no reach figure)
   is 'normal' everywhere: the GM rules on it, and inventing a penalty for it
   would be wrong more often than right. */
export const RANGE_EFFECT = { normal: null, long: 'disadvantage', out: 'no attack' };

export function rangeBand(distanceFt, normalFt, longFt = null) {
  const d = Math.max(0, Number(distanceFt) || 0);
  const n = Number(normalFt);
  if (!Number.isFinite(n) || n <= 0) return 'normal';
  if (d <= n) return 'normal';
  const l = Number(longFt);
  return Number.isFinite(l) && l > n && d <= l ? 'long' : 'out';
}

/* ----------------------------- creature size ----------------------------- */

/* The space a creature controls, from the PHB's size table: Tiny, Small and
   Medium take a 5 ft square (a Tiny one fits four to a square, which a single
   blip cannot show), Large is 10, Huge 15, Gargantuan 20 or more. */
export const SIZE_FEET = { Tiny: 5, Small: 5, Medium: 5, Large: 10, Huge: 15, Gargantuan: 20 };

/* How many squares across a creature of this size covers on a map of this
   scale. A Large creature on a 10 ft grid is one square, not two: the grid is
   what changed, not the owlbear. Unknown sizes are Medium. */
export function footprintSquares(size, feetPerSquare = FEET_PER_SQUARE) {
  const ft = SIZE_FEET[size] || SIZE_FEET.Medium;
  const per = Number(feetPerSquare) > 0 ? Number(feetPerSquare) : FEET_PER_SQUARE;
  return Math.max(1, Math.min(6, Math.round(ft / per)));
}

/* ------------------------------- cover ------------------------------- */

/* PHB: half cover +2 to AC and Dexterity saving throws, three-quarters +5,
   total cover cannot be targeted directly. Cover does not stack — the best of
   what lies between wins — which is why the map reports one. */
export const COVER_DEGREES = [
  { id: 'half', name: 'Half cover', ac: 2 },
  { id: 'three_quarters', name: 'Three-quarters cover', ac: 5 },
  { id: 'total', name: 'Total cover', ac: null }
];
export const coverDegree = (id) => COVER_DEGREES.find((c) => c.id === id) || null;

/* ------------------------------- overlays ------------------------------- */

/* What the projector draws for one weapon or one spell, reduced to the numbers
   the geometry needs. `entry` is a row of src/data/weapons.json or
   spells.json, which scripts/build-rules.mjs writes.

     range      how far it can be aimed (normal range, or the spell's reach)
     longRange  weapons only: where disadvantage ends
     reach      melee reach; every weapon has one
     area       { shape: sphere | cone | cube | line, size, width? } or null
     self       the area is anchored on the caster rather than on the target

   A sphere's size is its radius, which is how the rules measure it. */
export function overlayOf(entry) {
  const e = entry && typeof entry === 'object' ? entry : null;
  if (!e) return null;
  const isSpell = typeof e.level === 'number';
  const reach = !isSpell ? (Number(e.reach) || 5) : null;
  const self = isSpell && e.range === 'self';
  let range = null;
  let longRange = null;
  if (isSpell) {
    if (typeof e.range === 'number') range = e.range;
    else if (e.range === 'touch') range = FEET_PER_SQUARE;
  } else if (Array.isArray(e.range)) {
    [range, longRange] = e.range;
  }
  return {
    name: String(e.name || ''),
    isSpell,
    level: isSpell ? e.level : null,
    range,
    longRange,
    reach,
    area: e.area ? { ...e.area } : null,
    self,
    save: e.save || null,
    damage: e.damage || null,
    damageType: e.damageType || null
  };
}

/* Which overlay a thing gets, decided by the thing itself. A cone spell
   throws a cone whatever anyone selects from a menu, and asking the GM to say
   so again is a chance to say it wrong in front of the table.

     field  a sphere around the caster (Spirit Guardians)
     cone | cube | line  a template from the caster (Burning Hands)
     beam   everything else: a lane from the caster to a target, with the
            band it lands in. A burst at the target (Fireball) is the beam
            AND an area at the far end. */
export function overlayKindFor(ov) {
  if (!ov) return null;
  if (ov.area && ov.self) return ov.area.shape === 'sphere' ? 'field' : ov.area.shape;
  return 'beam';
}

/* The half-angle of a 5e cone. The rules make a cone as wide at its far end as
   it is long, which is atan(1/2) either side of the aim: about 26.6 degrees. */
export const CONE_HALF_ANGLE_DEG = (Math.atan(0.5) * 180) / Math.PI;
