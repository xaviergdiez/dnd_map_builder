/* The weapon and spell tables the overlay picker reads, and nothing else.

   Kept apart from rules.js because importing JSON is a bundler's job: rules.js
   stays plain enough to run under node for its check, and this is the one
   file that has to be built. The data comes from scripts/build-rules.mjs. */

import WEAPONS from './data/weapons.json';
import SPELLS from './data/spells.json';
import MONSTERS from './data/monsters.json';

export { WEAPONS, SPELLS, MONSTERS };

const MONSTER_BY_NAME = new Map(MONSTERS.map((e) => [e.name.toLowerCase(), e]));
// The monster a typed name matches exactly (ignoring case), or null: a contact
// may be called anything, and only a real monster brings a size with it.
export const monsterByName = (name) => MONSTER_BY_NAME.get(String(name || '').trim().toLowerCase()) || null;

// "CR 1/4 · Small humanoid", for a picker's suggestion and for a readout.
export const monsterLabel = (m) =>
  `${m.cr ? 'CR ' + m.cr + ' · ' : ''}${m.size}${m.type ? ' ' + m.type : ''}`;

/* The picker holds one string, "w:Longbow" or "s:Fireball", so a weapon and a
   spell with the same name cannot be confused and the choice is one value. */
export const weaponKey = (name) => 'w:' + name;
export const spellKey = (name) => 's:' + name;

const byName = (list) => new Map(list.map((e) => [e.name.toLowerCase(), e]));
const WEAPON_BY_NAME = byName(WEAPONS);
const SPELL_BY_NAME = byName(SPELLS);

export function entryFor(key) {
  const k = String(key || '');
  const name = k.slice(2).trim().toLowerCase();
  if (k.startsWith('w:')) return WEAPON_BY_NAME.get(name) || null;
  if (k.startsWith('s:')) return SPELL_BY_NAME.get(name) || null;
  return null;
}

const ORDINAL = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
export const spellLabel = (s) => `${ORDINAL[s.level]}${s.school ? ' · ' + s.school : ''}`;
