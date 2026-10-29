// Awareness: what the party could hear. Noise turns the hidden contacts on the
// projected map into pings, without saying what they are.
//
// WHAT IS 5E AND WHAT IS HOUSE
//
//   5e has no noise rules. It has a few spells that say how far they carry
//   (Thunderwave and Shatter are audible 300 feet away) and the rest is "the DM
//   decides". The distances below are house numbers, plain and editable, picked
//   so a whisper does not wake the next room and a shout wakes the floor.

import { readMap, parseKey } from './battlemap.js';
import { FEET_PER_SQUARE } from './rules.js';

export const NOISE = [
  { id: 'whisper', name: 'Whisper', radiusFt: 10 },
  { id: 'footsteps', name: 'Footsteps', radiusFt: 25 },
  { id: 'door', name: 'Opening a door', radiusFt: 40 },
  { id: 'melee', name: 'Clash of arms', radiusFt: 60 },
  { id: 'shout', name: 'Shout or alarm', radiusFt: 150 },
  { id: 'thunder', name: 'Thunderwave, Shatter', radiusFt: 300 }
];
export const noiseById = (id) => NOISE.find((n) => n.id === id) || null;

// Everything hidden inside the noise's radius becomes a ping: the party hears
// something there without learning what. What they have already seen stays
// seen, and a ping stays a ping — a sound does not un-reveal a thing.
// Same contract as battlemap.js's senseSweep, with a radius from what made the
// noise rather than from a spell.
export function noisePing(map, from, kindId) {
  const m = readMap(map);
  const noise = noiseById(kindId);
  if (!from || !noise) return m.contacts;
  const reach = noise.radiusFt / (m.feetPerSquare || FEET_PER_SQUARE);
  const out = {};
  for (const [k, c] of Object.entries(m.contacts)) {
    const p = parseKey(k);
    if (!p) continue;
    const near = Math.hypot(p.x - from.x, p.y - from.y) <= reach;
    out[k] = near && c.state === 'hidden' ? { ...c, state: 'ping' } : c;
  }
  return out;
}
