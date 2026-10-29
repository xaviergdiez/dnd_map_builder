// Self-check for the upload crop geometry. Run: node src/texturecrop.check.mjs
import assert from 'node:assert/strict';
import {
  coverScale, scaleBounds, clampCrop, centreCrop, cropRect, dragBy, zoomTo,
  MAX_SCALE_FACTOR
} from './texturecrop.js';

const BOX = 300;

/* ---- the covering scale ---- */

{
  // Landscape: the short side is what has to reach, so height decides.
  assert.equal(coverScale(1000, 500, 300), 0.6);
  // Portrait: width decides.
  assert.equal(coverScale(500, 1000, 300), 0.6);
  // Square at box size needs no scaling at all.
  assert.equal(coverScale(300, 300, 300), 1);
  // Smaller than the window has to be scaled UP, or it cannot cover it.
  assert.equal(coverScale(150, 150, 300), 2);

  // Nothing here may return 0 or NaN: every other function divides by it.
  for (const bad of [[0, 100, 300], [100, 0, 300], [100, 100, 0], [NaN, 1, 1]]) {
    assert.equal(coverScale(...bad), 1, `degenerate ${bad} must not poison the scale`);
  }
}

/* ---- THE INVARIANT: the window is always covered ---- */

{
  // Swept rather than spot-checked, because this is the one property the
  // whole module exists to hold and the failure is silent — a transparent
  // edge that only shows up once the texture is tiling across a deck.
  const sizes = [[1000, 500], [500, 1000], [640, 640], [150, 150], [4000, 3000], [301, 299]];
  const pushes = [-9999, -500, -1, 0, 1, 500, 9999];
  const scales = [0.01, 0.3, 1, 2, 50];
  for (const [w, h] of sizes) {
    for (const s of scales) {
      for (const x of pushes) {
        for (const y of pushes) {
          const c = clampCrop({ imgW: w, imgH: h, box: BOX, scale: s, x, y });
          assert.ok(c.x <= 0 && c.y <= 0, `top-left must not come inside (${w}x${h} s${s})`);
          assert.ok(w * c.scale + c.x >= BOX - 1e-9, `right edge gap (${w}x${h} s${s})`);
          assert.ok(h * c.scale + c.y >= BOX - 1e-9, `bottom edge gap (${w}x${h} s${s})`);
        }
      }
    }
  }
}

/* ---- the scale window ---- */

{
  const { min, max } = scaleBounds(1000, 500, BOX);
  assert.equal(min, 0.6);
  assert.equal(max, 0.6 * MAX_SCALE_FACTOR);
  // Asking for less than covering gets the covering scale, not the ask.
  assert.equal(clampCrop({ imgW: 1000, imgH: 500, box: BOX, scale: 0.01, x: 0, y: 0 }).scale, 0.6);
  assert.equal(clampCrop({ imgW: 1000, imgH: 500, box: BOX, scale: 99, x: 0, y: 0 }).scale, max);
}

/* ---- the default is the old behaviour ---- */

{
  // Upload and press straight through: the middle square, exactly as the
  // centre-crop took it before any of this existed. If this drifts, every
  // existing habit around the upload button changes under the GM.
  const c = centreCrop(1000, 500, BOX);
  const r = cropRect({ imgW: 1000, imgH: 500, box: BOX, ...c });
  assert.deepEqual(r, { sx: 250, sy: 0, size: 500 }, 'the middle 500 of a 1000x500');

  const p = cropRect({ imgW: 500, imgH: 1000, box: BOX, ...centreCrop(500, 1000, BOX) });
  assert.deepEqual(p, { sx: 0, sy: 250, size: 500 }, 'and of a portrait');

  const sq = cropRect({ imgW: 800, imgH: 800, box: BOX, ...centreCrop(800, 800, BOX) });
  assert.deepEqual(sq, { sx: 0, sy: 0, size: 800 }, 'a square image is taken whole');
}

/* ---- the cut-out stays inside the source ---- */

{
  const sizes = [[1000, 500], [500, 1000], [640, 640], [150, 150], [301, 299]];
  for (const [w, h] of sizes) {
    for (const s of [0.1, 0.6, 1, 3, 20]) {
      for (const x of [-9999, -200, 0, 9999]) {
        for (const y of [-9999, -200, 0, 9999]) {
          const r = cropRect({ imgW: w, imgH: h, box: BOX, scale: s, x, y });
          assert.ok(r.size >= 1, 'a crop is never empty');
          assert.ok(r.sx >= 0 && r.sy >= 0, `negative origin ${w}x${h}`);
          assert.ok(r.sx + r.size <= w, `runs off the right of ${w}x${h}`);
          assert.ok(r.sy + r.size <= h, `runs off the bottom of ${w}x${h}`);
          assert.equal(r.size, Math.round(r.size), 'whole pixels only');
        }
      }
    }
  }
}

/* ---- dragging ---- */

{
  const start = { imgW: 1000, imgH: 500, box: BOX, ...centreCrop(1000, 500, BOX) };
  const moved = dragBy(start, -60, 0);
  assert.equal(moved.x, start.x - 60, 'a drag inside the bounds moves by exactly that much');

  // Dragged hard against the edge it STOPS there, and one step back moves at
  // once. Accumulating past the stop is the classic version of this bug: the
  // first part of the drag back does nothing and the picture feels stuck.
  const pinned = dragBy(start, -99999, 0);
  assert.equal(pinned.x, BOX - 1000 * start.scale, 'stops at the right edge');
  assert.equal(dragBy(pinned, 25, 0).x, pinned.x + 25, 'and comes straight back');

  // CHAINED WITHOUT RE-SPREADING, which is how a drag actually arrives: one
  // call per pointer event, each fed the last result. A return that dropped
  // the image size would pin the picture here and nowhere else.
  let st = start;
  for (let i = 0; i < 5; i++) st = dragBy(st, -10, 0);
  assert.equal(st.x, start.x - 50, 'five steps move five steps');
  assert.equal(st.imgW, 1000, 'the state carries its image through a chain');
  assert.equal(zoomTo(dragBy(st, -5, 0), st.scale * 1.5).imgH, 500);

  // A portrait image has no vertical slack at the covering scale, so a
  // vertical drag is a no-op rather than a wobble.
  const tall = { imgW: 500, imgH: 1000, box: BOX, ...centreCrop(500, 1000, BOX) };
  assert.equal(dragBy(tall, 0, 40).x, tall.x);
}

/* ---- zooming holds the middle ---- */

{
  const st = { imgW: 1000, imgH: 500, box: BOX, ...centreCrop(1000, 500, BOX) };
  const before = cropRect(st);
  const inward = zoomTo(st, st.scale * 2);
  const after = cropRect({ ...st, ...inward });

  assert.ok(after.size < before.size, 'zooming in takes a smaller bite');
  // The centre of the bite stays put, which is what "about the centre" means.
  assert.ok(Math.abs((after.sx + after.size / 2) - (before.sx + before.size / 2)) <= 1,
    'the horizontal centre holds');
  assert.ok(Math.abs((after.sy + after.size / 2) - (before.sy + before.size / 2)) <= 1,
    'the vertical centre holds');

  // Zooming back out lands where it started, so the slider is reversible.
  const back = zoomTo({ ...st, ...inward }, st.scale);
  const r = cropRect({ ...st, ...back });
  assert.ok(Math.abs(r.sx - before.sx) <= 1 && Math.abs(r.sy - before.sy) <= 1,
    'out again returns to the same square');

  // And it never breaks the invariant on the way.
  for (const s of [0.001, 0.5, 1, 7, 1e6]) {
    const z = zoomTo(st, s);
    assert.ok(1000 * z.scale + z.x >= BOX - 1e-9 && 500 * z.scale + z.y >= BOX - 1e-9);
  }
}

/* ---- rubbish in ---- */

{
  // These come off pointer events and a number input, so NaN is a question of
  // when, not whether. None of them may produce a crop the canvas chokes on.
  const junk = { imgW: 1000, imgH: 500, box: BOX, scale: NaN, x: NaN, y: undefined };
  const c = clampCrop(junk);
  assert.ok(Number.isFinite(c.scale) && Number.isFinite(c.x) && Number.isFinite(c.y));
  const r = cropRect(junk);
  assert.ok(Number.isFinite(r.sx) && Number.isFinite(r.sy) && r.size >= 1);
  assert.ok(Number.isFinite(dragBy(junk, NaN, NaN).x));
  assert.ok(Number.isFinite(zoomTo(junk, 'nonsense').scale));
}

console.log('texturecrop.js: all checks passed');
