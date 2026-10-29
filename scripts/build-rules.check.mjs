// Run: node scripts/build-rules.check.mjs
import assert from 'node:assert/strict';
import { feetIn, parseRange, parseWeaponRange, parseSpell, parseWeapon, parseMonster, buildSpells, buildMonsters } from './build-rules.mjs';
import WEAPONS from '../src/data/weapons.json' with { type: 'json' };
import SPELLS from '../src/data/spells.json' with { type: 'json' };
import MONSTERS from '../src/data/monsters.json' with { type: 'json' };

/* ---- distances ---- */
assert.equal(feetIn('150 feet'), 150);
assert.equal(feetIn('30 ft'), 30);
assert.equal(feetIn('15-foot cone'), 15);
assert.equal(feetIn('1 mile'), 5280);
assert.equal(feetIn('Touch'), null);

/* ---- the strings dnd-data actually uses ---- */
assert.deepEqual(parseRange('150 feet'), { reach: 150, area: null });
assert.deepEqual(parseRange('Touch'), { reach: 'touch', area: null });
assert.deepEqual(parseRange('Self'), { reach: 'self', area: null });
assert.deepEqual(parseRange('Self (15 ft ▽)'), { reach: 'self', area: { shape: 'cone', size: 15 } });
assert.deepEqual(parseRange('150 ft (20 ft radius ○)'), { reach: 150, area: { shape: 'sphere', size: 20 } });
assert.deepEqual(parseRange('30 ft (5 ft □)'), { reach: 30, area: { shape: 'cube', size: 5 } });
assert.deepEqual(parseRange('Self (100 ft ⇧)'), { reach: 'self', area: { shape: 'line', size: 100, width: 5 } });
assert.deepEqual(parseRange('Self (10 ft wide, 60 feet long ⇧)'),
  { reach: 'self', area: { shape: 'line', size: 60, width: 10 } }, 'a wide line says so');
// the older Range field puts the shape in words
assert.deepEqual(parseRange('Self (15-foot cone)'), { reach: 'self', area: { shape: 'cone', size: 15 } });
assert.deepEqual(parseRange('Self (10-foot-radius sphere)'), { reach: 'self', area: { shape: 'sphere', size: 10 } });
// not drawable: a five-mile area is a fact for the table, not a template
assert.equal(parseRange('Self (5-mile ○)').area, null);
assert.equal(parseRange('1 mile').reach, null, 'a mile is past anything a map draws');
assert.deepEqual(parseRange(''), { reach: null, area: null });
assert.deepEqual(parseRange(undefined), { reach: null, area: null });

/* ---- weapons ---- */
assert.deepEqual(parseWeaponRange('150/600'), [150, 600]);
assert.deepEqual(parseWeaponRange('5'), [5, null]);
assert.equal(parseWeaponRange('Special'), null);
const rec = (name, properties, book = "Player's Handbook") => ({ name, properties, book, publisher: 'Wizards of the Coast' });
// one weapon is several records, each with a slice of the fields
const bow = parseWeapon([rec('Longbow', { 'Item Type': 'Ranged Weapon', Properties: 'Ammunition, Heavy, Two-Handed' }),
  rec('Longbow', { Range: '150/600', Damage: '1d8', 'Damage Type': 'Piercing' }, 'Free Basic Rules (2014)')]);
assert.deepEqual([bow.kind, bow.range, bow.damage, bow.reach], ['ranged', [150, 600], '1d8', 5]);
assert.equal(parseWeapon([rec('Glaive', { 'Item Type': 'Melee Weapon', Properties: 'Heavy, Reach, Two-Handed' })]).reach, 10,
  'the Reach property is ten feet');
assert.equal(parseWeapon([rec('Rope', { 'Item Type': 'Adventuring Gear' })]), null, 'not a weapon');

/* ---- spells ---- */
const sp = (name, properties) => [rec(name, properties)];
assert.deepEqual(parseSpell(sp('Fireball', { Level: 3, School: 'Evocation', 'data-RangeAoe': '150 feet', Save: 'Dexterity' })).range, 150);
assert.equal(parseSpell(sp('Wall of Fire', { Level: 4, 'data-RangeAoe': '120 ft (60 ft radius ○)' })).area, undefined,
  'a wall is not a sphere');
assert.equal(parseSpell(sp('Wall of Fire', { Level: 4, 'data-RangeAoe': '120 ft (60 ft radius ○)' })).range, 120);
assert.equal(parseSpell(sp('Nothing', { Level: 1 })), null, 'no reach and no area: not something to draw');
assert.equal(parseSpell(sp('Bad', { Level: 'x', 'data-RangeAoe': '30 ft' })), null, 'no level, no spell');
// Only Wizards of the Coast books count.
assert.equal(buildSpells([{ name: 'Homebrew', publisher: 'Someone Else', book: 'x', properties: { Level: 1, Range: '30 feet' } }]).length, 0);

/* ---- monsters ---- */
const mon = (name, properties) => [{ name, properties: { Category: 'Monsters', ...properties }, book: 'Monster Manual', publisher: 'Wizards of the Coast' }];
assert.deepEqual(parseMonster(mon('Owlbear', { Size: 'Large', Type: 'monstrosity', 'Challenge Rating': '3', 'data-AcNum': 13, 'data-HpNum': 59 })),
  { name: 'Owlbear', size: 'Large', type: 'monstrosity', cr: '3', ac: 13, hp: 59 });
assert.equal(parseMonster(mon('Goblin', { Size: 'Small', Type: 'humanoid (goblinoid)' })).type, 'humanoid', 'the subtype is dropped');
assert.equal(parseMonster(mon('Wolf', { Size: 'Medium or Small', Type: 'beast' })).size, 'Medium', 'the larger size takes the room');
assert.equal(parseMonster(mon('Thing', { Type: 'aberration' })), null, 'no size, no footprint');
assert.equal(buildMonsters([{ name: 'Bad', publisher: 'Someone Else', book: 'x', properties: { Category: 'Monsters', Size: 'Large' } }]).length, 0);
const monster = (n) => MONSTERS.find((m) => m.name === n);
assert.equal(monster('Goblin').size, 'Small');
assert.equal(monster('Owlbear').size, 'Large');
assert.equal(monster('Adult Red Dragon').size, 'Huge');
assert.equal(monster('Tarrasque').size, 'Gargantuan');
assert.equal(monster('Owlbear').cr, '3');
assert.equal(new Set(MONSTERS.map((m) => m.name)).size, MONSTERS.length, 'one row per monster');
assert.ok(MONSTERS.length >= 500 && MONSTERS.every((m) => m.size && m.name));

/* ---- the committed data ---- */
const spell = (n) => SPELLS.find((s) => s.name === n);
const weapon = (n) => WEAPONS.find((w) => w.name === n);
assert.deepEqual(weapon('Longbow').range, [150, 600]);
assert.deepEqual(weapon('Shortbow').range, [80, 320]);
assert.deepEqual(weapon('Dagger').range, [20, 60], 'thrown');
assert.equal(weapon('Whip').reach, 10);
assert.equal(weapon('Longsword').range, undefined, 'melee only');
assert.ok(WEAPONS.length >= 30 && WEAPONS.every((w) => w.kind === 'melee' || w.kind === 'ranged'));
assert.deepEqual(spell('Fireball').area, { shape: 'sphere', size: 20 });
assert.equal(spell('Fireball').range, 150);
assert.deepEqual(spell('Burning Hands').area, { shape: 'cone', size: 15 });
assert.deepEqual(spell('Lightning Bolt').area, { shape: 'line', size: 100, width: 5 });
assert.deepEqual(spell('Thunderwave').area, { shape: 'cube', size: 15 });
assert.deepEqual(spell('Spirit Guardians').area, { shape: 'sphere', size: 15 });
assert.equal(spell('Spirit Guardians').range, 'self');
assert.equal(spell('Magic Missile').range, 120);
assert.equal(spell('Guidance').range, 'touch');
assert.equal(new Set(SPELLS.map((s) => s.name)).size, SPELLS.length, 'one row per spell, however many books print it');
assert.ok(SPELLS.length >= 300);
// no row may carry a description: the map is not a rules reference
assert.ok(![...SPELLS, ...WEAPONS].some((r) => 'description' in r));
console.log('build-rules.check.mjs: all assertions passed');
