/* Shrinks a generated or uploaded image to a data URL.

   The battle map takes image bytes from /api, or from a file the DM picks, and
   keeps the result in the saved ground rather than on disk, so it is shrunk
   before it is stored. */
export async function shrinkToDataUrl(blob, max = 768, quality = 0.82) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

/* Prepares an uploaded image to sit beside the shipped floors: optionally
   centre-cropped square, scaled to the same 512 a generated ground is shrunk
   to, and encoded at the same quality. Returns the source size too, so the
   caller can say what it did rather than silently changing the file.

   512 is not a guess: a floor TILES, so one copy already spans a dozen
   squares at a normal zoom, and the library it is stored in has a real byte
   ceiling. */
export async function prepareTexture(blob, { max = 512, quality = 0.75, square = true, rect = null } = {}) {
  const bitmap = await createImageBitmap(blob);
  const sw = bitmap.width;
  const sh = bitmap.height;

  /* `rect` is the square the GM dragged to, in source pixels (see
     texturecrop.js). Without one the middle is taken, which is what this did
     before the crop window existed and is still the right default — the
     middle is the part someone framed, and the edges are where the letterbox
     and the stray caption live.

     Held inside the image here as well as there. This is the last point
     before the canvas, and drawImage given a source rect that hangs over the
     edge pads it with transparent, which then tiles across the whole deck. */
  const side = Math.min(sw, sh);
  const r = rect && square ? {
    size: Math.max(1, Math.min(side, Math.round(rect.size) || side)),
    sx: Math.round(rect.sx) || 0,
    sy: Math.round(rect.sy) || 0
  } : null;
  const sx = r ? Math.max(0, Math.min(sw - r.size, r.sx))
    : square ? Math.round((sw - side) / 2) : 0;
  const sy = r ? Math.max(0, Math.min(sh - r.size, r.sy))
    : square ? Math.round((sh - side) / 2) : 0;
  const cw = r ? r.size : square ? side : sw;
  const ch = r ? r.size : square ? side : sh;

  const scale = Math.min(1, max / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * scale));
  const h = Math.max(1, Math.round(ch * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, cw, ch, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, width: w, height: h, sourceWidth: sw, sourceHeight: sh, bytes: dataUrl.length };
}
