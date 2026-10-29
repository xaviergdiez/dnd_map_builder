/* Cuts the master sprite sheets into the tokens the app draws.

   Run by hand, not by the build, and the output is committed:

     node tools/slice-sprites.mjs            # art/sprites -> public/maps/tokens
     node tools/slice-sprites.mjs --size 320 # bigger tokens
     node tools/slice-sprites.mjs --dry      # say what it would do

   WHY THE MASTERS ARE NOT IN public/
   A sheet is a 2048px JPEG weighing about 3MB, and there are nine. Left where
   they arrived — public/maps/sprites — every one of them is a static asset on
   the deployment, 29MB of art shipped to hold 3MB of tokens, and any of it a
   stray URL could pull down in full. They live in art/ instead, which Vite
   does not copy, and this tool is the only thing that reads them.

   WHY sharp IS A devDependency
   It is a native library and it is big, and it never runs in the browser or in
   a Vercel function: it runs here, on a desktop, when new art arrives. The
   browser does the same job with a canvas (see src/BattleMap.jsx, which cuts
   up sheets the GM generates during a session) using the same keying rules out
   of src/spritesheet.js, so the two cannot drift. */

import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  SHEET_CELLS, SPRITE_SLOTS, SHEET_FOR_THEME, cellRect, keyBlack, cellCoverage, MIN_COVERAGE
} from '../src/spritesheet.js';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'art', 'sprites');
const OUT = join(ROOT, 'public', 'maps', 'tokens');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SIZE = Math.max(64, Math.min(512, Number(arg('size', 256))));
const QUALITY = Math.max(40, Math.min(100, Number(arg('quality', 82))));
const DRY = process.argv.includes('--dry');

// Sheet file -> theme id, the other way round from the app's lookup.
const THEME_FOR_SHEET = Object.fromEntries(
  Object.entries(SHEET_FOR_THEME).map(([theme, sheet]) => [sheet, theme]));

const kb = (n) => (n / 1024).toFixed(0) + 'kB';

/* One cell, cut at full resolution and shrunk only afterwards. In that order
   on purpose — shrinking first would average the art with the background it
   has not been separated from yet, and every token would come out with a dark
   halo baked in that no later keying could find.

   The sheet is keyed WHOLE, before any of this, so that the flood fill which
   separates background from the art's own shadows sees one continuous
   background rather than sixteen framed ones — and so that it does exactly
   what the browser does to a generated sheet.

   The cell is copied out of the sheet's pixels by hand rather than with
   sharp's extract, because a sharp pipeline is single use: asking one for
   sixteen different crops gets you one crop and fifteen errors, and building
   sixteen pipelines decodes the same 2048px JPEG sixteen times. */
async function cutCell(raw, sheetW, sheetH, index) {
  const r = cellRect(index, sheetW, sheetH);
  const cell = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * sheetW + r.x) * 4;
    cell.set(raw.subarray(from, from + r.w * 4), y * r.w * 4);
  }

  const coverage = cellCoverage(cell);

  const webp = await sharp(Buffer.from(cell.buffer, cell.byteOffset, cell.length),
    { raw: { width: r.w, height: r.h, channels: 4 } })
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .webp({ quality: QUALITY, alphaQuality: 90, effort: 6 })
    .toBuffer();
  return { webp, coverage };
}

async function main() {
  let sheets;
  try {
    sheets = (await readdir(SRC)).filter((f) => /_sprite\.(jpe?g|png)$/i.test(f)).sort();
  } catch {
    console.error(`No ${SRC}. Put the master sheets there (named for the sheet in SHEET_FOR_THEME, e.g. Crypt_sprite.jpg).`);
    process.exit(1);
  }
  if (sheets.length === 0) { console.error(`No *_sprite.* files in ${SRC}.`); process.exit(1); }

  let totalBytes = 0;
  let thin = 0;
  const unknown = [];

  for (const file of sheets) {
    const name = file.replace(/_sprite\.(jpe?g|png)$/i, '');
    const theme = THEME_FOR_SHEET[name];
    if (!theme) { unknown.push(name); continue; }

    const path = join(SRC, file);
    const src = (await stat(path)).size;
    // Decoded once, in full, with an alpha channel the JPEG does not have —
    // keyBlack writes into it.
    const { data: raw, info: meta } = await sharp(path, { limitInputPixels: 80e6 })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    if (meta.width % 4 || meta.height % 4) {
      console.warn(`  ! ${file} is ${meta.width}x${meta.height}; cells will lose the odd pixel`);
    }

    // The black into alpha, once, over the whole sheet.
    keyBlack(raw, { w: meta.width, h: meta.height });

    const dir = join(OUT, theme);
    if (!DRY) await mkdir(dir, { recursive: true });

    let sheetBytes = 0;
    const flags = [];
    for (let i = 0; i < SHEET_CELLS; i++) {
      const { webp, coverage } = await cutCell(raw, meta.width, meta.height, i);
      const role = SPRITE_SLOTS[i].role;
      if (coverage < MIN_COVERAGE) { flags.push(`${role} looks empty (${(coverage * 100).toFixed(1)}%)`); thin++; }
      if (!DRY) await writeFile(join(dir, role + '.webp'), webp);
      sheetBytes += webp.length;
    }
    totalBytes += sheetBytes;
    console.log(`${theme.padEnd(20)} ${String(SHEET_CELLS).padStart(2)} tokens  ${kb(src).padStart(7)} -> ${kb(sheetBytes).padStart(6)}`);
    for (const f of flags) console.log('   !', f);
  }

  for (const n of unknown) {
    console.warn(`  ! ${n}_sprite: no theme claims this sheet. Add it to SHEET_FOR_THEME in src/spritesheet.js.`);
  }
  console.log(`\n${SIZE}px, quality ${QUALITY}: ${kb(totalBytes)} of tokens in all${DRY ? ' (dry run, nothing written)' : ''}`);
  if (thin) console.log(`${thin} cell(s) came out nearly empty — look at those before shipping them.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
