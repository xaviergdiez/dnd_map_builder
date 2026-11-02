/* Checks for the starting room, doors clicked in play, and the room and door
   lists the Play tab shows. Ported from the Rogue Trader map, minus its
   firing arcs and target bonus. */
import assert from 'node:assert/strict';
import {
  readMap, parseKey, visibleExplored, DOOR_STATES,
  setStartRoom, startPlay, playDoor, rotateMap, roomsOf, doorsOf, roomFog
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

  // closed -> open brings in what is beyond
  const open1 = playDoor(live, { x: 5, y: 3 });
  assert.equal(open1.doors['5,3'].state, 'open', 'a closed door opens on a click');
  assert.ok(open1.explored['6,2'] && open1.explored['9,4'], 'and the room beyond is explored');
  assert.ok(open1.explored['10,3'], 'as far as the next doorway');
  assert.ok(!open1.explored['11,3'], 'and no further');
  assert.deepEqual(open1.viewpoint, { x: 6, y: 3 }, 'the party goes through, into somewhere new');
  const m1 = readMap({ ...live, ...open1 });
  assert.ok(seen(m1, 2, 3) && seen(m1, 7, 3), 'both rooms are visible while the door is open');
  assert.ok(!seen(m1, 12, 3), 'the one past the next door is not');

  // the next door: the far room comes in, the party moves on
  const open2 = playDoor(m1, { x: 10, y: 3 });
  const m2 = readMap({ ...m1, ...open2 });
  assert.deepEqual(open2.viewpoint, { x: 11, y: 3 });
  assert.ok(seen(m2, 12, 3) && seen(m2, 7, 3) && seen(m2, 2, 3), 'the whole crawl is visible through open doors');

  // shutting the first behind them hides the way they came, and nothing else
  const shut = playDoor(m2, { x: 5, y: 3 });
  assert.equal(shut.doors['5,3'].state, 'open' === m2.doors['5,3'].state ? 'jammed' : 'closed');
  const m3 = readMap({ ...m2, ...playDoor(m2, { x: 5, y: 3 }, 'closed') });
  assert.equal(m3.doors['5,3'].state, 'closed');
  assert.ok(!seen(m3, 2, 3), 'the room behind a shut door is off the board');
  assert.ok(seen(m3, 7, 3) && seen(m3, 12, 3), 'the rooms the party is in and just left are still there');
  assert.ok(m3.explored['2,3'], 'but it is not forgotten');
  assert.equal(playDoor(m2, { x: 5, y: 3 }, 'closed').explored, undefined, 'shutting a door explores nothing');

  // jamming blocks as well; opening it again brings the room back, and the party stays put
  const m4 = readMap({ ...m3, ...playDoor(m3, { x: 5, y: 3 }, 'jammed') });
  assert.equal(m4.doors['5,3'].state, 'jammed');
  assert.ok(!seen(m4, 2, 3), 'a jammed door blocks like a closed one');
  const reopened = playDoor(m4, { x: 5, y: 3 }, 'open');
  assert.equal(reopened.viewpoint, undefined, 'reopening somewhere already seen does not move the party');
  assert.ok(seen(readMap({ ...m4, ...reopened }), 2, 3), 'and the room is back, as it was');

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

/* ---- the lists the Play tab shows ---- */
{
  const floor = {};
  for (let x = 1; x <= 14; x++) for (let y = 2; y <= 4; y++) floor[`${x},${y}`] = true;
  for (const x of [5, 10]) for (const y of [2, 4]) delete floor[`${x},${y}`];
  floor['5,3'] = true; floor['10,3'] = true;
  const base = readMap({
    cols: 20, rows: 8, floor, start: { x: 2, y: 3 },
    doors: { '10,3': { kind: 'trapdoor', state: 'jammed' }, '5,3': { kind: 'wooden', state: 'closed' } }
  });

  const rooms = roomsOf(base);
  assert.equal(rooms.length, 3, 'three rooms: a door divides, it is not one');
  assert.deepEqual(rooms.map((r) => [r.x0, r.x1]), [[1, 4], [6, 9], [11, 14]], 'left to right');
  assert.deepEqual(rooms.map((r) => r.cells), [12, 12, 12]);
  assert.ok(rooms.every((r) => r.keys.includes(`${r.rep.x},${r.rep.y}`)), 'the square that stands for a room is in it');
  assert.ok(rooms.every((r) => !base.doors[`${r.rep.x},${r.rep.y}`]));
  assert.ok(!rooms.some((r) => r.keys.includes('5,3') || r.keys.includes('10,3')), 'a doorway is in no room');
  assert.deepEqual(rooms[1].rep, { x: 7, y: 3 }, 'the middle square, or the nearest one to it');

  const doors = doorsOf(base);
  assert.deepEqual(doors.map((d) => [d.x, d.y, d.kind, d.state]), [[5, 3, 'wooden', 'closed'], [10, 3, 'trapdoor', 'jammed']], 'in order, with their kind and state');
  assert.deepEqual(doors[0].joins, [0, 1], 'D1 joins rooms 1 and 2');
  assert.deepEqual(doors[1].joins, [1, 2]);

  // fog per room
  assert.equal(roomFog(rooms[0], {}), 'dark');
  assert.equal(roomFog(rooms[0], startPlay(base).explored), 'lit', 'the start room is lit after starting play');
  assert.equal(roomFog(rooms[1], startPlay(base).explored), 'dark');
  assert.equal(roomFog(rooms[0], { '2,3': true }), 'part');

  // an open floor with no doors is one room; empty is none
  const hall = readMap({ cols: 30, rows: 30, floor: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${i % 10},${Math.floor(i / 10)}`, true])) });
  assert.equal(roomsOf(hall).length, 1);
  assert.deepEqual(doorsOf(hall), []);
  assert.deepEqual(roomsOf(readMap({})), []);
  // a door with no floor under it is not listed
  assert.deepEqual(doorsOf(readMap({ cols: 10, rows: 10, floor: { '1,1': true }, doors: { '4,4': { kind: 'wooden', state: 'open' } } })), []);

  // a big map is still quick: a 200x200 grid cut into 100 rooms by doors
  const big = {};
  const bd = {};
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) big[`${x},${y}`] = true;
  for (let x = 20; x < 200; x += 20) for (let y = 0; y < 200; y++) { delete big[`${x},${y}`]; }
  for (let x = 20; x < 200; x += 20) for (let y = 5; y < 200; y += 20) { big[`${x},${y}`] = true; bd[`${x},${y}`] = { kind: 'wooden', state: 'closed' }; }
  const t0 = Date.now();
  const bigRooms = roomsOf(readMap({ cols: 200, rows: 200, floor: big, doors: bd }));
  assert.ok(Date.now() - t0 < 3000, 'rooms of a 200x200 map take well under three seconds');
  assert.ok(bigRooms.length >= 10);
}
console.log('play.check.mjs: play lists passed');
