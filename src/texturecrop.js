/* Choosing WHICH square of an uploaded image becomes the floor tile.

   The upload used to take the middle and say so. That is the right default —
   the middle is the part someone framed — but it is only a default, and the
   interesting part of a photograph of ground is very often not the middle:
   the drain, the hatch plate, the patch of burnt deck are wherever they fell
   in the frame.

   So the picture is draggable under a fixed square window. The geometry is
   here, apart from React and apart from the canvas, because it is the part
   that is easy to get subtly wrong — an image that can be dragged off its own
   window leaves transparent edges in a texture that then tiles them across
   the whole deck.

   THE INVARIANT, and everything below exists to hold it: the scaled image
   always covers the window completely. No gap, at any scale, at any offset.

   Coordinates: `box` is the window's side in CSS pixels. `x`,`y` are the
   scaled image's top-left corner relative to the window's top-left, so they
   are zero or negative. `scale` multiplies source pixels to CSS pixels.
   See texturecrop.check.mjs. */

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* The smallest scale that still covers the window. Below this the image
   would show daylight at one edge, so this is the floor for every other
   calculation here, not a suggestion. */
export function coverScale(imgW, imgH, box) {
  const w = num(imgW), h = num(imgH), b = num(box);
  if (w <= 0 || h <= 0 || b <= 0) return 1;
  return Math.max(b / w, b / h);
}

/* How far in the GM may push it. Past 4x the covering scale a 512px tile is
   being cut from a couple of hundred source pixels and comes back as mush,
   and a limit that bites is kinder than a blurred floor discovered later. */
export const MAX_SCALE_FACTOR = 4;

export function scaleBounds(imgW, imgH, box) {
  const min = coverScale(imgW, imgH, box);
  return { min, max: min * MAX_SCALE_FACTOR };
}

/* Pulls any proposed state back inside the invariant. Everything that moves
   the crop — the drag, the slider, the wheel, the first open — goes through
   this, so there is one place where "cannot show a gap" is enforced.

   RETURNS THE WHOLE STATE, image size and window included, not just the three
   numbers it changed. A drag is a run of these applied one after the next,
   and a return that dropped imgW/imgH/box would need the caller to spread
   them back on every step; forgetting to is silent, because the next clamp
   then reads them as zero, decides nothing can move, and pins the picture. */
export function clampCrop({ imgW, imgH, box, scale, x, y }) {
  const w = num(imgW), h = num(imgH), b = num(box);
  const { min, max } = scaleBounds(w, h, b);
  const s = Math.min(max, Math.max(min, num(scale, min)));

  // The scaled image's size, and therefore how far it may slide before its
  // far edge comes inside the window.
  const sw = w * s, sh = h * s;
  const nx = Math.min(0, Math.max(b - sw, num(x)));
  const ny = Math.min(0, Math.max(b - sh, num(y)));
  return { imgW: w, imgH: h, box: b, scale: s, x: nx, y: ny };
}

/* The middle, at the scale that takes in as much as possible. This is exactly
   what the old centre-crop did, and it is deliberately still the starting
   point: someone who uploads a floor and presses straight through gets the
   same tile they got before this existed. */
export function centreCrop(imgW, imgH, box) {
  const w = num(imgW), h = num(imgH), b = num(box);
  const scale = coverScale(w, h, b);
  return clampCrop({
    imgW: w, imgH: h, box: b, scale,
    x: (b - w * scale) / 2,
    y: (b - h * scale) / 2
  });
}

/* The square to cut out of the SOURCE image, in source pixels. This is what
   the canvas is handed, so it is rounded and held inside the image: a
   half-pixel over the edge is a line of transparent that tiles into a grid
   of its own across the deck. */
export function cropRect({ imgW, imgH, box, scale, x, y }) {
  const w = Math.round(num(imgW)), h = Math.round(num(imgH)), b = num(box);
  const c = clampCrop({ imgW: w, imgH: h, box: b, scale, x, y });
  const size = Math.max(1, Math.min(w, h, Math.round(b / c.scale)));
  const sx = Math.max(0, Math.min(w - size, Math.round(-c.x / c.scale)));
  const sy = Math.max(0, Math.min(h - size, Math.round(-c.y / c.scale)));
  return { sx, sy, size };
}

/* Dragging. The pointer moves in CSS pixels and so does the offset, so this
   is an addition — but it still goes through the clamp, because a drag that
   runs past the edge must stop dead there rather than keep accumulating and
   leave the picture stuck for the first part of the drag back. */
export function dragBy(state, dx, dy) {
  return clampCrop({ ...state, x: num(state.x) + num(dx), y: num(state.y) + num(dy) });
}

/* Zooming about the window's centre, so the thing being looked at stays put
   instead of running off toward a corner. */
export function zoomTo(state, nextScale) {
  const b = num(state.box);
  const cur = clampCrop(state);
  const { min, max } = scaleBounds(state.imgW, state.imgH, b);
  const s = Math.min(max, Math.max(min, num(nextScale, cur.scale)));
  const k = s / cur.scale;
  // Where the window's centre sits in the image, held across the change.
  return clampCrop({
    ...state, scale: s,
    x: b / 2 - (b / 2 - cur.x) * k,
    y: b / 2 - (b / 2 - cur.y) * k
  });
}
