/* Checks for the starting room and doors clicked in play. Ported from the
   Rogue Trader map, minus its firing arcs and target bonus, and with doors
   that hide the room they revealed rather than the way back. */
import assert from 'node:assert/strict';
import {
  readMap, parseKey, visibleExplored, DOOR_STATES,
  setStartRoom, startPlay, playDoor, rotateMap
} from './battlemap.js';

// What the table opens on: the map with fog on and only the start room lit.
const began = (m) => readMap({ ...readMap(m), ...startPlay(m) });

/* ---- the starting room, and doors that are clicked in play ----
   Three rooms in a row with a door between each pair:

     A  x 1..4        door D1 at 5,3        B  x 6..9        door D2 at 10,3        C  x 11..14

   each three squares high (y 2..4). */
{
  const floor = {};
  for (let x = 1; x <= 14; x++) for (let y = 2; y <= 4; y++) floor[`${x},${y}`] = true;
  // The doorways are single squares: wall off the rest of their columns.
  for (const x of [5, 10]) for (const y of [2, 4]) delete floor[`${x},${y}`];
  floor['5,3'] = true; floor['10,3'] = true;
  const base = {
    cols: 20, rows: 8, floor,
    doors: { '5,3': { kind: 'wooden', state: 'closed' }, '10,3': { kind: 'wooden', state: 'closed' } }
  };
  const key = (c) => `${c.x},${c.y}`;
  const roomOf = (m, x, y) => Object.keys(visibleExplored(m)).filter((k) => {
    const p = parseKey(k); return p.x >= x[0] && p.x <= x[1] && p.y === y;
  }).length;
  const seen = (m, x, y) => Boolean(visibleExplored(m)[`${x},${y}`]);

  // ---- choosing the start
  const m0 = readMap(base);
  assert.equal(m0.start, null, 'nobody chose, so there is no start');
  assert.deepEqual(setStartRoom(m0, { x: 2, y: 3 }), { x: 2, y: 3 }, 'a square in a room is a start');
  assert.equal(setStartRoom(m0, { x: 5, y: 3 }), null, 'a doorway is not a room');
  assert.equal(setStartRoom(m0, { x: 0, y: 0 }), null, 'nor is the void');
  assert.equal(setStartRoom(readMap({ ...base, start: { x: 2, y: 3 } }), { x: 4, y: 4 }), null,
    'clicking in the room that is the start takes it back');
  assert.deepEqual(setStartRoom(readMap({ ...base, start: { x: 2, y: 3 } }), { x: 7, y: 3 }), { x: 7, y: 3 },
    'clicking in another room moves it');
  assert.equal(setStartRoom(readMap({ ...base, start: { x: 2, y: 3 } }), { x: 5, y: 3 }).x, 2,
    'a refused click leaves the start where it was');
  assert.equal(readMap({ ...base, start: { x: 9, y: 9 } }).start, null, 'a start off the map is dropped');
  assert.equal(readMap({ ...base, start: 'here' }).start, null);
  assert.deepEqual(readMap({ ...base, start: { x: 2.4, y: 3.2 } }).start, { x: 2, y: 3 });
  // erasing the room it was in takes the start with it
  const erased = { ...base, start: { x: 2, y: 3 }, floor: Object.fromEntries(Object.entries(floor).filter(([k]) => parseKey(k).x > 4)) };
  assert.equal(readMap(erased).start, null);

  // ---- starting play opens on the start room
  const dark = began(base);
  assert.equal(dark.fog, true);
  assert.deepEqual(dark.explored, {}, 'with no start the map opens dark, as before');
  assert.equal(dark.viewpoint, null);

  const lit = began({ ...base, start: { x: 2, y: 3 } });
  assert.equal(lit.fog, true);
  assert.deepEqual(lit.viewpoint, { x: 2, y: 3 }, 'the party is in the start room');
  assert.ok(lit.explored['1,2'] && lit.explored['4,4'], 'room A is lit');
  assert.ok(lit.explored['5,3'], 'and the doorway into it, which can be seen from inside');
  assert.ok(!lit.explored['6,3'] && !lit.explored['11,3'], 'nothing past the door is');
  assert.deepEqual(startPlay(lit).explored, lit.explored);
  assert.deepEqual(startPlay({ ...base }).explored, {}, 'startPlay with no start is the dark map');
  // last session's exploring does not carry over, whatever the saved map held
  const stale = began({ ...base, start: { x: 2, y: 3 }, explored: { '12,3': true }, viewpoint: { x: 12, y: 3 } });
  assert.ok(!stale.explored['12,3'], 'starting play afresh forgets what was found last time');
  assert.deepEqual(stale.viewpoint, { x: 2, y: 3 });
  // a start in the middle of a hall lights the hall, not the next one
  assert.equal(Object.keys(lit.explored).filter((k) => parseKey(k).x >= 6).length, 0);

  // ---- a click on a door
  const live = readMap(lit);
  assert.equal(playDoor(live, { x: 3, y: 3 }), null, 'a click on a floor square is not a door');
  assert.equal(playDoor(live, null), null);

  // closed -> open brings in what is beyond, and the party stays where it was
  const open1 = playDoor(live, { x: 5, y: 3 });
  assert.equal(open1.doors['5,3'].state, 'open', 'a closed door opens on a click');
  assert.ok(open1.explored['6,2'] && open1.explored['9,4'], 'and the room beyond is explored');
  assert.ok(open1.explored['10,3'], 'as far as the next doorway');
  assert.ok(!open1.explored['11,3'], 'and no further');
  assert.equal(open1.viewpoint, undefined, 'the party does not move through the door');
  const m1 = readMap({ ...live, ...open1 });
  assert.ok(seen(m1, 2, 3) && seen(m1, 7, 3), 'both rooms are visible while the door is open');
  assert.ok(!seen(m1, 12, 3), 'the one past the next door is not');

  // shutting it again hides the room it revealed, and the way back stays
  const back1 = readMap({ ...m1, ...playDoor(m1, { x: 5, y: 3 }, 'closed') });
  assert.ok(!seen(back1, 7, 3), 'the room the door revealed goes off the board');
  assert.ok(seen(back1, 2, 3), 'the party\'s own room stays');
  assert.ok(back1.explored['7,3'], 'but the room is not forgotten');
  assert.equal(playDoor(m1, { x: 5, y: 3 }, 'closed').explored, undefined, 'shutting a door explores nothing');
  const again = readMap({ ...back1, ...playDoor(back1, { x: 5, y: 3 }, 'open') });
  assert.ok(seen(again, 7, 3), 'opening it brings the room straight back');

  // the far door: through the first, it lights the third room
  const m2 = readMap({ ...m1, ...playDoor(m1, { x: 10, y: 3 }) });
  assert.ok(seen(m2, 12, 3) && seen(m2, 7, 3) && seen(m2, 2, 3), 'the whole crawl is visible through open doors');
  // shutting the far one hides only the far room
  const m3 = readMap({ ...m2, ...playDoor(m2, { x: 10, y: 3 }, 'closed') });
  assert.ok(!seen(m3, 12, 3), 'the last room is hidden');
  assert.ok(seen(m3, 7, 3) && seen(m3, 2, 3), 'the path before it is not');
  // shutting the near one with both open hides what is beyond it, all of it
  const m3b = readMap({ ...m2, ...playDoor(m2, { x: 5, y: 3 }, 'closed') });
  assert.ok(!seen(m3b, 7, 3) && !seen(m3b, 12, 3), 'everything past a shut door goes with it');
  assert.ok(seen(m3b, 2, 3), 'the party\'s side stays');

  // jamming blocks as well
  const m4 = readMap({ ...m1, ...playDoor(m1, { x: 5, y: 3 }, 'jammed') });
  assert.equal(m4.doors['5,3'].state, 'jammed');
  assert.ok(!seen(m4, 7, 3), 'a jammed door blocks like a closed one');

  // stepping through the states by clicking: closed -> open -> jammed -> closed
  let step = readMap({ ...live });
  const states = [];
  for (let i = 0; i < 4; i++) { step = readMap({ ...step, ...playDoor(step, { x: 5, y: 3 }) }); states.push(step.doors['5,3'].state); }
  assert.deepEqual(states, ['open', 'jammed', 'closed', 'open'], 'clicking steps through all three');
  assert.deepEqual(DOOR_STATES, ['closed', 'open', 'jammed']);

  // the same state is no change; a made-up one is ignored
  assert.deepEqual(playDoor(live, { x: 5, y: 3 }, 'closed'), {});
  assert.equal(playDoor(live, { x: 5, y: 3 }, 'wide open').doors['5,3'].state, 'open', 'an unknown state falls back to the next one');

  // without fog it is only the door
  const design = readMap({ ...base });
  const flip = playDoor(design, { x: 5, y: 3 });
  assert.equal(flip.doors['5,3'].state, 'open');
  assert.equal(flip.explored, undefined, 'a map being built has no fog to lift');
  assert.equal(flip.viewpoint, undefined);

  // a door nobody can see: the party is taken to be on one side of it
  const remote = readMap({ ...live });
  const far = playDoor(remote, { x: 10, y: 3 });
  assert.ok(far.viewpoint, 'lighting a door the party cannot reach puts the party beside it');
  assert.ok(far.explored['9,3'] && far.explored['11,3'], 'and brings in both sides');
  const farMap = readMap({ ...remote, ...far });
  assert.ok(seen(farMap, 7, 3) || seen(farMap, 12, 3), 'so something is actually on the board');

  // no viewpoint (a hand-revealed map): the door explores but there is nobody to cut off
  const hand = readMap({ ...base, fog: true, explored: { '2,3': true } });
  const handOpen = playDoor(hand, { x: 5, y: 3 });
  assert.ok(handOpen.explored['6,3']);
  assert.equal(handOpen.viewpoint, undefined, 'it does not invent a party');

  // the start survives a turn of the map
  const turned = rotateMap(readMap({ ...base, start: { x: 2, y: 3 } }), 1);
  assert.ok(turned.start, 'a quarter turn keeps the start');
  assert.ok(turned.floor[key(turned.start)], 'on a square that is still map');
  assert.equal(setStartRoom(turned, turned.start), null, 'and it is still in a room');
}
console.log('play.check.mjs: starting room and play doors passed');
