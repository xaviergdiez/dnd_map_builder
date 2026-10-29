/* Builds the weapon and spell tables the overlay reads, from dnd-data.

     npm run rules            # dnd-data (devDependency) -> src/data/*.json

   Run by hand and the output is committed, so a normal build never touches the
   60MB source. What is kept is the GEOMETRY of each entry — how far it reaches,
   what shape it throws, how far it can be aimed — plus the few numbers a table
   reads off beside it. Descriptions are left behind on purpose: the map is not
   a rules reference, and the book is.

   WHAT dnd-data IS LIKE. It is a merge of many books, and one weapon or spell
   is usually several records, each carrying a different slice of the fields:
   the 2014 Free Basic Rules record has the Longbow's range and damage, the
   2024 PHB record has its properties and nothing else. So records are grouped
   by name and the fields are taken from the best source that has them, in
   SOURCE_ORDER. Only Wizards of the Coast books are used: the rest of the
   dataset is third-party and its numbers are not the ones a table means by
   "a longbow".

   Pure parsing lives in parseRange / parseWeapon / parseSpell and is checked in
   build-rules.check.mjs, because the strings they read ("Self (15 ft ▽)",
   "150 ft (20 ft radius ○)") are only ever almost regular. */

import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_ORDER = [
  "Player's Handbook (2024)", "Player's Handbook", "Free Basic Rules (2024)",
  'Free Basic Rules (2014)', "Xanathar's Guide to Everything",
  "Tasha's Cauldron of Everything", 'Monster Manual', 'Mordenkainen Presents - Monsters of the Multiverse',
  "Dungeon Master's Guide (2024)", "Dungeon Master's Guide",
  'Essentials Kit'
];
const rank = (book) => {
  const i = SOURCE_ORDER.indexOf(book);
  return i < 0 ? SOURCE_ORDER.length : i;
};

/* Records with the same name, best source first. */
function groupByName(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.publisher !== 'Wizards of the Coast') continue;
    const key = String(r.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const g of groups.values()) g.sort((a, b) => rank(a.book) - rank(b.book));
  return groups;
}

/* First record in the group that has the field. */
const pick = (group, field) => {
  for (const r of group) {
    const v = r.properties && r.properties[field];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

const num = (s) => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/* ----------------------------- distances ----------------------------- */

/* "30 feet", "30 ft", "30-foot", "1 mile", "Ten 10 ft" -> feet. */
export function feetIn(text) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*-?\s*(feet|foot|ft|miles?|mi)\b/i.exec(String(text || ''));
  if (!m) return null;
  const n = num(m[1]);
  if (n === null) return null;
  return /^mi/i.test(m[2]) ? n * 5280 : n;
}

/* Anything past this is not drawn on a map: a spell reaching five miles is a
   fact for the table, not a template. */
export const MAX_DRAWN_FT = 2000;

/* ------------------------------ spells ------------------------------ */

/* The shape symbols dnd-data uses in data-RangeAoe, and the words the older
   Range field uses for the same things. */
const SHAPES = [
  ['sphere', /○|sphere|radius|emanation|circle/i],
  ['cone', /▽|cone/i],
  ['cube', /□|cube|square/i],
  ['line', /⇧|line|beam|wide/i]
];

/* "Self (15 ft ▽)", "150 ft (20 ft radius ○)", "Touch (60 ft radius ○)",
   "Self (10 ft wide, 60 feet long ⇧)", "30 feet" ->
   { reach: 'self'|'touch'|'sight'|'unlimited'|number|null, area: {...}|null }

   `area.width` is only set for a line. A sphere's size is its RADIUS, which is
   how the rules measure it and how the notation above writes it, "radius"
   present or not. */
export function parseRange(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return { reach: null, area: null };

  const open = s.indexOf('(');
  const head = (open < 0 ? s : s.slice(0, open)).trim();
  const inside = open < 0 ? '' : s.slice(open + 1, s.lastIndexOf(')') < 0 ? undefined : s.lastIndexOf(')'));

  let reach = null;
  if (/^self/i.test(head)) reach = 'self';
  else if (/^touch/i.test(head)) reach = 'touch';
  else if (/^sight/i.test(head)) reach = 'sight';
  else if (/^unlimited/i.test(head)) reach = 'unlimited';
  else {
    const ft = feetIn(head);
    if (ft !== null) reach = ft;
  }

  /* The older Range field puts the shape in words and sometimes in the head
     itself: "Self (15-foot cone)", "Self (100-foot line)". The same regexes
     serve both because both mean the same thing. */
  let area = null;
  const shapeText = inside || head;
  const hit = SHAPES.find(([, re]) => re.test(shapeText));
  if (hit && (inside || /\b(cone|line|radius|sphere|cube)\b/i.test(head))) {
    const shape = hit[0];
    let size = null;
    let width = null;
    if (shape === 'line') {
      const long = /(\d[\d,]*)\s*-?\s*(?:feet|foot|ft)\s*-?\s*long/i.exec(shapeText);
      const wide = /(\d[\d,]*)\s*-?\s*(?:feet|foot|ft)\s*-?\s*wide/i.exec(shapeText);
      size = long ? num(long[1]) : feetIn(shapeText);
      width = wide ? num(wide[1]) : 5;
    } else {
      size = feetIn(shapeText);
    }
    if (size && size <= MAX_DRAWN_FT) {
      area = shape === 'line' ? { shape, size, width } : { shape, size };
    }
  }
  return { reach: typeof reach === 'number' && reach > MAX_DRAWN_FT ? null : reach, area };
}

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation',
  'Illusion', 'Necromancy', 'Transmutation'];
const school = (s) => SCHOOLS.find((x) => x.toLowerCase() === String(s || '').trim().toLowerCase()) || null;

const level = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
};

/* One spell, from every record that carries it. Null when it has nothing the
   map could draw, which is most of the third-party list and a few of ours. */
export function parseSpell(group) {
  const rangeText = pick(group, 'data-RangeAoe') ?? pick(group, 'Range');
  const parsed = parseRange(rangeText);
  const reach = parsed.reach;
  // A wall is a line or a ring the caster shapes, and the data gives it as a
  // sphere the size of its longest side: drawn, it would cover ground the
  // spell never touches. Its reach is still worth a ring.
  const area = /^wall of /i.test(group[0].name) ? null : parsed.area;
  const lvl = level(pick(group, 'Level'));
  if (lvl === null) return null;
  const dmg = pick(group, 'Damage');
  const save = pick(group, 'Save');
  const dtype = pick(group, 'Damage Type');
  const out = {
    name: group[0].name.trim(),
    level: lvl,
    school: school(pick(group, 'School'))
  };
  if (reach !== null) out.range = reach;
  if (area) out.area = area;
  if (save) out.save = String(save).trim();
  if (dmg) out.damage = String(dmg).trim();
  if (dtype) out.damageType = String(dtype).trim().toLowerCase();
  // A spell with no reach and no area is a rules fact, not a template.
  return reach === null && !area ? null : out;
}

/* ------------------------------ weapons ------------------------------ */

/* "20/60" -> [20, 60]; "5" -> [5, null]. */
export function parseWeaponRange(text) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(text || '').trim());
  if (m) return [Number(m[1]), Number(m[2])];
  const one = /^(\d+)$/.exec(String(text || '').trim());
  return one ? [Number(one[1]), null] : null;
}

const props = (s) => String(s || '').split(',').map((p) => p.trim()).filter(Boolean)
  .map((p) => p.replace(/^./, (c) => c.toUpperCase()).replace(/-handed/i, '-Handed'));

/* One weapon, from every record that carries it. Reach is 5 ft and 10 ft with
   the Reach property; ranged weapons carry [normal, long] in feet.

   `group` is the records for ONE name, so a base weapon (Longbow) is complete
   even though no single record says everything about it. */
export function parseWeapon(group) {
  const type = String(pick(group, 'Item Type') || '');
  const kind = /ranged/i.test(type) ? 'ranged' : /melee/i.test(type) ? 'melee' : null;
  if (!kind) return null;
  const properties = props(pick(group, 'Properties'));
  const range = parseWeaponRange(pick(group, 'Range'));
  const out = {
    name: group[0].name.trim(),
    kind,
    // Reach is what a melee attack touches. A ranged weapon used up close is
    // still a 5 ft attack, so everything has one.
    reach: properties.includes('Reach') ? 10 : 5
  };
  if (range) out.range = range;
  const dmg = pick(group, 'Damage');
  if (dmg) out.damage = String(dmg).trim();
  const dtype = pick(group, 'Damage Type');
  if (dtype) out.damageType = String(dtype).trim().toLowerCase();
  if (properties.length) out.properties = properties;
  return out;
}

/* ------------------------------ monsters ------------------------------ */

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

/* One monster, from every record that carries it. What the map needs is how big
   it is (the footprint of its contact) and enough to tell two apart in a
   picker: type, challenge rating, AC and hit points. Stat blocks are left in the
   book. "Medium or Small" is the larger, which is the one that takes the room. */
export function parseMonster(group) {
  const sizes = String(pick(group, 'Size') || '').split(/\s+or\s+|,|\//i).map((x) => x.trim());
  const size = SIZES.filter((z) => sizes.some((x) => x.toLowerCase() === z.toLowerCase())).pop();
  if (!size) return null;
  const type = String(pick(group, 'Type') || '').split(/[\s(,]/)[0].toLowerCase();
  const out = { name: group[0].name.trim(), size };
  if (type) out.type = type;
  const cr = pick(group, 'Challenge Rating');
  if (cr !== undefined) out.cr = String(cr).trim();
  const ac = Number(pick(group, 'data-AcNum') ?? String(pick(group, 'AC') || '').match(/\d+/)?.[0]);
  if (Number.isFinite(ac) && ac > 0) out.ac = ac;
  const hp = Number(pick(group, 'data-HpNum') ?? String(pick(group, 'HP') || '').match(/\d+/)?.[0]);
  if (Number.isFinite(hp) && hp > 0) out.hp = hp;
  return out;
}

export function buildMonsters(monsters) {
  const isMonster = (r) => r.properties && r.properties.Category === 'Monsters';
  return [...groupByName(monsters.filter(isMonster)).values()]
    .map(parseMonster).filter(Boolean).sort(sortByName);
}

/* ------------------------------- build ------------------------------- */

const sortByName = (a, b) => a.name.localeCompare(b.name);

/* The weapons are the ones the Player's Handbook lists, in either edition.
   "Mundane" cannot be read off the rarity field (it is blank, "None",
   "Standard" and "No" depending on the book), and the rest of the dataset is
   magic variants — a Battleaxe +2, a Vicious Longbow — whose geometry is the
   base weapon's exactly. They would add four hundred rows to a picker and not
   one square to a template, so they are left out. */
const CORE_BOOKS = new Set(["Player's Handbook", "Player's Handbook (2024)"]);

export function buildWeapons(items) {
  const isWeapon = (r) => CORE_BOOKS.has(r.book)
    && /^(melee|ranged) weapon$/i.test(String((r.properties && r.properties['Item Type']) || '').trim());
  const core = new Set(items.filter(isWeapon).map((r) => r.name.trim().toLowerCase()));
  const groups = groupByName(items.filter((r) => core.has(String(r.name).trim().toLowerCase())));
  return [...groups.values()].map(parseWeapon).filter(Boolean).sort(sortByName);
}

export function buildSpells(spells) {
  return [...groupByName(spells).values()].map(parseSpell).filter(Boolean).sort(sortByName);
}

async function main() {
  const require = createRequire(import.meta.url);
  const { items, spells, monsters } = require('dnd-data');
  const out = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'data');
  await mkdir(out, { recursive: true });

  const weapons = buildWeapons(items);
  const spellList = buildSpells(spells);
  const monsterList = buildMonsters(monsters);
  await writeFile(join(out, 'weapons.json'), JSON.stringify(weapons));
  await writeFile(join(out, 'spells.json'), JSON.stringify(spellList));
  await writeFile(join(out, 'monsters.json'), JSON.stringify(monsterList));

  const area = spellList.filter((s) => s.area).length;
  const ranged = weapons.filter((w) => w.range).length;
  console.log(`weapons: ${weapons.length} (${ranged} with a range)`);
  console.log(`spells:  ${spellList.length} (${area} with an area)`);
  console.log(`monsters: ${monsterList.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
