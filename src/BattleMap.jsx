import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MAP_THEMES, themeById, readMap, cellKey, parseKey,
  TILE_CATALOG, TILE_CATEGORIES, stampCells, paintCells,
  wallMask, cornerPillar, WALL_N, WALL_E, WALL_S, WALL_W,
  DOOR_STATES, nextDoorState, MARKER_TYPES, markerTypeById,
  reachBetween, rangeRings, areaCells, visibleCells,
  onDeck, revealArea, concealArea, visibleExplored, fitGrid, brushCells,
  clampZoom, MIN_ZOOM, MAX_ZOOM, textureAdvice, rotateMap, rotationFits,
  expandMap, expandPlan, MIN_GRID, MAX_GRID, MAX_CUSTOM_SPRITES,
  resolveTheme, themeNumbersFor, groundsUsed, tokensNeeded,
  DOOR_KINDS, doorKindById, COVER_TYPES, coverById, readCover, writeCover,
  HAZARD_TYPES, hazardById,
  nextContactState, senseSweep, SENSE_RANGE_FT,
  OBSCURING, obscuringById, LIGHTING_PRESETS, lightingById, blockedText, lineBlocked, LOS_MAX_SQUARES, keepClean,
  areaFor, calibrationBar, deploymentRows,
  setStartRoom, startPlay, playDoor, regionAt
} from './battlemap.js';
import { NOISE, noiseById, noisePing } from './awareness.js';
import { overlayOf, overlayKindFor, FEET_PER_SQUARE, CONE_HALF_ANGLE_DEG, coverDegree, footprintSquares } from './rules.js';
import { WEAPONS, SPELLS, MONSTERS, entryFor, weaponKey, spellKey, spellLabel, monsterByName, monsterLabel } from './library.js';
import { shrinkToDataUrl, prepareTexture } from './imageshrink.js';
import { centreCrop, cropRect, dragBy, zoomTo, scaleBounds } from './texturecrop.js';
import { generateDeck, growDeck as buildAroundDeck, newSeed, DECK_STYLES, styleById } from './mapgen.js';
import {
  spriteRole, spriteTurn, SHEET_FOR_THEME, SPRITE_SLOTS, cellRect, keyBlack
} from './spritesheet.js';
import { generateTerrain, readTerrainPrompt, TERRAIN_SIZES, TERRAIN_SCOPES } from './terrain.js';
import { ENVIRONMENTS, CONDITIONS, MAX_DESCRIBE } from '../lib/mapprompt.js';

/* The battle map, projected under physical miniatures.

   Nothing here draws a combatant: the models on the table are the
   combatants, and a painted circle would sit under one and fight it for the
   square. What the projector adds instead is the things a model cannot show
   — range bands, spell areas, auras and what can actually be seen from a
   square.

   Everything numeric lives in rules.js and battlemap.js and is checked there.
   This file is the canvas and the controls. */

/* The crop window's side, in CSS pixels. A display size, not the stored one:
   the tile is written at 512 whatever this is. Big enough to judge what is
   in the square, small enough to sit in the panel beside its controls. */
const CROP_BOX = 240;

const MODES = [
  { id: 'stamp', label: 'Stamp tile', icon: 'stamp' },
  { id: 'paint', label: 'Paint floor', icon: 'paint' },
  { id: 'ground', label: 'Paint ground', icon: 'ground' },
  { id: 'erase', label: 'Erase', icon: 'erase' },
  { id: 'door', label: 'Door', icon: 'door' },
  { id: 'cover', label: 'Cover', icon: 'cover' },
  { id: 'hazard', label: 'Hazard', icon: 'hazard' },
  { id: 'obscure', label: 'Foliage / fog', icon: 'foliage' },
  { id: 'contact', label: 'Contacts', icon: 'contact' },
  { id: 'noise', label: 'Noise', icon: 'noise' },
  { id: 'start', label: 'Starting room', icon: 'flag' },
  { id: 'fog', label: 'Fog and doors in play', icon: 'fog' },
  { id: 'marker', label: 'Marker', icon: 'marker' },
  { id: 'overlay', label: 'Overlay', icon: 'overlay' },
  { id: 'measure', label: 'Measure', icon: 'measure' }
];

/* THE TWO TABS. A map is built and then it is played, and the tools for the two
   have little in common: stamping tiles has no place at a table with the fog on,
   and revealing a room has none while the map is being drawn. Build holds the
   tools that make the map; Play holds the ones that run it, with the fog and
   the doors in one place, clickable. Measure is wanted in both. */
const BUILD_TOOLS = ['stamp', 'paint', 'ground', 'erase', 'door', 'cover', 'hazard', 'obscure', 'start', 'marker', 'measure'];
const PLAY_TOOLS = ['fog', 'contact', 'noise', 'overlay', 'measure'];
const toolsOf = (tab) => MODES.filter((x) => (tab === 'play' ? PLAY_TOOLS : BUILD_TOOLS).includes(x.id));

// The weapons, melee first and then ranged, each by name: the picker for the
// bar and the right-click menu. The spells are too many for a list and are
// searched by name instead (see the datalist in the overlay bar).
const ARMED = WEAPONS
  .map((w) => ({ key: weaponKey(w.name), label: w.name, kind: w.kind }))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));

/* ---- the toolbar's icons ----
   Drawn here rather than imported: a dozen strokes each, no dependency, and
   they take their colour from the button they sit in. Every one is a 24-square
   grid of lines, so they read as one set. A button that is only an icon always
   carries its name as a tooltip and an aria-label. */
const ICONS = {
  stamp: <><path d="M9 3h6v6l3 3v3H6v-3l3-3z" /><path d="M5 20h14" /></>,
  paint: <><rect x="4" y="4" width="16" height="16" /><path d="M12 4v16M4 12h16" /><rect x="4" y="4" width="8" height="8" fill="currentColor" /></>,
  ground: <><path d="M3 18l6-9 4 5 3-4 5 8z" /><path d="M3 21h18" /></>,
  erase: <><path d="M4 15l9-9 6 6-7 7H8z" /><path d="M9 10l6 6M13 20h7" /></>,
  door: <><path d="M6 21V4h12v17M4 21h16" /><circle cx="15" cy="12.5" r="1" fill="currentColor" /></>,
  cover: <><rect x="4" y="5" width="16" height="14" /><path d="M4 5l16 14M20 5L4 19" /></>,
  hazard: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  foliage: <><path d="M7 18a4 4 0 010-8 5 5 0 019.5-1A4.5 4.5 0 0117 18z" /></>,
  contact: <><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="10" /></>,
  noise: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" /></>,
  fog: <><path d="M3 8h12M6 12h15M3 16h10M9 20h12" /></>,
  marker: <><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  flag: <><path d="M6 21V4" /><path d="M6 4h11l-2.5 4L17 12H6" /></>,
  overlay: <><circle cx="12" cy="12" r="6" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>,
  measure: <><path d="M3 17L17 3l4 4L7 21z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>,
  rotateLeft: <><path d="M3 4v6h6" /><path d="M5.5 15a8 8 0 105-9.5L3 10" /></>,
  rotateRight: <><path d="M21 4v6h-6" /><path d="M18.5 15a8 8 0 11-5-9.5L21 10" /></>,
  pan: <><path d="M12 2v20M2 12h20" /><path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" /></>,
  zoomIn: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5M8 11h6" /></>,
  fit: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></>,
  hide: <><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0112 6c5 0 8.5 4 10 6-.7 1-1.8 2.3-3.2 3.4M6.5 7.3C4.2 8.8 2.6 10.9 2 12c1.5 2 5 6 10 6 1.5 0 2.8-.3 4-.9" /></>,
  show: <><path d="M2 12c1.5-2 5-6 10-6s8.5 4 10 6c-1.5 2-5 6-10 6S3.5 14 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  full: <><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></>,
  present: <><rect x="3" y="4" width="18" height="12" /><path d="M8 20h8M12 16v4" /></>,
  save: <><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></>,
  grid: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>
};

function Icon({ name, size = 18 }) {
  return (
    <svg className="bm-ico" viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* A button that is only a picture, with its name on it for the pointer and the
   screen reader alike.

   The name is also drawn as a tooltip of our own. `title` stays — it is what
   a screen reader reads and what a patient pointer gets — but the browser
   waits about a second before showing it and draws it in system grey, which
   is long enough that a GM mid-session guesses at a dozen icons instead of
   reading them. This one appears at once, in the app's own type.

   It is nudged sideways when it would run off the window: the toolbar wraps,
   so a button regularly ends a row hard against the right edge, and a
   centred tooltip would hang half its text outside the glass.

   The nudge is worked out from where the tooltip WOULD sit, centred on the
   button, rather than from where it currently sits. An incremental
   correction looks the same in one pass and is wrong in two: `place` runs
   from more than one event, both passes measure the same unmoved tooltip,
   and the shifts add up — the first version pushed a tooltip 182px when 91
   was the whole fix, which left it nowhere near its own icon. */
function IconButton({ icon, label, onClick, on = false, disabled = false, className = '' }) {
  const tipRef = useRef(null);
  const [shift, setShift] = useState(0);
  const place = (e) => {
    const btn = e.currentTarget;
    const tip = tipRef.current;
    if (!tip) return;
    const view = btn.ownerDocument.defaultView || window;
    const b = btn.getBoundingClientRect();
    // The width is the one measurement the shift cannot affect — and it is
    // the real width, so a two-word label is not moved as if it were a
    // sentence. Hidden with visibility rather than display precisely so
    // there is a box to measure before anyone has seen it.
    const half = tip.getBoundingClientRect().width / 2;
    const mid = b.left + b.width / 2;
    const pad = 8;
    let want = 0;
    if (mid + half > view.innerWidth - pad) want = (view.innerWidth - pad) - (mid + half);
    if (mid - half + want < pad) want = pad - (mid - half);
    setShift(Math.round(want));
  };
  return (
    <button type="button" className={'bm-ico-btn' + (on ? ' on' : '') + (className ? ' ' + className : '')}
      title={label} aria-label={label} aria-pressed={on || undefined}
      disabled={disabled} onClick={onClick}
      onMouseEnter={place} onFocus={place}
      // Measured again next time rather than kept: the window may have been
      // resized, or the bar rewrapped, since this one was placed.
      onMouseLeave={() => setShift(0)} onBlur={() => setShift(0)}>
      <Icon name={icon} />
      <span className="bm-ico-tip" ref={tipRef} aria-hidden="true"
        style={{ '--tip-shift': shift + 'px' }}>{label}</span>
    </button>
  );
}

/* ---- prop sheets in the browser ----

   The nine sheets that ship are cut up on a desktop by tools/slice-sprites.mjs.
   A sheet the GM generates mid-session has to be cut up here, by the same
   rules out of spritesheet.js, or a generated set would not sit beside a
   shipped one.

   Two steps, and the ORDER is the thing. The black is keyed into alpha at the
   size it arrived, and only then is the sheet shrunk for storage. Shrinking
   first averages each token with a background it has not been separated from
   yet, and bakes in a dark fringe that no later keying can find — the same
   trap the desktop tool documents, and it is easier to fall into here because
   a canvas makes the shrink the convenient thing to do first. */
function imageFrom(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/* 768 across, so each of the sixteen cells is 192px.

   Measured rather than chosen: the shipped sheets, keyed and re-encoded, come
   to 535-840KB as data URLs at 1024, against a store that refuses anything
   over 900KB. A busy sheet — the jungle one — sits 60KB under the ceiling,
   which means a busier generated one fails to save AFTER the GM has paid for
   the call. At 768 the same three land at 317-485KB, roughly half the budget,
   and 192px a cell is still more than a 40-96px square ever asks for. */
async function keySheet(blob, { store = 768, quality = 0.78 } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await imageFrom(url);
    // Square, and the smaller side wins: a sheet that came back 1024x1032
    // must still cut into sixteen equal cells.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('That sheet came back empty.');

    const full = document.createElement('canvas');
    full.width = side; full.height = side;
    const fg = full.getContext('2d', { willReadFrequently: true });
    fg.drawImage(img, 0, 0, side, side, 0, 0, side, side);
    const px = fg.getImageData(0, 0, side, side);
    // The dimensions matter: without them the keying cannot tell the art's own
    // dark shadows from background showing through, and two thirds of a dark
    // token comes out see-through.
    keyBlack(px.data, { w: side, h: side });
    fg.putImageData(px, 0, 0);

    // Now it may be shrunk: every pixel carries its own alpha, so the filter
    // mixes art with transparency rather than with black.
    const out = document.createElement('canvas');
    out.width = Math.min(store, side); out.height = out.width;
    const og = out.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(full, 0, 0, out.width, out.height);
    return out.toDataURL('image/webp', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* A stored sheet into sixteen pictures, by role. Canvases rather than Images
   because drawImage takes either and this way nothing is encoded, decoded and
   re-encoded on the way to being drawn. The sheet is already transparent —
   keySheet did that before it was stored — so this is pure cutting. */
function sliceSheet(img) {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const out = {};
  for (const s of SPRITE_SLOTS) {
    const r = cellRect(s.slot, side, side);
    const c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    out[s.role] = c;
  }
  return out;
}

/* Draws one prop picture into its square, turned a quarter at a time where
   that prop has no front (see spriteTurn). The turn is about the square's own
   centre, so a rotated crate stays in its square rather than wandering into
   the next one. */
function drawToken(ctx, tok, x0, y0, px) {
  if (!tok.turn) { ctx.drawImage(tok.img, x0, y0, px, px); return; }
  ctx.save();
  ctx.translate(x0 + px / 2, y0 + px / 2);
  ctx.rotate((tok.turn * Math.PI) / 2);
  ctx.drawImage(tok.img, -px / 2, -px / 2, px, px);
  ctx.restore();
}

/* ---- overlay art ----
   Drawn rather than blitted. A template has to be whatever radius or length
   the spell says, and a bitmap stretched from 5 feet to 120 goes soft at
   the edges and lies about where it stops; a gradient is sharp at any size,
   recolours per theme and costs nothing to load. */

// A soft glowing annulus. Canvas cannot blur a stroke, so the glow is a
// radial gradient whose stops crowd around the radius — the ring IS the
// gradient rather than a line with an effect on it.
function glowRing(ctx, cx, cy, radiusPx, rgb, width = 0.14) {
  const inner = Math.max(0, radiusPx * (1 - width));
  const outer = radiusPx * (1 + width);
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(0.5, `rgba(${rgb},0.7)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();
}

// Cardinal ticks across a ring, so it can be read from any side of the
// table rather than only where its label happens to sit.
function ringTicks(ctx, cx, cy, radiusPx, len, colour) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (radiusPx - len), cy + Math.sin(a) * (radiusPx - len));
    ctx.lineTo(cx + Math.cos(a) * (radiusPx + len), cy + Math.sin(a) * (radiusPx + len));
    ctx.stroke();
  }
}

// A burst: a hot core at the point of impact and a glowing
// boundary ring at the edge of the radius, with clear air between them. The
// two circles carry different information — where it lands and how far it
// reaches — and one gradient blurring from the middle to the edge says
// neither clearly.
function drawBlast(ctx, cx, cy, radiusPx) {
  if (radiusPx <= 0) return;
  glowRing(ctx, cx, cy, radiusPx, '255,165,45', 0.13);
  ctx.strokeStyle = 'rgba(225,95,25,0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ringTicks(ctx, cx, cy, radiusPx, radiusPx * 0.09, 'rgba(255,215,120,0.95)');

  const core = radiusPx * 0.34;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, core);
  g.addColorStop(0, 'rgba(255,236,190,0.85)');
  g.addColorStop(0.45, 'rgba(255,186,70,0.7)');
  g.addColorStop(0.85, 'rgba(240,120,40,0.35)');
  g.addColorStop(1, 'rgba(240,120,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, core, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,110,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// An aura: a bright rim with a hex lattice inside it. The lattice is
// what makes it read as a field rather than a puddle, and it stays faint
// enough to see the models standing in it.
function drawShield(ctx, cx, cy, radiusPx) {
  if (radiusPx <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.clip();

  const s = Math.max(5, radiusPx / 5);          // hex circumradius
  const stepX = s * 1.5;
  const stepY = s * Math.sqrt(3);
  const cols = Math.ceil(radiusPx / stepX) + 1;
  const rows = Math.ceil(radiusPx / stepY) + 1;
  ctx.lineWidth = 1;
  for (let i = -cols; i <= cols; i++) {
    for (let j = -rows; j <= rows; j++) {
      const hx = cx + i * stepX;
      const hy = cy + j * stepY + (i % 2 ? stepY / 2 : 0);
      // Banded like the reference: brightest across the middle, fading top
      // and bottom, so the field has depth instead of reading as wallpaper.
      const fade = 1 - Math.min(1, Math.abs(hy - cy) / radiusPx);
      if (fade <= 0.02) continue;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        const px2 = hx + s * 0.92 * Math.cos(a);
        const py2 = hy + s * 0.92 * Math.sin(a);
        if (k === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(120,215,255,${0.1 * fade})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0,229,255,${0.3 * fade})`;
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,242,254,0.95)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
}

// A cone: brightest at the point, fading to the limit of its length, drawn
// with a FLAT far edge because that is what a 5e cone is — as wide at the end
// as it is long. The corners therefore sit further out than the length,
// at length / cos(half-angle), and the caller clips the whole shape to the
// squares the cone actually catches.
function drawCone(ctx, ox, oy, aimRad, lengthPx, halfRad) {
  if (lengthPx <= 0) return;
  const far = lengthPx / Math.cos(halfRad);
  const ax = ox + Math.cos(aimRad - halfRad) * far, ay = oy + Math.sin(aimRad - halfRad) * far;
  const bx = ox + Math.cos(aimRad + halfRad) * far, by = oy + Math.sin(aimRad + halfRad) * far;
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, far);
  g.addColorStop(0, 'rgba(255,241,180,0.75)');
  g.addColorStop(0.35, 'rgba(255,170,40,0.55)');
  g.addColorStop(0.8, 'rgba(231,76,60,0.3)');
  g.addColorStop(1, 'rgba(231,76,60,0.12)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(ox, oy); ctx.lineTo(ax, ay); ctx.lineTo(bx, by);
  ctx.closePath();
  ctx.fill();

  // Edges down both sides and across the end: the gradient fades before the
  // cone does, so without these it appears to stop short of where it reaches.
  ctx.strokeStyle = 'rgba(255,170,60,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ax, ay); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(bx, by); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,130,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
}

// The shot itself: a glowing beam with a head, so a measured line reads as a
// line of fire and not as a stray guide.
function drawBeam(ctx, x1, y1, x2, y2, rgb) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${rgb},0.22)`;
  ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb},0.5)`;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // Arrowhead at the target end, in a contrasting colour so the direction
  // of the shot is readable at a glance across a lit table.
  const head = 11;
  ctx.fillStyle = 'rgba(0,229,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.42), y2 - head * Math.sin(ang - 0.42));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.42), y2 - head * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* Confines a template's artwork to the squares it actually reaches. Without
   this the smooth shape is drawn over walls and sealed doors while the
   trimmed cell list says otherwise — and the artwork is what the table
   reads, so the projection would show fire crossing a shut hatch. */
function clipToCells(ctx, cells, px, draw) {
  if (!cells.length) return;
  ctx.save();
  ctx.beginPath();
  for (const c of cells) ctx.rect(c.x * px, c.y * px, px, px);
  ctx.clip();
  draw();
  ctx.restore();
}

/* A shot: a beam from the firer to what they are shooting at. A clear lane
   is one beam end to end; a blocked one stops dead at whatever stopped it
   and continues as a thin dashed line, so the picture agrees with the label
   instead of drawing confidently through a sealed door. */
function drawShot(ctx, px, from, to, blocked) {
  const x1 = from.x * px + px / 2, y1 = from.y * px + px / 2;
  const x2 = to.x * px + px / 2, y2 = to.y * px + px / 2;
  if (!blocked) {
    drawBeam(ctx, x1, y1, x2, y2, '168,130,255');
    return;
  }
  const bx = blocked.x * px + px / 2, by = blocked.y * px + px / 2;
  drawBeam(ctx, x1, y1, bx, by, '231,76,60');
  ctx.strokeStyle = 'rgba(231,76,60,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 3;
  ctx.strokeRect(blocked.x * px + 2, blocked.y * px + 2, px - 4, px - 4);
}

const BAND_COLOUR = {
  reach: 'rgba(46,204,113,0.85)',
  normal: 'rgba(255,255,255,0.7)',
  long: 'rgba(230,126,34,0.75)'
};

/* One trip to the image endpoint, for a floor or for a sheet of props. Returns
   the image as a blob, or throws with something a person can act on.

   `vite dev` has no /api: it answers the POST with the app's own page and a
   200, which would otherwise surface as an image that will not decode. */
async function requestImage(body) {
  const res = await fetch('/api/generate-texture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let why = `Generation failed (${res.status})`;
    try { why = (await res.json()).error || why; } catch { /* not json */ }
    throw new Error(why);
  }
  if (!/^image\//.test(res.headers.get('content-type') || '')) {
    throw new Error('Image generation needs the API: run `vercel dev` with GEMINI_API_KEY set. '
      + 'Uploading a floor of your own works without it.');
  }
  return res.blob();
}

// "half cover +2": what a cover type is worth to a target behind it, in 5e's
// own words. Total cover has no bonus: it cannot be targeted at all.
const coverText = (c) => {
  const d = coverDegree(c.degree);
  return d ? (d.ac === null ? d.name.toLowerCase() : `${d.name.toLowerCase()} +${d.ac}`) : '';
};

export default function BattleMap({
  map, onChange, historyKey = null, win = null, customThemes = [], onSaveTheme = null,
  decks = [], onSaveDeck = null, onLoadDeck = null, onDeleteDeck = null
}) {
  const m = useMemo(() => readMap(map), [map]);
  const theme = resolveTheme(m.theme, customThemes);

  // A map with the fog on is one being played, so it opens on the Play tab with
  // the tool that runs a crawl in hand; a map being drawn opens on Build.
  const [tab, setTab] = useState(m.fog ? 'play' : 'build');
  const [mode, setMode] = useState(m.fog ? 'fog' : 'stamp');
  const tabRef = useRef(tab);
  const modeRef = useRef(mode);
  tabRef.current = tab;
  modeRef.current = mode;
  // The tool last used on each tab, so going back to one finds it as it was.
  const lastToolRef = useRef({ build: 'stamp', play: 'fog' });
  const [tileId, setTileId] = useState('corridor_1x5');
  const [rotation, setRotation] = useState(0);
  const [markerType, setMarkerType] = useState('objective');
  const [brush, setBrush] = useState(1);
  // How big a cloud the right-click menu lays: smoke is an area, and one square
  // of it is no smoke at all. Apart from the brush so changing one is not
  // changing the other.
  const [cloud, setCloud] = useState(3);
  /* A VIEW control, deliberately not stored on the map. px/square is the
     projector's calibration and must not move; zoom scales what is already
     drawn so the GM can read a corner or take in the whole deck. On the
     projector it belongs at 100%, which is why it resets rather than
     following the deck around. */
  const [zoom, setZoom] = useState(1);
  // The box holds what is being TYPED, which may be empty or half a number;
  // `zoom` only ever holds a usable one.
  const [zoomPct, setZoomPct] = useState('100');
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  // Saving the deck from here. The target is PICKED, never guessed: writing
  // over the wrong deck and quietly making a duplicate are both losses, and
  // this window is where a GM works without the library in front of them.
  const [deckTarget, setDeckTarget] = useState('');
  const [deckName, setDeckName] = useState('');
  const [deckNote, setDeckNote] = useState('');
  const [deckMsg, setDeckMsg] = useState('');
  const [doorKind, setDoorKind] = useState('wooden');
  const [coverType, setCoverType] = useState('barrels');
  /* Which way the next barrier lies: 0 across the square, 1 standing up it.
     Only a low barrier has a direction worth choosing — crates, machinery and
     a pillar fill their square and are already turned by position so a run of
     them does not look stamped — so the control only appears for that one,
     but the number is stored for any cover, because turning the whole deck
     has to turn whatever is on it. */
  const [coverTurn, setCoverTurn] = useState(0);
  const [hazardType, setHazardType] = useState('fire');
  const [obscureType, setObscureType] = useState('medium');
  const [noiseKind, setNoiseKind] = useState('melee');
  // What the next contact is called: typed, because the DM knows what they hid.
  const [contactName, setContactName] = useState('Goblin');
  const [senseFt, setSenseFt] = useState(SENSE_RANGE_FT);
  const [genOpen, setGenOpen] = useState(false);
  const [genDescribe, setGenDescribe] = useState('');
  const [genCover, setGenCover] = useState('');
  const [genCond, setGenCond] = useState('none');
  const [genName, setGenName] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  // Its own flag, not genBusy: the props take their own trip to the model and
  // the floor's buttons should not all grey out while they are coming.
  const [propsBusy, setPropsBusy] = useState(false);

  /* ---- asking before something destructive, INSIDE the map ----

     window.confirm looked like the simple answer and was the wrong one, in
     two ways that both end with the GM pressing a button and nothing
     happening:

     1. THIS COMPONENT RUNS IN THE DASHBOARD'S JS CONTEXT even when it is
        painted into the popped-out map window, because it gets there through
        a React portal (see MapWindow.jsx). So bare `window` is the DASHBOARD's
        window, and `window.confirm` opened a dialog on a window sitting
        BEHIND the map — invisible, unclickable, and holding the map's own
        code hostage until something was clicked. "Clear the deck does
        nothing" was this.
     2. Even addressed to the right window it is wrong for the one screen that
        matters most. The map is run full screen on a projector, and a browser
        chrome dialog over a projected deck is either suppressed or is a grey
        system box in front of the table.

     So the map asks in its own panel, rendered inside its own DOM — which is
     whichever window the map is in — and the handlers await the answer. */
  const [ask, setAsk] = useState(null);
  // The resolve lives in a ref rather than in the state: putting it in state
  // means settling it from inside a state updater, and an updater that has a
  // side effect is run twice by StrictMode.
  const askRef = useRef(null);
  const confirmInMap = (opts) => new Promise((resolve) => {
    // A second question while one is up would strand the first handler
    // waiting for an answer that can never come. Decline it instead.
    if (askRef.current) { resolve(false); return; }
    askRef.current = resolve;
    setAsk(opts);
  });
  const closeAsk = (yes) => {
    const settle = askRef.current;
    askRef.current = null;
    setAsk(null);
    if (settle) settle(yes);
  };
  const [genErr, setGenErr] = useState('');
  // What came back, held here rather than written to the deck: nothing is
  // kept until the GM says they are happy with it.
  const [preview, setPreview] = useState(null);
  // What was done to an uploaded file, so the GM is told rather than having
  // their image quietly cropped and recompressed.
  const [uploadNote, setUploadNote] = useState('');
  const [cropSquare, setCropSquare] = useState(true);
  const fileRef = useRef(null);
  // The picture being positioned under the crop window, or null when there
  // is none: { file, url, imgW, imgH, box, scale, x, y }.
  const [crop, setCrop] = useState(null);
  const dragRef = useRef(null);
  // Deck generation. The seed is held here rather than on the map because it
  // describes how the floor was made, not what it is — and the floor is the
  // only record of the deck.
  const [deckOpen, setDeckOpen] = useState(false);
  const [genStyle, setGenStyle] = useState(DECK_STYLES[0].id);
  const [genSeed, setGenSeed] = useState('');
  // Held as text, not numbers: a half-typed "1" on the way to "120" must not
  // be read as a grid of one and clamp the box out from under the typing.
  const [growCols, setGrowCols] = useState('');
  const [growRows, setGrowRows] = useState('');
  // The terrain the ground brush lays down. Defaults to the deck's own,
  // which is the "lift it off again" option.
  const [paintGround, setPaintGround] = useState(m.theme);

  // The Pan tool. While it is on a plain drag moves the view, the way holding
  // Space does for as long as Space is down.
  const [panOn, setPanOn] = useState(false);
  const panOnRef = useRef(false);
  panOnRef.current = panOn;
  // Panels that used to be rows of controls on the bar, folded away until they
  // are wanted: saving and loading decks, and the grid and its scale.
  const [libOpen, setLibOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  // The right-click menu: where it was opened, and which group is unfolded.
  const [menu, setMenu] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const menuRef = useRef(null);
  const [menuAt, setMenuAt] = useState({ x: 0, y: 0 });
  // Procedural terrain, in the Ground panel. `terrainPick` is the grounds the
  // GM has ticked; until they tick any it is the deck's own plus every saved one.
  const [terrainPrompt, setTerrainPrompt] = useState('');
  const [terrainPick, setTerrainPick] = useState(null);
  const [terrainSeed, setTerrainSeed] = useState('');
  const [terrainSize, setTerrainSize] = useState('auto');
  const [terrainScope, setTerrainScope] = useState('deck');
  const [terrainNote, setTerrainNote] = useState('');
  // Which half of the Ground panel is showing: making a ground (generated or
  // uploaded) or laying terrain from the grounds there are.
  const [groundTab, setGroundTab] = useState('make');
  // Every ground there is — built in, generated, uploaded; once saved they are
  // all the same kind of thing — described by the words they answer to.
  const allGrounds = useMemo(() => [...MAP_THEMES, ...customThemes].map((t) => ({
    id: t.id, name: t.name, subtitle: t.subtitle, desc: t.desc, prompt: t.prompt,
    custom: Boolean(t.custom), fallback: t.fallback
  })), [customThemes]);
  const terrainRead = useMemo(() => readTerrainPrompt(terrainPrompt, allGrounds), [terrainPrompt, allGrounds]);
  // How Expand grows a deck: from what is painted (the default), or by
  // repeating the deck, or repeating it flipped at the seams.
  const [growHow, setGrowHow] = useState('grow');
  // Generate a deck builds around what is painted, rather than over it.
  const [buildAround, setBuildAround] = useState(true);

  /* Opening the panel offers double the current deck, which is the thing
     almost everyone wants and saves typing two numbers to get it. */
  useEffect(() => {
    if (!deckOpen) return;
    setGrowCols(String(Math.min(MAX_GRID, m.cols * 2)));
    setGrowRows(String(Math.min(MAX_GRID, m.rows * 2)));
    // Only when the panel opens, not on every change to the deck underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckOpen]);
  const [hover, setHover] = useState(null);

  // One string, "w:Longbow" or "s:Fireball" (see library.js), or '' for none.
  const [pick, setPick] = useState(weaponKey('Longbow'));
  // What is typed in the spell box, which may be half a name.
  const [spellText, setSpellText] = useState('');
  const [origin, setOrigin] = useState(null);
  const [aim, setAim] = useState(null);
  const [showLos, setShowLos] = useState(true);
  const [showRings, setShowRings] = useState(true);

  // A clean map: every toolbar and readout hidden, only the deck left. The
  // overlays, templates and fog still draw, because those are the map.
  const [showOptions, setShowOptions] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const presentingRef = useRef(false);
  const [showZones, setShowZones] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);

  const [measureFrom, setMeasureFrom] = useState(null);
  const [measureTo, setMeasureTo] = useState(null);

  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  // Resize fires long after the render that bound it; fitting from the
  // captured map would write back a deck that is several edits old.
  const mapRef = useRef(m);
  mapRef.current = m;
  // src -> decoded image, for every ground the deck draws with.
  const texturesRef = useRef(new Map());
  const [textureTick, setTextureTick] = useState(0);

  // The two-click tools read their first click back on the second one. State
  // is not readable that soon — two clicks inside one React batch both see
  // the old value, and the second click overwrites the origin it was meant
  // to aim from — so the first click is kept in a ref and the state exists
  // only to drive the redraw.
  const originRef = useRef(null);
  const measureRef = useRef(null);

  /* ---- undo ----
     One entry per GESTURE, not per square: a drag that paints forty cells is
     one step, so Undo takes the stroke back rather than one square of it.
     A gesture is everything between a mouse-down and the next mouse-up, and
     a toolbar field typed into counts as one until the pointer next lets go.

     The history belongs to whatever deck is open. `historyKey` names it (the
     deck's id, or 'live'), and a change of key empties the stacks — Undo on
     a freshly opened deck must never write the PREVIOUS deck's squares into
     it. */
  const MAX_HISTORY = 100;
  const historyRef = useRef({ past: [], future: [] });
  const gestureRef = useRef(false);
  const [, setHistTick] = useState(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const remember = (before) => {
    const h = historyRef.current;
    h.past.push(before);
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.future = [];
    setHistTick((t) => t + 1);
  };

  const patch = (next) => {
    if (!onChange) return;
    if (!gestureRef.current) { remember(m); gestureRef.current = true; }
    onChange({ ...m, ...next });
  };

  // Refs rather than closures: the key handler is bound once, and the
  // writer it would capture is replaced on every render.
  const undo = () => {
    const h = historyRef.current;
    const prev = h.past.pop();
    const write = onChangeRef.current;
    if (!prev || !write) return;
    h.future.push(mapRef.current);
    gestureRef.current = false;
    write(prev);
    setHistTick((t) => t + 1);
  };
  const redo = () => {
    const h = historyRef.current;
    const next = h.future.pop();
    const write = onChangeRef.current;
    if (!next || !write) return;
    h.past.push(mapRef.current);
    gestureRef.current = false;
    write(next);
    setHistTick((t) => t + 1);
  };

  useEffect(() => {
    historyRef.current = { past: [], future: [] };
    gestureRef.current = false;
    setHistTick((t) => t + 1);
  }, [historyKey]);

  useEffect(() => {
    const w = win || window;
    const end = () => { gestureRef.current = false; };
    w.addEventListener('mouseup', end);
    return () => w.removeEventListener('mouseup', end);
  }, [win]);

  /* ---- turning the map ----
     A quarter turn at a time, as one undoable step. What turns is what has
     been painted; the grid it sits in stays as it is. Overlays, the ruler and
     the firing square are cleared because the squares they pointed at are
     somewhere else now. */
  const [turnNote, setTurnNote] = useState('');
  const rotateMapBy = (turns) => {
    const write = onChangeRef.current;
    if (!write) return;
    if (!rotationFits(mapRef.current, turns)) {
      const msg = 'The painted map is too big to turn inside this grid. Make the grid bigger first.';
      setTurnNote(msg);
      if (!showOptions) (win || window).alert(msg);
      return;
    }
    setTurnNote('');
    remember(mapRef.current);
    gestureRef.current = false;
    write(rotateMap(mapRef.current, turns));
    originRef.current = null; measureRef.current = null;
    setOrigin(null); setAim(null); setMeasureFrom(null); setMeasureTo(null);
  };
  /* ---- loading a saved deck ----
     The window is where a session is run, and until now it could save a deck
     but not bring one back. What "load" means is the parent's call: onto the
     live map for play (as Publish for play does: fog on, contacts hidden),
     or, while a deck is being designed, switching to that deck. */
  const [loadId, setLoadId] = useState('');
  const loadChosenDeck = async () => {
    const deck = decks.find((d) => d.id === loadId);
    if (!deck || !onLoadDeck) return;
    const name = deck.name || 'Untitled map';
    const occupied = Object.keys(mapRef.current.floor || {}).length > 0;
    if (occupied && !await confirmInMap({
      title: 'Replace what is on screen?',
      body: `\u201c${name}\u201d takes the place of the map on screen. Undo (Cmd/Ctrl+Z)`
        + ' brings the current one back.',
      yes: 'Load it'
    })) return;
    remember(mapRef.current);
    gestureRef.current = false;
    originRef.current = null; measureRef.current = null;
    setOrigin(null); setAim(null); setMeasureFrom(null); setMeasureTo(null);
    onLoadDeck(deck);
    setLoadId('');
    setDeckNote(`Loaded \u201c${name}\u201d.`);
  };
  /* Throwing a deck out of the library. The map's undo cannot reach this \u2014
     it is the stored library, not the map on screen \u2014 so it asks first, and
     says so. */
  const deleteChosenDeck = async () => {
    const deck = decks.find((d) => d.id === loadId);
    if (!deck || !onDeleteDeck) return;
    const name = deck.name || 'Untitled map';
    if (!await confirmInMap({
      title: `Delete \u201c${name}\u201d?`,
      body: 'It goes out of the library for good, and undo on the map will not bring it'
        + ' back. Whatever is on screen stays.',
      yes: 'Delete it'
    })) return;
    onDeleteDeck(deck);
    setLoadId('');
    // Save over a deck that no longer exists and the save would quietly make
    // a new one under the old name instead.
    if (deckTarget === deck.id) setDeckTarget('');
    setDeckNote(`Deleted \u201c${name}\u201d.`);
  };
  const rHeldRef = useRef(false);     // R is down: a click turns the map
  const rUsedRef = useRef(false);     // ...and a tap of R turns the stamp instead
  const spaceRef = useRef(false);     // Space is down: a drag pans

  // Which window this is. The projector's copy hides what the table must
  // not see; the GM's own tab shows it.
  const projecting = Boolean(win);

  // Never shrunk to fit a canvas: the deck is drawn a window at a time (see
  // `paint`), so a square is always the size the projector was calibrated to.
  const px = m.pxPerSquare;

  const ov = useMemo(() => overlayOf(entryFor(pick)), [pick]);

  /* Every ground this deck draws with — its own, plus any painted onto
     individual squares. Joined to a string so the effects below re-run when
     the SET changes rather than on every redraw of the same set. */
  const groundIds = useMemo(() => groundsUsed(m), [m]);
  const groundKey = groundIds.join('|');

  /* Where a ground's floor comes from. The deck's generated floor overrides
     its own theme's file; a ground painted onto a square always uses its
     own, or painting ice onto a deck with a generated floor would paint the
     generated floor again. */
  const groundSrc = (id) => {
    if (id === m.theme && m.customTexture) return m.customTexture;
    const t = resolveTheme(id, customThemes);
    return (t && t.texture) || null;
  };

  /* ---- the floor textures, one per ground in use ----

     Keyed by SOURCE rather than by ground id, so two grounds pointing at the
     same file share one decode, and a ground whose floor arrives later
     replaces nothing it should not. */
  useEffect(() => {
    let cancelled = false;
    const wanted = new Set();
    for (const id of groundIds) {
      const src = groundSrc(id);
      if (src) wanted.add(src);
    }
    // Anything no longer painted anywhere is dropped, or a GM trying grounds
    // keeps every one they rejected decoded in memory.
    for (const key of [...texturesRef.current.keys()]) {
      if (!wanted.has(key)) texturesRef.current.delete(key);
    }
    for (const src of wanted) {
      if (texturesRef.current.has(src)) continue;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        texturesRef.current.set(src, img);
        setTextureTick((t) => t + 1);
      };
      /* A missing texture is not an error: those squares are painted in that
         ground's flat fallback colour instead, which still reads on a
         projector. It just loses the grain. */
      img.onerror = () => { if (!cancelled) setTextureTick((t) => t + 1); };
      img.src = src;
    }
    // Redraw now as well, for the sources already decoded.
    setTextureTick((t) => t + 1);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey, customThemes, m.theme, m.customTexture]);

  /* ---- the prop tokens ----

     A door, a crate stack, a pillar, a fire: sixteen pictures per ground, cut
     off that ground's sprite sheet by tools/slice-sprites.mjs and served from
     public/maps/tokens. Before these the props were drawn as grey boxes and
     coloured stripes, which read perfectly well and looked like a programmer's
     placeholder, because that is what they were.

     Fetched square by square rather than by the setful: tokensNeeded() reads
     the deck and asks for the pictures the deck actually uses, so a corridor
     with two doors pulls down two files instead of half a megabyte of
     crates and foliage nobody placed.

     Keyed "<ground>/<role>", so the same crate on an ice square and a deck
     square are two different pictures and both are cached. A value of null
     means "asked for and not there" — which is not an error and not retried:
     those squares keep the flat drawing, and a ground the GM generated has no
     sheet until they generate one. */
  const tokensRef = useRef(new Map());
  const [tokenTick, setTokenTick] = useState(0);
  const tokenNeeds = useMemo(() => tokensNeeded(m), [m]);
  const tokenKey = tokenNeeds.join('|');

  /* Where a ground's prop pictures come from. Only the nine that ship have a
     folder of cut tokens; a ground the GM generated carries its own sixteen
     as one sheet on the ground record, cut up below, and one they merely
     uploaded a floor for has none at all. */
  const tokenSrc = (ground, role) => {
    const custom = resolveTheme(ground, customThemes);
    if (custom && custom.custom) return null;
    return SHEET_FOR_THEME[ground] ? `/maps/tokens/${ground}/${role}.webp` : null;
  };

  useEffect(() => {
    let cancelled = false;
    const wanted = new Set(tokenNeeds);
    // Props the GM has since erased are dropped, the way the floors are: a
    // session spent trying cover types should not end holding every token in
    // the set decoded.
    for (const k of [...tokensRef.current.keys()]) {
      if (!wanted.has(k)) tokensRef.current.delete(k);
    }
    for (const k of wanted) {
      if (tokensRef.current.has(k)) continue;
      const cut = k.indexOf('/');
      const src = tokenSrc(k.slice(0, cut), k.slice(cut + 1));
      if (!src) { tokensRef.current.set(k, null); continue; }
      // Claimed before the load finishes, or a redraw mid-flight queues the
      // same file again — and a deck of forty crates would ask forty times.
      tokensRef.current.set(k, null);
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        tokensRef.current.set(k, img);
        setTokenTick((t) => t + 1);
      };
      img.onerror = () => { if (!cancelled) setTokenTick((t) => t + 1); };
      img.src = src;
    }
    setTokenTick((t) => t + 1);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey, customThemes]);

  /* ---- a generated ground's own props ----

     A ground the GM generated carries its sixteen props as ONE sheet rather
     than sixteen files, because that is how it was generated and how it is
     stored: one blob in one stored record, which is also why the props keep
     the light and the wear of the floor they belong to.

     So it is cut up here, once per ground, and held as sixteen canvases. */
  const sheetsRef = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    for (const id of groundIds) {
      if (sheetsRef.current.has(id)) continue;
      const t = resolveTheme(id, customThemes);
      if (!t || !t.custom || !t.sprites) continue;
      // Claimed before the decode finishes, or every redraw queues it again.
      sheetsRef.current.set(id, null);
      imageFrom(t.sprites)
        .then((img) => {
          if (cancelled) return;
          sheetsRef.current.set(id, sliceSheet(img));
          setTokenTick((n) => n + 1);
        })
        // A sheet that will not decode leaves that ground's props flat, which
        // is what a ground with no sheet at all does.
        .catch(() => { if (!cancelled) setTokenTick((n) => n + 1); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey, customThemes]);

  /* The picture for one square's prop, or null to draw it the old way.

     `turn` is what the SQUARE says, and it is ADDED to what the role says.
     The two mean different things and both are wanted: spriteTurn breaks up a
     run of identical props that have no front, while the square's own turn is
     a barrier the GM deliberately stood on end. Adding them means a barrier
     (which spriteTurn leaves alone, having a front) obeys the GM exactly,
     while crates (which carry no turn of their own) keep being scattered. */
  const tokenAt = (kind, id, state, cx, cy, turn = 0) => {
    const at = { x: cx, y: cy };
    const role = spriteRole(kind, id, state, at);
    if (!role) return null;
    const ground = (m.ground && m.ground[cellKey(cx, cy)]) || m.theme;
    const sheet = sheetsRef.current.get(ground);
    const img = (sheet && sheet[role]) || tokensRef.current.get(ground + '/' + role);
    return img ? { img, turn: (spriteTurn(role, at) + turn) % 4 } : null;
  };

  const measurement = useMemo(() => {
    if (!measureFrom || !measureTo) return null;
    return reachBetween({
      from: measureFrom, to: measureTo, map: m, ov
    });
  }, [measureFrom, measureTo, m, ov]);

  /* ---- input ---- */

  // Which square a pointer event is over. Worked out from where the stage is
  // scrolled to, because the canvas is only a window onto the deck.
  const posFromEvent = (e) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const sx = e.clientX - rect.left - stage.clientLeft + stage.scrollLeft;
    const sy = e.clientY - rect.top - stage.clientTop + stage.scrollTop;
    const x = Math.floor(sx / zoom / px);
    const y = Math.floor(sy / zoom / px);
    if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) return null;
    return { x, y };
  };

  /* A door clicked in play. `to` sets a state directly (the menu, the Play
     tab); without it the door steps on. Opening one is a noise, the same as
     under the door tool: anything hidden within earshot comes up on the scope
     as a ping. */
  const clickDoor = (pos, to = null) => {
    const p = playDoor(m, pos, to);
    if (!p || !p.doors) return;
    const opened = p.doors[cellKey(pos.x, pos.y)].state === 'open';
    patch(opened ? { ...p, contacts: noisePing(m, pos, 'door') } : p);
  };

  // The effect that opens the right-click menu is bound once, so it reads the
  // current square-finder through a ref rather than the one it was bound with.
  const cellAtRef = useRef(null);
  cellAtRef.current = posFromEvent;

  /* What a click takes off a square, as a patch, or null when it holds none of
     the environment the menu lays. The marker first, then a hazard, then
     smoke; a square with several is cleared one click at a time, top down. A
     cloud goes the way it came: the size it was laid at, around the clicked
     square, and only the smoke of that density. */
  const liftEnvironmentAt = (pos) => {
    const k = cellKey(pos.x, pos.y);
    if (m.markers[k]) { const markers = { ...m.markers }; delete markers[k]; return { markers }; }
    if (m.hazards[k]) { const hazards = { ...m.hazards }; delete hazards[k]; return { hazards }; }
    const density = m.obscuring[k];
    if (density) {
      const obscuring = { ...m.obscuring };
      for (const c of brushCells(pos, cloud, m)) {
        const ck = cellKey(c.x, c.y);
        if (obscuring[ck] === density) delete obscuring[ck];
      }
      return { obscuring };
    }
    return null;
  };

  const applyAt = (pos, dragging = false, sweep = false, lineOfSight = false, conceal = false) => {
    if (!pos) return;
    const k = cellKey(pos.x, pos.y);

    if (mode === 'paint') {
      patch({ floor: paintCells(m.floor, brushCells(pos, brush, m), true) });
      return;
    }
    /* Painting terrain, not deck. Only what a square LOOKS like changes, so
       this writes nothing but `ground` — the floor it paints over is left
       exactly as it is, and with it every wall, region and fog state
       derived from it. */
    if (mode === 'ground') {
      const ground = { ...m.ground };
      const cells = brushCells(pos, brush, m);
      // The deck's own ground is the absence of paint rather than a value,
      // so choosing it is how paint is lifted off again.
      const lifting = paintGround === m.theme;
      for (const c of cells) {
        const ck = cellKey(c.x, c.y);
        if (lifting) delete ground[ck]; else ground[ck] = paintGround;
      }
      // Painting a terrain on a square with no deck lays the deck there too:
      // a ground that is only drawn where there is already floor leaves a
      // marsh, a lake or a field to be built square by square first. Squares
      // that already have floor keep it exactly as it is, so nothing derived
      // from it (walls, doors, fog) moves. Lifting paint never adds deck.
      patch(lifting ? { ground } : { ground, floor: paintCells(m.floor, cells, true) });
      return;
    }
    if (mode === 'erase') {
      // Everything standing on a square goes with the square. Erasing the
      // floor and leaving its door behind would put a door in the void.
      const cells = brushCells(pos, brush, m);
      const doors = { ...m.doors };
      const markers = { ...m.markers };
      const cover = { ...m.cover };
      const hazards = { ...m.hazards };
      const ground = { ...m.ground };
      const obscuring = { ...m.obscuring };
      for (const c of cells) {
        const ck = cellKey(c.x, c.y);
        delete doors[ck]; delete markers[ck]; delete cover[ck]; delete hazards[ck];
        delete ground[ck]; delete obscuring[ck];
      }
      patch({ floor: paintCells(m.floor, cells, false), doors, markers, cover, hazards, ground, obscuring });
      return;
    }
    // Foliage and smoke are laid down by dragging, like the deck itself, and
    // take the same brush as everything else.
    if (mode === 'obscure') {
      const cells = brushCells(pos, brush, m);
      const obscuring = { ...m.obscuring };
      const lifting = !dragging && obscuring[k] === obscureType;
      for (const c of cells) {
        const ck = cellKey(c.x, c.y);
        if (lifting) delete obscuring[ck]; else obscuring[ck] = obscureType;
      }
      patch({ obscuring });
      return;
    }
    // Revealing is a drag as well as a click: a corridor is swept, not
    // clicked square by square.
    if (mode === 'fog' && dragging) {
      patch({ explored: { ...m.explored, [k]: true } });
      return;
    }
    if (dragging) return;   // the rest place one thing per click

    if (mode === 'stamp') {
      patch({ floor: paintCells(m.floor, stampCells(tileId, pos, rotation, m), true) });
      return;
    }
    // The room the party arrives in. Click inside it; click inside it again
    // to take the choice back.
    if (mode === 'start') {
      patch({ start: setStartRoom(m, pos) });
      return;
    }
    if (mode === 'door') {
      // With the fog on this is a game, not a drawing: a click on a door of
      // the kind in hand is what it is under the fog tool, a door that opens
      // and lights what is beyond.
      if (m.fog && m.doors[k] && m.doors[k].kind === doorKind) { clickDoor(pos); return; }
      const doors = { ...m.doors };
      const here = doors[k];
      // Clicking a door of the same kind cycles its state; clicking with a
      // different kind selected swaps it, which is how a door becomes a
      // hatch without erasing it first.
      doors[k] = (here && here.kind === doorKind)
        ? { kind: here.kind, state: nextDoorState(here.state) }
        : { kind: doorKind, state: 'closed' };
      // Opening a door is a noise: anything hidden within earshot comes up
      // on the scope as a ping, without saying what it is.
      const opened = doors[k].state === 'open' && !(here && here.state === 'open');
      patch(opened ? { doors, contacts: noisePing(m, pos, 'door') } : { doors });
      return;
    }
    if (mode === 'cover') {
      const cover = { ...m.cover };
      const have = readCover(cover[k]);
      const want = writeCover(coverType, coverTurn);
      /* Clicking the same cover the same way round lifts it, as it always
         did. Clicking it the OTHER way round turns it instead — the GM
         walking a railing along a corridor and reaching the corner wants to
         turn that square, not clear it and lay it again. */
      if (have && have.id === coverType && have.turn === coverTurn) delete cover[k];
      else cover[k] = want;
      patch({ cover });
      return;
    }
    if (mode === 'hazard') {
      const hazards = { ...m.hazards };
      // Whatever is burning there goes out with a click, not only the kind in
      // hand: a fire set from the right-click menu should not need the Fire
      // chip chosen to be put out.
      if (hazards[k]) delete hazards[k]; else hazards[k] = hazardType;
      patch({ hazards });
      return;
    }
    if (mode === 'noise') {
      patch({ contacts: noisePing(m, pos, noiseKind) });
      return;
    }
    if (mode === 'contact') {
      const contacts = { ...m.contacts };
      const here = contacts[k];
      if (here) {
        // Cycle what the party knows: unknown -> on the scope -> seen.
        contacts[k] = { ...here, state: nextContactState(here.state) };
      } else {
        const name = contactName.trim();
        if (!name) return;       // nothing typed: a blank contact helps nobody
        // A real monster brings its size, and so the room it takes; any other
        // name is one square.
        const mon = monsterByName(name);
        const size = mon ? footprintSquares(mon.size, m.feetPerSquare) : 1;
        contacts[k] = size > 1 ? { name, state: 'hidden', size } : { name, state: 'hidden' };
      }
      patch({ contacts });
      return;
    }
    if (mode === 'fog') {
      if (sweep) {
        // A sense does not light the map: it finds what is out there.
        patch({ contacts: senseSweep(m, pos, senseFt) });
        return;
      }
      if (lineOfSight) {
        // What can be seen from a square, for a doorway or a long gallery
        // where the room is not the unit the GM wants.
        const seen = onDeck(m, visibleCells(m, pos, null));
        const explored = { ...m.explored, [k]: true };
        for (const c of seen) explored[cellKey(c.x, c.y)] = true;
        patch({ explored });
        return;
      }
      if (conceal) {
        patch({ explored: concealArea(m, pos) });
        return;
      }
      // A door is clicked as a door: it steps to its next state, and opening
      // it lights what it joins.
      if (m.doors[k]) { clickDoor(pos); return; }
      // A square holding a marker, a hazard or a cloud of smoke is clicked OUT:
      // those are laid mid-session from the menu and are lifted the same way,
      // without going back to the menu. Click the room beside it to reveal.
      const lifted = liftEnvironmentAt(pos);
      if (lifted) { patch(lifted); return; }
      // A PLACE at a time, which is the reveal the table expects: click
      // inside a room and the room is there.
      //
      // The clicked square also becomes the viewpoint — where the party is
      // standing — because that is what it means in practice: the GM
      // reveals where they have got to. From then on, shutting a door takes
      // what is beyond it off the board.
      patch({ explored: revealArea(m, pos), viewpoint: pos });
      return;
    }
    if (mode === 'marker') {
      const markers = { ...m.markers };
      // Clicking a marker lifts it, whatever kind it is, so one tool both
      // places and removes. A marker set from the right-click menu goes with a
      // click, without choosing its kind first.
      if (markers[k]) delete markers[k];
      else markers[k] = { type: markerType, label: markerTypeById(markerType).name };
      patch({ markers });
      return;
    }
    if (mode === 'overlay') {
      // First click is where the firer stands, second is what they are
      // pointing at. Clicking the origin again clears it.
      const cur = originRef.current;
      if (!cur) { originRef.current = pos; setOrigin(pos); setAim(null); }
      else if (cur.x === pos.x && cur.y === pos.y) {
        originRef.current = null; setOrigin(null); setAim(null);
      } else setAim(pos);
      return;
    }
    if (mode === 'measure') {
      if (!measureRef.current) {
        measureRef.current = pos; setMeasureFrom(pos); setMeasureTo(null);
      } else {
        setMeasureTo(pos); measureRef.current = null;
      }
    }
  };

  // Bound to the window this is actually rendered in. When the map is
  // portalled into its own window, a listener on the opener's window never
  // sees the GM's keystrokes at all.
  useEffect(() => {
    const target = win || window;
    const typing = (e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target && e.target.tagName) || '');
    const onKey = (e) => {
      if (typing(e)) return;
      // A question is up and waiting: it owns the keyboard. Otherwise H would
      // hide the toolbars behind the dialog and R would turn the deck the GM
      // is being asked about.
      if (askRef.current) return;
      const k = e.key.toLowerCase();
      // Undo and redo, the way every editor does them.
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (k === 'y') { e.preventDefault(); redo(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;    // leave browser shortcuts alone
      // R is two things. Held with a click it turns the painted map; tapped on
      // its own it turns the tile about to be stamped. Which one it was is
      // only known when the key comes up.
      if (k === 'r') { if (!e.repeat) { rHeldRef.current = true; rUsedRef.current = false; } }
      // H hides or brings back the toolbars; F takes the map's window
      // full screen; P does both at once, for the projector.
      else if (k === 'h') setShowOptions((v) => !v);
      else if (k === 'f' && win) toggleFullscreen();
      else if (k === 'p' && win) present();
    };
    const onKeyUp = (e) => {
      if (e.key.toLowerCase() !== 'r') return;
      if (rHeldRef.current && !rUsedRef.current) setRotation((r) => (r + 90) % 360);
      rHeldRef.current = false;
    };
    const onBlur = () => { rHeldRef.current = false; };
    target.addEventListener('keydown', onKey);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
    return () => {
      target.removeEventListener('keydown', onKey);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  /* ---- panning ----
     Hold Space and drag. The pointer has to be over the map: Space also
     presses whichever toolbar button was clicked last, and swallowing it
     across the whole dashboard would break every other panel. The press is
     caught on the way in, before the tool under the cursor sees it, so a pan
     never paints a square. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const w = win || window;
    const typing = (e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target && e.target.tagName) || '');
    let over = false;
    let drag = null;
    const armed = () => spaceRef.current || panOnRef.current;
    const cursor = (state) => {
      el.classList.toggle('pan-ready', state === 'ready');
      el.classList.toggle('panning', state === 'panning');
    };
    const onEnter = () => { over = true; };
    const onLeave = () => { over = false; };
    const onKeyDown = (e) => {
      if (e.code !== 'Space' || !over || typing(e)) return;
      e.preventDefault();
      if (!e.repeat) { spaceRef.current = true; if (!drag) cursor('ready'); }
    };
    const onKeyUp = (e) => {
      if (e.code !== 'Space') return;
      if (spaceRef.current) e.preventDefault();    // no click on a focused button
      spaceRef.current = false;
      if (!drag) cursor(armed() ? 'ready' : null);
    };
    const onDown = (e) => {
      if (!armed() || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      cursor('panning');
    };
    const onMove = (e) => {
      if (!drag) return;
      el.scrollLeft = drag.left - (e.clientX - drag.x);
      el.scrollTop = drag.top - (e.clientY - drag.y);
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      cursor(armed() ? 'ready' : null);
    };
    const onBlur = () => { spaceRef.current = false; drag = null; cursor(armed() ? 'ready' : null); };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousedown', onDown, true);
    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('keyup', onKeyUp);
    w.addEventListener('mousemove', onMove);
    w.addEventListener('mouseup', onUp);
    w.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousedown', onDown, true);
      w.removeEventListener('keydown', onKeyDown);
      w.removeEventListener('keyup', onKeyUp);
      w.removeEventListener('mousemove', onMove);
      w.removeEventListener('mouseup', onUp);
      w.removeEventListener('blur', onBlur);
      cursor(null);
    };
  }, [win]);

  // The Pan tool's cursor, set from here because the effect above only knows
  // about the moment a drag starts and ends.
  useEffect(() => {
    const el = stageRef.current;
    if (el && !el.classList.contains('panning')) el.classList.toggle('pan-ready', panOn);
  }, [panOn]);

  /* ---- full screen ----
     The Fullscreen API has to be asked from a click or keypress inside the
     window that is going full screen, which is why the button and the key
     live here rather than on the dashboard that opened it. The prefixed names
     are Safari's. */
  const fsDoc = () => (win || window).document;
  const fsActive = () => Boolean(fsDoc().fullscreenElement || fsDoc().webkitFullscreenElement);
  function toggleFullscreen() {
    const doc = fsDoc();
    const el = doc.documentElement;
    try {
      const done = fsActive()
        ? (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc)
        : (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (done && typeof done.catch === 'function') done.catch(() => {});
    } catch { /* the browser refused; the window is still as large as the screen */ }
  }
  // A clean, full-screen map in one step. Leaving full screen (Esc) brings
  // the toolbars back, so the GM is never stranded without them.
  function present() {
    if (!fsActive()) {
      presentingRef.current = true;
      setShowOptions(false);
    }
    toggleFullscreen();
  }
  useEffect(() => {
    if (!win) return undefined;
    const doc = win.document;
    const onChange = () => {
      const on = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
      setIsFull(on);
      if (!on && presentingRef.current) { presentingRef.current = false; setShowOptions(true); }
    };
    doc.addEventListener('fullscreenchange', onChange);
    doc.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      doc.removeEventListener('fullscreenchange', onChange);
      doc.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [win]);

  /* ---- overlay geometry ---- */

  const overlay = useMemo(() => {
    if (mode !== 'overlay' || !origin) return null;
    const target = aim || hover;
    // A spell with a shape throws that shape, and a weapon or a single-target
    // spell throws a lane. A lane is one line between two squares, not an
    // area, so it gets the band it lands in; a burst at a target (Fireball)
    // keeps the lane too — it is still thrown at a point, and the line is what
    // shows whether the cast can even get there.
    const kind = overlayKindFor(ov);
    const shot = target && kind === 'beam' && ov
      ? reachBetween({ from: origin, to: target, map: m, ov })
      : null;
    return {
      kind,
      shot,
      target,
      rings: showRings && ov ? rangeRings(ov, m) : [],
      // Trimmed to what it can reach, and kept on the floor: fire does not
      // cross a shut door and a Fireball does not blast through a wall.
      area: ov && ov.area ? areaFor(m, ov, origin, target) : []
    };
  }, [mode, origin, aim, hover, ov, showRings, m]);

  /* ---- rendering ----

     THE CANVAS IS A WINDOW ONTO THE DECK, NOT THE DECK. It used to be one
     bitmap of cols x px by rows x px, which is why a deck could not be bigger
     than a browser's largest image and why a big one had its squares shrunk to
     fit (decalibrating the projector, the one thing that must not move). Now
     the bitmap is only as big as the stage, sticks to the top-left of what is
     scrolled into view, and is redrawn for whatever part of the deck is under
     it, at the current zoom. Squares stay the size they were calibrated to,
     and a deck can be as big as its data.

     Only the squares in view are visited, found by looking them up rather than
     by walking every record, so a redraw costs what is on screen. Zoomed so
     far out that a square is a few pixels, the details are not worth drawing
     and an overview (one pixel per square, kept until the map changes) is
     scaled up instead. */

  // What the fog shows, worked out when the deck changes, not on every redraw.
  const shown = useMemo(
    () => (m.fog ? visibleExplored(m) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m.fog, m.explored, m.doors, m.floor, m.viewpoint]);

  // The room the starting-room tool would choose, drawn tinted while it is in
  // hand. Worked out only then: it walks the room.
  const startCells = useMemo(
    () => (mode === 'start' && m.start ? regionAt(m, m.start) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, m.start, m.floor, m.doors]);

  /* ---- the tabs ----
     Going to a tab puts in hand the tool last used there, or the tab's first.
     Remembering the tool on the way out is what makes Build -> Play -> Build
     land back on the tile that was about to be stamped. */
  const chooseTab = (t) => {
    const from = tabRef.current;
    lastToolRef.current[from] = modeRef.current;
    const ids = t === 'play' ? PLAY_TOOLS : BUILD_TOOLS;
    const want = lastToolRef.current[t];
    const next = ids.includes(want) ? want : ids[0];
    if (t === from && modeRef.current === next) return;
    tabRef.current = t;
    modeRef.current = next;
    setTab(t);
    setMode(next);
    // Ground, Deck and Grid are panels for drawing a map; they do not follow
    // the DM to a table with the fog on.
    if (t === 'play') { setGenOpen(false); setDeckOpen(false); setGridOpen(false); }
  };
  // Picking a tool by any road (the toolbar, the menu) is remembered for its tab.
  useEffect(() => { lastToolRef.current[tabRef.current] = mode; }, [mode]);
  // A different map is on screen: the tab that suits it. One with the fog on
  // is being played; one out of the library is built.
  useEffect(() => { chooseTab(m.fog ? 'play' : 'build'); }, [historyKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The fog going on over the map already here is the same thing: it is being
  // played now, and the first click on a door must not lay floor over it.
  useEffect(() => { if (m.fog) chooseTab('play'); }, [m.fog]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Dead ground for the sight overlay, asked of a square the first time it is
     drawn and remembered. Working out every square a weapon might see used to
     be done up front, on every move of the pointer. */
  const seeable = useMemo(() => {
    if (mode !== 'overlay' || !origin || !showLos) return null;
    const per = m.feetPerSquare || FEET_PER_SQUARE;
    const farFt = ov && (ov.longRange || ov.range);
    const reach = farFt ? farFt / per : Infinity;
    const limit = Math.min(reach, LOS_MAX_SQUARES);
    const cache = new Map();
    return (x, y) => {
      const k = x + ',' + y;
      let v = cache.get(k);
      if (v === undefined) {
        v = Math.hypot(x - origin.x, y - origin.y) <= limit && !lineBlocked(m, origin, { x, y });
        cache.set(k, v);
      }
      return v;
    };
  }, [mode, origin, showLos, ov, m]);

  const drawRef = useRef(() => {});
  const overviewRef = useRef(null);
  const OVERVIEW_BELOW = 6;       // screen pixels per square under which only the overview is drawn

  // One pixel per square, for when the whole deck is on screen at once.
  const buildOverview = () => {
    const have = overviewRef.current;
    if (have && have.m === m && have.shown === shown && have.projecting === projecting && have.tick === textureTick) return have.canvas;
    const doc = (win || window).document;
    const c = have && have.canvas ? have.canvas : doc.createElement('canvas');
    c.width = m.cols; c.height = m.rows;
    const g = c.getContext('2d');
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, m.cols, m.rows);
    const tint = new Map();
    const colourOf = (id) => {
      if (!tint.has(id)) tint.set(id, (resolveTheme(id, customThemes) || theme).fallback);
      return tint.get(id);
    };
    for (const k of Object.keys(m.floor)) {
      const p = parseKey(k);
      if (!p) continue;
      g.fillStyle = colourOf(m.ground[k] || m.theme);
      g.fillRect(p.x, p.y, 1, 1);
    }
    for (const [k, id] of Object.entries(m.hazards)) {
      const p = parseKey(k); const hz = hazardById(id);
      if (p && hz) { g.fillStyle = hz.colour; g.fillRect(p.x, p.y, 1, 1); }
    }
    for (const [k, id] of Object.entries(m.cover)) {
      const p = parseKey(k);
      if (p && coverById(id)) { g.fillStyle = '#7d8991'; g.fillRect(p.x, p.y, 1, 1); }
    }
    for (const [k, id] of Object.entries(m.obscuring)) {
      const p = parseKey(k); const ob = obscuringById(id);
      if (p && ob) { g.globalAlpha = Math.min(0.85, ob.alpha + 0.3); g.fillStyle = ob.colour; g.fillRect(p.x, p.y, 1, 1); g.globalAlpha = 1; }
    }
    for (const [k, door] of Object.entries(m.doors)) {
      const p = parseKey(k);
      if (p) {
        g.fillStyle = door.state === 'open' ? '#2ecc71' : door.state === 'jammed' ? '#f39c12' : '#e74c3c';
        g.fillRect(p.x, p.y, 1, 1);
      }
    }
    for (const [k, mk] of Object.entries(m.markers)) {
      const p = parseKey(k);
      if (p) { g.fillStyle = markerTypeById(mk.type).colour; g.fillRect(p.x, p.y, 1, 1); }
    }
    if (shown) {
      g.fillStyle = projecting ? 'rgb(3,4,6)' : 'rgba(3,4,6,0.82)';
      for (let x = 0; x < m.cols; x++) {
        for (let y = 0; y < m.rows; y++) if (!shown[x + ',' + y]) g.fillRect(x, y, 1, 1);
      }
    }
    overviewRef.current = { m, shown, projecting, tick: textureTick, canvas: c };
    return c;
  };

  /* Draws the deck into `ctx` as seen through `frame`: the part of the
     zoomed deck, in screen pixels, that the canvas shows. Everything below is
     in map pixels; the transform does the scrolling and the zoom. */
  const paint = (ctx, frame) => {
    const z = frame.zoom;
    const w = m.cols * px;
    const h = m.rows * px;
    // The visible part of the deck, in map pixels and in squares.
    const vx0 = frame.left / z, vy0 = frame.top / z;
    const vw = frame.width / z, vh = frame.height / z;
    const vx1 = vx0 + vw, vy1 = vy0 + vh;
    const c0 = Math.max(0, Math.floor(vx0 / px) - 1), c1 = Math.min(m.cols - 1, Math.ceil(vx1 / px));
    const r0 = Math.max(0, Math.floor(vy0 / px) - 1), r1 = Math.min(m.rows - 1, Math.ceil(vy1 / px));
    const overview = px * z < OVERVIEW_BELOW;
    // The squares in view that hold something in a layer.
    const each = (layer, fn) => {
      for (let x = c0; x <= c1; x++) {
        for (let y = r0; y <= r1; y++) {
          const v = layer[x + ',' + y];
          if (v) fn(x, y, v);
        }
      }
    };

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.setTransform(z, 0, 0, z, -frame.left, -frame.top);

    const fill = (cells, colour) => {
      ctx.fillStyle = colour;
      for (const c of cells) ctx.fillRect(c.x * px, c.y * px, px, px);
    };

    if (overview) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buildOverview(), 0, 0, w, h);
    } else {
      // 1. The deck, textured, clipped to the painted cells so unbuilt grid
      //    stays void rather than becoming a rectangle of corridor.
      /* Grouped by the ground painted on each square, so a deck that runs
         from ice to deck plate is drawn in one pass per terrain rather than
         one per square. Unpainted squares fall to the deck's own ground. */
      const byGround = new Map();
      for (let x = c0; x <= c1; x++) {
        for (let y = r0; y <= r1; y++) {
          const k = x + ',' + y;
          if (!m.floor[k]) continue;
          const id = m.ground[k] || m.theme;
          const list = byGround.get(id);
          if (list) list.push(x, y); else byGround.set(id, [x, y]);
        }
      }
      for (const [id, xy] of byGround) {
        // Each ground brings its OWN fallback and wash: the wash is tuned to
        // how bright that particular floor is, so sharing the deck's would
        // wash a pale ice shelf like dark deck plate.
        const t = resolveTheme(id, customThemes) || theme;
        const src = groundSrc(id);
        const img = src ? texturesRef.current.get(src) : null;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < xy.length; i += 2) ctx.rect(xy[i] * px, xy[i + 1] * px, px, px);
        ctx.clip();
        ctx.fillStyle = img ? (ctx.createPattern(img, 'repeat') || t.fallback) : t.fallback;
        ctx.fillRect(c0 * px, r0 * px, (c1 - c0 + 1) * px, (r1 - r0 + 1) * px);
        // The wash knocks a busy photographic deck back so tokens, the grid
        // and the templates read over it. A pale drawn deck has none of that
        // noise and a dark grid of its own, so washing it would only turn a
        // deliberately clean floor grey.
        ctx.fillStyle = `rgba(0,0,0,${t.wash})`;
        ctx.fillRect(c0 * px, r0 * px, (c1 - c0 + 1) * px, (r1 - r0 + 1) * px);
        ctx.restore();
      }
    }

    // 2. Start zones, under everything else.
    if (showZones) {
      const zn = deploymentRows(m, 1);
      ctx.fillStyle = 'rgba(192,57,43,0.18)';
      ctx.fillRect(0, zn.monsters.y0 * px, w, (zn.monsters.y1 - zn.monsters.y0 + 1) * px);
      ctx.fillStyle = 'rgba(52,152,219,0.18)';
      ctx.fillRect(0, zn.party.y0 * px, w, (zn.party.y1 - zn.party.y0 + 1) * px);
    }

    if (!overview) {
      // 3. Walls, derived from the floor every frame — never stored, so they
      //    cannot disagree with the deck they edge.
      const thick = Math.max(3, Math.floor(px * 0.16));
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      const line = (ax, ay, bx, by) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
      each(m.floor, (cx, cy) => {
        const x0 = cx * px, y0 = cy * px;
        const mask = wallMask(m.floor, cx, cy);
        if (mask) {
          ctx.fillStyle = 'rgba(8,10,14,0.92)';
          if (mask & WALL_N) ctx.fillRect(x0, y0, px, thick);
          if (mask & WALL_S) ctx.fillRect(x0, y0 + px - thick, px, thick);
          if (mask & WALL_W) ctx.fillRect(x0, y0, thick, px);
          if (mask & WALL_E) ctx.fillRect(x0 + px - thick, y0, thick, px);
          if (mask & WALL_N) line(x0, y0 + thick, x0 + px, y0 + thick);
          if (mask & WALL_S) line(x0, y0 + px - thick, x0 + px, y0 + px - thick);
          if (mask & WALL_W) line(x0 + thick, y0, x0 + thick, y0 + px);
          if (mask & WALL_E) line(x0 + px - thick, y0, x0 + px - thick, y0 + px);
        }
        // Corner pillars, including the inner corner a four-sided mask misses.
        // Drawn as structure, not highlight: in the grid colour they lit every
        // corner and buried the deck under confetti.
        ctx.fillStyle = 'rgba(4,6,9,0.95)';
        const c = thick + 1;
        if (cornerPillar(m.floor, cx, cy, -1, -1)) ctx.fillRect(x0, y0, c, c);
        if (cornerPillar(m.floor, cx, cy, 1, -1)) ctx.fillRect(x0 + px - c, y0, c, c);
        if (cornerPillar(m.floor, cx, cy, -1, 1)) ctx.fillRect(x0, y0 + px - c, c, c);
        if (cornerPillar(m.floor, cx, cy, 1, 1)) ctx.fillRect(x0 + px - c, y0 + px - c, c, c);
      });

      // 3b. Hazards, as a tinted square with a warning stripe. Under the
      //     cover and the markers, because something can stand in a fire.
      each(m.hazards, (cx, cy, id) => {
        const hz = hazardById(id);
        if (!hz) return;
        const x0 = cx * px, y0 = cy * px;
        /* With a picture for this hazard, the picture IS the warning and the
           stripes come off — a fire that looks like fire does not also need
           hatching. The coloured edge stays: it is what says which hazard
           this is from across the table, and smoke and gas are much the same
           shape of grey cloud. */
        const tok = tokenAt('hazard', id, null, cx, cy);
        if (tok) {
          drawToken(ctx, tok, x0, y0, px);
          ctx.strokeStyle = hz.colour;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 + 1, y0 + 1, px - 2, px - 2);
          ctx.globalAlpha = 1;
          return;
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, y0, px, px); ctx.clip();
        ctx.fillStyle = hz.colour;
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x0, y0, px, px);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = hz.colour;
        ctx.lineWidth = Math.max(2, px * 0.09);
        for (let o = -px; o < px * 2; o += px * 0.34) {
          ctx.beginPath();
          ctx.moveTo(x0 + o, y0 + px);
          ctx.lineTo(x0 + o + px, y0);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = hz.colour;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 1, y0 + 1, px - 2, px - 2);
      });

      // 3c. Cover. Sight-blocking cover fills its square; cover you can shoot
      //     over is drawn as a low bar, so the two are told apart at a glance
      //     from across the table rather than by remembering which is which.
      each(m.cover, (cx, cy, raw) => {
        const rec = readCover(raw);
        const cv = rec && coverById(rec.id);
        if (!cv) return;
        const x0 = cx * px, y0 = cy * px;
        /* The art says which cover this is and roughly how tall it stands,
           which is the distinction the grey boxes were drawing by hand. */
        const tok = tokenAt('cover', rec.id, null, cx, cy, rec.turn);
        if (tok) { drawToken(ctx, tok, x0, y0, px); return; }
        /* No picture for it: the flat drawing, and a barrier drawn flat
           follows its own direction too — a bar along the bottom edge when it
           lies across the square, down the right-hand edge when it stands. */
        if (cv.blocksSight) {
          ctx.fillStyle = 'rgba(78,88,96,0.92)';
          ctx.fillRect(x0 + px * 0.1, y0 + px * 0.1, px * 0.8, px * 0.8);
          ctx.strokeStyle = 'rgba(190,205,215,0.85)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 + px * 0.1, y0 + px * 0.1, px * 0.8, px * 0.8);
          ctx.beginPath();
          ctx.moveTo(x0 + px * 0.1, y0 + px * 0.9);
          ctx.lineTo(x0 + px * 0.9, y0 + px * 0.1);
          ctx.stroke();
        } else {
          const bh = Math.max(3, px * 0.2);
          const long = px * 0.84, off = px * 0.08, back = px - bh - px * 0.12;
          // Across the bottom of the square, or down its right-hand side when
          // the GM stood it on end — the same two states the token has.
          const bar = rec.turn
            ? [x0 + back, y0 + off, bh, long]
            : [x0 + off, y0 + back, long, bh];
          ctx.fillStyle = 'rgba(120,135,145,0.9)';
          ctx.fillRect(...bar);
          ctx.strokeStyle = 'rgba(200,215,225,0.9)';
          ctx.lineWidth = 1;
          ctx.strokeRect(...bar);
        }
      });

      // 3d. Foliage and smoke: a green wash, denser where sight stops sooner.
      //     Drawn on the projector too — it is terrain, not a secret.
      each(m.obscuring, (cx, cy, id) => {
        const ob = obscuringById(id);
        if (!ob) return;
        const tok = tokenAt('obscure', id, null, cx, cy);
        if (tok) { drawToken(ctx, tok, cx * px, cy * px, px); return; }
        ctx.save();
        ctx.globalAlpha = ob.alpha;
        ctx.fillStyle = ob.colour;
        ctx.fillRect(cx * px, cy * px, px, px);
        ctx.globalAlpha = Math.min(0.9, ob.alpha + 0.25);
        ctx.fillStyle = ob.colour;
        for (const [fx, fy] of [[0.28, 0.3], [0.7, 0.35], [0.45, 0.7]]) {
          ctx.beginPath();
          ctx.arc(cx * px + px * fx, cy * px + px * fy, px * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      // 4. The grid, for the table to count squares off. Only the lines in
      //    view: a deck 500 across has a thousand of them.
      ctx.save();
      ctx.globalAlpha = theme.gridAlpha;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      const gy0 = r0 * px, gy1 = (r1 + 1) * px, gx0 = c0 * px, gx1 = (c1 + 1) * px;
      for (let c = c0; c <= c1 + 1; c++) { ctx.beginPath(); ctx.moveTo(c * px, gy0); ctx.lineTo(c * px, gy1); ctx.stroke(); }
      for (let r = r0; r <= r1 + 1; r++) { ctx.beginPath(); ctx.moveTo(gx0, r * px); ctx.lineTo(gx1, r * px); ctx.stroke(); }
      ctx.restore();

      // 5. Doors.
      each(m.doors, (cx, cy, door) => {
        const { kind, state } = door;
        const x0 = cx * px, y0 = cy * px;
        const stateColour = state === 'open' ? '#2ecc71' : state === 'jammed' ? '#f39c12' : '#e74c3c';
        /* A door drawn as a picture still has to say whether it is SHUT, and
           the pictures cannot: open has its own art, but jammed and closed are
           the same leaf and the difference decides whether the party can walk
           through. So the state keeps its colour, as a frame around the art
           rather than the bar that was the whole drawing before. */
        const tok = tokenAt('door', kind, state, cx, cy);
        if (tok) {
          drawToken(ctx, tok, x0, y0, px);
          ctx.strokeStyle = stateColour;
          ctx.lineWidth = Math.max(1.5, px * 0.05);
          ctx.globalAlpha = 0.9;
          const o = ctx.lineWidth / 2;
          ctx.strokeRect(x0 + o, y0 + o, px - ctx.lineWidth, px - ctx.lineWidth);
          ctx.globalAlpha = 1;
          return;
        }
        ctx.fillStyle = stateColour;
        const leaf = Math.max(3, px * 0.16);
        // A trapdoor is drawn narrow and short of the walls, a door spans the
        // opening: the one you crawl through should not look like the one you
        // need a battering ram for.
        const hatch = kind === 'trapdoor';
        const inset = hatch ? px * 0.26 : 2;
        const bh = hatch ? Math.max(4, px * 0.17) : Math.max(6, px * 0.3);
        if (state === 'open') {
          ctx.fillRect(x0 + inset, y0 + inset, leaf, px - inset * 2);
          ctx.fillRect(x0 + px - inset - leaf, y0 + inset, leaf, px - inset * 2);
        } else {
          ctx.fillRect(x0 + inset, y0 + px / 2 - bh / 2, px - inset * 2, bh);
          ctx.strokeStyle = '#0b0e14';
          ctx.lineWidth = hatch ? 1 : 2;
          ctx.strokeRect(x0 + inset, y0 + px / 2 - bh / 2, px - inset * 2, bh);
        }
      });

      // 6. Markers.
      each(m.markers, (cx, cy, mk) => {
        const mx = cx * px + px / 2, my = cy * px + px / 2;
        ctx.fillStyle = markerTypeById(mk.type).colour;
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(mx, my, px * 0.36, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      });

      // 6a. Where the party starts: the DM's own note on the map, never on the
      //     projector. While the starting-room tool is in hand the whole room
      //     is tinted, so it is clear what a click would choose.
      if (m.start && !projecting) {
        if (mode === 'start') {
          ctx.fillStyle = 'rgba(243,201,110,0.16)';
          for (const c of startCells) ctx.fillRect(c.x * px, c.y * px, px, px);
        }
        const fx = m.start.x * px + px / 2, fy = m.start.y * px + px / 2;
        ctx.save();
        ctx.strokeStyle = '#f3c96e'; ctx.fillStyle = '#f3c96e';
        ctx.lineWidth = Math.max(1.5, px * 0.07);
        ctx.beginPath(); ctx.arc(fx, fy, px * 0.4, 0, Math.PI * 2);
        ctx.globalAlpha = 0.85; ctx.stroke();
        ctx.globalAlpha = 1;
        const pole = fx - px * 0.1;
        ctx.beginPath(); ctx.moveTo(pole, fy + px * 0.22); ctx.lineTo(pole, fy - px * 0.24); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pole, fy - px * 0.24); ctx.lineTo(pole + px * 0.26, fy - px * 0.14); ctx.lineTo(pole, fy - px * 0.03);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // 6b. Fog of war, over the deck and the grid both: an unexplored square
      //     must not even show how big it is.
      //
      //     IT IS DRAWN DIFFERENTLY IN THE TWO WINDOWS. The projector's copy is
      //     solid, because the table must not read through it. The GM's own tab
      //     is dimmed rather than blacked, because the GM is the one building
      //     the deck and reaching for the next square to reveal, and a tool you
      //     cannot see to aim is no tool.
      if (shown) {
        // What is DRAWN is what they have seen and can still reach through
        // open doors, so shutting a door takes the room beyond it off the
        // board without forgetting it was ever found.
        ctx.fillStyle = projecting ? 'rgb(3,4,6)' : 'rgba(3,4,6,0.82)';
        for (let x = c0; x <= c1; x++) {
          for (let y = r0; y <= r1; y++) {
            if (!shown[x + ',' + y]) ctx.fillRect(x * px, y * px, px, px);
          }
        }
      }
    }

    // 6c. Contacts. The fight is played with miniatures, so these are not
    //     models on a board — they are what the GM knows and the sense sweep
    //     leaks. A ping is drawn OVER the fog on purpose: that is the whole
    //     mechanic, something on the scope with the deck still dark.
    each(m.contacts, (cx, cy, c) => {
      // A big creature is drawn across the squares it covers, from the one
      // that was clicked as its top-left corner.
      const span = c.size || 1;
      const mx = cx * px + (px * span) / 2, my = cy * px + (px * span) / 2;
      if (c.state === 'hidden') {
        // Never on the projector: the GM's note to themselves.
        if (projecting) return;
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(220,120,120,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mx, my, px * 0.3 * span, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        return;
      }
      if (c.state === 'ping') {
        // A contact, not a creature: concentric rings, no name, no shape.
        // The party learns that something is out there and nothing else.
        for (const r of [0.44, 0.3, 0.16]) {
          ctx.beginPath();
          ctx.arc(mx, my, px * r * span, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,70,70,${0.35 + (0.5 - r)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,70,70,0.9)';
        ctx.beginPath(); ctx.arc(mx, my, px * 0.07 * Math.sqrt(span), 0, Math.PI * 2); ctx.fill();
        return;
      }
      // seen
      ctx.beginPath();
      ctx.arc(mx, my, px * 0.34 * span, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(192,57,43,0.85)';
      ctx.fill();
      ctx.strokeStyle = '#0b0e14';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, Math.floor(px * 0.26 * Math.sqrt(span)))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(c.name.slice(0, 2).toUpperCase(), mx, my + px * 0.09 * Math.sqrt(span));
    });

    // 7. THE OVERLAYS — the reason this is worth projecting at all.
    if (overlay) {
      const ox = origin.x * px + px / 2, oy = origin.y * px + px / 2;

      // Dead ground first, so everything else paints over it: what cannot be
      // seen from the firing square is dimmed rather than hidden, because
      // the GM still needs to see the deck they are ruling on. Not at an
      // overview, where the squares are too small to read it.
      if (seeable && !overview) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        for (let x = c0; x <= c1; x++) {
          for (let y = r0; y <= r1; y++) {
            if (!seeable(x, y)) ctx.fillRect(x * px, y * px, px, px);
          }
        }
      }

      // The caught squares are tinted faintly UNDER the template art: the
      // smooth shape is what the table reads, but the DM still needs to see
      // exactly which squares are in it, and a gradient edge alone is a
      // thing to argue over.
      const target = aim || hover;
      const inSquares = (ft) => (ft / (m.feetPerSquare || FEET_PER_SQUARE)) * px;
      const shape = ov && ov.area ? ov.area.shape : null;
      if (overlay.area.length) {
        fill(overlay.area, overlay.kind === 'field' ? 'rgba(0,229,255,0.10)'
          : overlay.kind === 'cone' ? 'rgba(255,170,40,0.14)'
            : shape === 'cube' || shape === 'line' ? 'rgba(168,130,255,0.2)'
              : 'rgba(231,76,60,0.12)');
      }

      if (overlay.kind === 'field' && overlay.area.length) {
        clipToCells(ctx, overlay.area, px,
          () => drawShield(ctx, ox, oy, inSquares(ov.area.size)));
      }
      if (overlay.kind === 'cone' && overlay.area.length && target) {
        clipToCells(ctx, overlay.area, px, () => drawCone(
          ctx, ox, oy,
          Math.atan2(target.y - origin.y, target.x - origin.x),
          inSquares(ov.area.size),
          CONE_HALF_ANGLE_DEG * Math.PI / 180
        ));
      }
      if (overlay.kind === 'beam' && shape === 'sphere' && overlay.area.length && target) {
        clipToCells(ctx, overlay.area, px, () => drawBlast(
          ctx, target.x * px + px / 2, target.y * px + px / 2,
          inSquares(ov.area.size)
        ));
      }
      // A cube or a line has no smooth shape: it IS its squares, so they are
      // outlined, and that outline is what the table reads.
      if ((shape === 'cube' || shape === 'line') && overlay.area.length) {
        ctx.strokeStyle = 'rgba(190,160,255,0.95)';
        ctx.lineWidth = 2;
        for (const c of overlay.area) ctx.strokeRect(c.x * px + 1, c.y * px + 1, px - 2, px - 2);
      }

      // Range bands as rings, outermost first so the near ones sit on top.
      for (const ring of overlay.rings) {
        const rp = ring.radius * px;
        ctx.beginPath();
        ctx.arc(ox, oy, rp, 0, Math.PI * 2);
        ctx.strokeStyle = BAND_COLOUR[ring.band] || '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash(ring.band === 'reach' ? [] : [7, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ringTicks(ctx, ox, oy, rp, px * 0.28, BAND_COLOUR[ring.band] || '#fff');
        // Label where the ring crosses due east, clipped to the canvas.
        const lx = ox + ring.radius * px;
        if (lx < w - 4) {
          ctx.fillStyle = BAND_COLOUR[ring.band] || '#fff';
          ctx.font = `${Math.max(9, Math.floor(px * 0.3))}px system-ui, sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillText(`${ring.feet} ft${ring.effect ? ' ·' + ring.effect.slice(0, 4) + '.' : ''}`, lx - 3, oy - 4);
        }
      }

      // The shot itself, over the rings so the lane is not lost under them.
      if (overlay.shot && overlay.target) {
        drawShot(ctx, px, origin, overlay.target, overlay.shot.blocked);
      }

      // The firing square itself.
      ctx.beginPath();
      ctx.arc(ox, oy, px * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 2; ctx.stroke();
    }

    // 8. The stamp preview, so a 1x5 corridor shows where it will land.
    if (hover && mode === 'stamp') {
      ctx.fillStyle = 'rgba(0,229,255,0.3)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      for (const c of stampCells(tileId, hover, rotation, m)) {
        ctx.fillRect(c.x * px, c.y * px, px, px);
        ctx.strokeRect(c.x * px, c.y * px, px, px);
      }
    } else if (hover && (mode === 'paint' || mode === 'erase' || mode === 'ground')) {
      fill(brushCells(hover, brush, m),
        mode === 'erase' ? 'rgba(231,76,60,0.4)'
          // Terrain lays down rather than builds, so it gets its own colour:
          // a green brush would read as "this adds deck".
          : mode === 'ground' ? 'rgba(0,229,255,0.35)'
            : 'rgba(46,204,113,0.4)');
    } else if (hover && mode === 'obscure') {
      fill(brushCells(hover, brush, m), 'rgba(95,159,85,0.45)');
    } else if (hover && mode === 'noise' && !projecting) {
      // How far this sound carries, as the GM lines it up.
      const n = noiseById(noiseKind);
      if (n) fill(areaCells(m, hover, n.radiusFt), 'rgba(255,200,60,0.16)');
    }

    // 9. The measuring tape.
    if (measureFrom && measureTo && measurement) {
      drawShot(ctx, px, measureFrom, measureTo, measurement.blocked);
    }

    // 10. The calibration bar. Drawn last and over everything, because its
    //     whole job is to be measured against a ruler on the table. Kept in
    //     the corner of what is in view, so it is never off-screen.
    if (showCalibration) {
      const bar = calibrationBar(m, { targetMm: 100 });
      const bx = Math.max(0, vx0) + px, by = Math.min(h, vy1) - px * 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(bx - 6, by - px * 0.55, bar.px + 12, px * 0.8);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bar.px, by); ctx.stroke();
      // End caps, so there is something unambiguous to line a ruler up with.
      ctx.beginPath(); ctx.moveTo(bx, by - px * 0.25); ctx.lineTo(bx, by + px * 0.25); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + bar.px, by - px * 0.25); ctx.lineTo(bx + bar.px, by + px * 0.25);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(10, Math.floor(px * 0.32))}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(bar.label, bx + 4, by - px * 0.3);
    }
    ctx.restore();
  };

  // Sizes the canvas to the part of the deck in view and draws it. Called from
  // the effect below whenever anything it shows changes, and straight from the
  // scroll listener, so the picture never trails the scroll by a frame.
  const draw = () => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const wrapW = Math.max(1, Math.round(m.cols * px * zoom));
    const wrapH = Math.max(1, Math.round(m.rows * px * zoom));
    const cw = Math.max(1, Math.min(stage.clientWidth || wrapW, wrapW));
    const ch = Math.max(1, Math.min(stage.clientHeight || wrapH, wrapH));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const left = Math.max(0, Math.min(stage.scrollLeft, wrapW - cw));
    const top = Math.max(0, Math.min(stage.scrollTop, wrapH - ch));
    paint(canvas.getContext('2d'), { left, top, width: cw, height: ch, zoom });
  };
  drawRef.current = draw;

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, px, theme, hover, mode, tileId, rotation, brush, overlay, origin, aim, ov, projecting,
      measureFrom, measureTo, measurement, showZones, showCalibration, seeable, shown, textureTick,
      tokenTick, noiseKind, zoom, showOptions, startCells]);

  // Scrolling and resizing the stage move the window over the deck.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const w = win || window;
    const again = () => drawRef.current();
    el.addEventListener('scroll', again, { passive: true });
    const ro = typeof w.ResizeObserver === 'function' ? new w.ResizeObserver(again) : null;
    if (ro) ro.observe(el);
    return () => {
      el.removeEventListener('scroll', again);
      if (ro) ro.disconnect();
    };
  }, [win]);

  /* ---- controls ---- */

  const num = (label, value, onSet, min, max, step = 1) => (
    <label className="bm-num">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
        /* A focused number input takes the mouse wheel, and these sit a
           centimetre above a map the GM scrolls. Spinning px/square by
           accident would decalibrate the projector mid-session without
           anyone seeing it happen, so the wheel drops focus instead. */
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onSet(Math.min(max, Math.max(min, n)));
        }} />
    </label>
  );

  /* Grow the grid to whatever the window gives us, at the px/square already
     calibrated. A projector or a second screen is the whole point of this
     thing, so the deck should use the glass rather than sit in the corner of
     it. The squares keep their size; there are simply more of them. */
  const fitToStage = () => {
    const el = stageRef.current;
    if (!el) return;
    const pad = 2;    // the stage's border
    const cur = mapRef.current;
    const cols = fitGrid(el.clientWidth - pad, cur.pxPerSquare);
    const rows = fitGrid(el.clientHeight - pad, cur.pxPerSquare);
    if (cols === cur.cols && rows === cur.rows) return;
    if (onChange) onChange({ ...cur, cols, rows });
  };

  /* The stage takes everything from wherever it has landed down to the
     bottom of the screen.

     A fixed height in vh cannot do this: what sits above the map differs
     between the dashboard tab and its own window, and inside the tab it
     changes as the toolbars reflow — picking a tool with a long hint pushes
     the map down by a line. Measuring the stage's own top is the only thing
     that knows. A ResizeObserver on the component catches the reflow; the
     height it computes does not depend on the stage's own height, so
     setting it cannot feed back into another measurement. */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const w = win || window;
    const sizeStage = () => {
      const top = el.getBoundingClientRect().top;
      const next = Math.max(240, Math.round(w.innerHeight - top - 14));
      if (Math.abs(el.clientHeight - next) > 1) el.style.height = next + 'px';
    };
    sizeStage();
    const ro = typeof w.ResizeObserver === 'function'
      ? new w.ResizeObserver(sizeStage) : null;
    if (ro && el.parentElement) ro.observe(el.parentElement);
    w.addEventListener('resize', sizeStage);
    return () => {
      if (ro) ro.disconnect();
      w.removeEventListener('resize', sizeStage);
    };
  }, [win]);

  // In a window of its own there is no reason not to fill it, so the grid
  // fits itself on open and whenever the window is resized. In the dashboard
  // tab the deck's size is the GM's to set with Fit to screen, because
  // resizing a panel should not quietly redraw the deck being built.
  useEffect(() => {
    if (!win) return undefined;
    // Only a blank deck. Now that the window and the tab share one map,
    // fitting on open would resize a deck the GM had already built — and
    // shrinking hides painted squares, even though the floor keeps them.
    if (!Object.keys(mapRef.current.floor).length) fitToStage();
    const onResize = () => fitToStage();
    win.addEventListener('resize', onResize);
    return () => win.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, m.pxPerSquare]);

  /* Zooming the deck, kept clear of scrolling it.

     The plain wheel scrolls: a deck bigger than the window is read by
     scrolling it, and a wheel that also zoomed meant every scroll changed the
     scale under the cursor. Zoom now needs a deliberate gesture: hold the
     right mouse button and turn the wheel, or hold Z and turn the wheel. A
     trackpad pinch also works, because browsers report it as a wheel event
     with ctrl held.

     A native listener rather than React's onWheel: React registers wheel
     listeners as passive, and a passive listener cannot stop the page
     scrolling, so the deck zoomed and slid at the same time. */
  const zHeldRef = useRef(false);
  const rightZoomedRef = useRef(false);

  /* Zooms to `target`, holding the point under (clientX, clientY) still. The
     wheel passes the pointer; the buttons pass the middle of the stage. Only
     refs and setters are touched, so the effect below can keep the copy it
     was bound with. */
  const zoomAt = (target, clientX, clientY) => {
    const el = stageRef.current;
    if (!el) return;
    const w = win || window;
    const box = el.getBoundingClientRect();
    const px0 = clientX === undefined ? box.left + el.clientWidth / 2 : clientX;
    const py0 = clientY === undefined ? box.top + el.clientHeight / 2 : clientY;
    const atX = px0 - box.left + el.scrollLeft;
    const atY = py0 - box.top + el.scrollTop;
    const cur = zoomRef.current;
    const next = clampZoom(target);
    if (next === cur) return;
    const k = next / cur;
    zoomRef.current = next;
    setZoom(next);
    setZoomPct(String(Math.round(next * 100)));
    // About the point, after the browser has laid the bigger deck out.
    // Without the correction the deck slides out from under the cursor.
    w.requestAnimationFrame(() => {
      el.scrollLeft = atX * k - (px0 - box.left);
      el.scrollTop = atY * k - (py0 - box.top);
    });
  };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const w = win || window;
    const typing = (t) => ['INPUT', 'SELECT', 'TEXTAREA'].includes((t && t.tagName) || '');

    const onKeyDown = (e) => {
      if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
        zHeldRef.current = true;
      }
    };
    const onKeyUp = (e) => { if (e.key.toLowerCase() === 'z') zHeldRef.current = false; };
    // A key held while the window loses focus never reports its release.
    const onBlur = () => { zHeldRef.current = false; rightZoomedRef.current = false; };

    const onWheel = (e) => {
      const rightHeld = (e.buttons & 2) === 2;
      if (!(rightHeld || zHeldRef.current || e.ctrlKey)) return;   // a plain wheel scrolls
      e.preventDefault();
      if (rightHeld) { rightZoomedRef.current = true; setMenu(null); }
      // A pinch arrives as many small deltas; a wheel notch as one large one.
      const step = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : (e.deltaY < 0 ? 1.12 : 1 / 1.12);
      zoomAt(zoomRef.current * step, e.clientX, e.clientY);
    };
    /* The right button does two things here: with the wheel it zooms, on its
       own it opens the menu. Which one it was is only known once the button
       comes up — except that macOS reports the menu on the press — so a press
       is held as "maybe a menu" and opened on release if no zoom happened.
       Ctrl-click is left to the fog tool, which uses it to take a place back. */
    let pending = null;
    const onContextMenu = (e) => {
      e.preventDefault();
      if (rightZoomedRef.current) { rightZoomedRef.current = false; pending = null; return; }
      if (e.ctrlKey) return;
      const cell = cellAtRef.current ? cellAtRef.current(e) : null;
      if ((e.buttons & 2) === 2) { pending = { x: e.clientX, y: e.clientY, cell }; return; }
      setMenu({ x: e.clientX, y: e.clientY, cell });
    };
    const onMouseUp = (e) => {
      if (e.button !== 2) return;
      if (pending && !rightZoomedRef.current) setMenu(pending);
      pending = null;
    };
    const onMouseDown = (e) => { if (e.button === 2) { rightZoomedRef.current = false; pending = null; } };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('mousedown', onMouseDown);
    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('keyup', onKeyUp);
    w.addEventListener('blur', onBlur);
    w.addEventListener('mouseup', onMouseUp);
    return () => {
      w.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('mousedown', onMouseDown);
      w.removeEventListener('keydown', onKeyDown);
      w.removeEventListener('keyup', onKeyUp);
      w.removeEventListener('blur', onBlur);
    };
  }, [win]);

  // Hiding the toolbars frees the height they held; in the map's own window
  // the grid grows into it, as it does on a resize. Waits a frame for the
  // layout to settle before measuring.
  useEffect(() => {
    if (!win) return undefined;
    const id = win.requestAnimationFrame(() => fitToStage());
    return () => win.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOptions, isFull]);

  const allExplored = () => {
    const out = {};
    for (let x = 0; x < m.cols; x++) for (let y = 0; y < m.rows; y++) out[cellKey(x, y)] = true;
    return out;
  };

  const clearAll = async () => {
    if (!await confirmInMap({
      title: 'Clear the map?',
      body: 'Everything drawn on this map goes: the floor and its walls, the doors,'
        + ' cover, hazards, foliage, markers, contacts, painted terrain and what the'
        + ' party has explored. The grid size, the ground and the calibration stay.',
      yes: 'Clear it'
    })) return;
    /* EVERYTHING THAT STOOD ON THE DECK, not just the floor.

       It used to clear the floor, the doors and the markers, which left the
       crates, the fires, the foliage, the painted terrain and the fog
       behind — floating over a deck that was no longer there. With the props
       drawn as grey boxes that read as faint debris; now that they are
       photographs of crates it reads as the deck not having cleared at all. */
    patch({
      floor: {}, doors: {}, markers: {}, cover: {}, hazards: {}, obscuring: {},
      contacts: {}, ground: {}, explored: {}, viewpoint: null
    });
    originRef.current = null; measureRef.current = null;
    setMeasureFrom(null); setMeasureTo(null); setOrigin(null); setAim(null);
  };

  /* Grows the deck by repeating what is already built, rather than adding
     bare grid for the GM to paint. Nothing is asked first: it is additive
     where it grows, and `Expand map` back to the old numbers puts it back —
     except where it SHRINKS, which drops squares, so that is confirmed. */
  const expandDeck = async () => {
    const plan = expandPlan(m, growCols, growRows);
    if (!onChange) return;
    /* THE DEFAULT GROWS FROM WHAT IS PAINTED. The painted deck stays where it
       is and new rooms are built in the added space, each joined to the deck
       and carrying its ground on. Repeating the deck (flipped or not) is still
       here for the one case it suits, a deck designed to be tiled. */
    if (growHow === 'grow' && !plan.shrinking) {
      const out = buildAroundDeck(m, { cols: plan.cols, rows: plan.rows, style: genStyle, seed: genSeed.trim() || undefined });
      setGenSeed(out.seed);
      const g = out.map;
      patch({ cols: g.cols, rows: g.rows, floor: g.floor, doors: g.doors, ground: g.ground });
      setDeckMsg(`Built ${out.rooms} new room${out.rooms === 1 ? '' : 's'} off the painted map (seed ${out.seed}).`);
      return;
    }
    if (plan.shrinking && !await confirmInMap({
      title: 'Shrink the map?',
      body: `${plan.cols}\u00d7${plan.rows} is smaller than this map. Every square outside`
        + ' it is dropped, along with whatever is standing on it.',
      yes: 'Shrink it'
    })) return;
    remember(mapRef.current);
    gestureRef.current = false;
    onChange(expandMap(m, growCols, growRows, { mirror: growHow !== 'repeat' }));
    setDeckMsg('');
  };

  /* Lays out a deck: compartments, the runs between them, and a door at
     every junction. The seed is what makes it a deck rather than a roll —
     written down, it comes back, so an edit that goes wrong is recoverable
     and a layout worth keeping can be handed to someone else.

     REPLACES THE FLOOR, so it asks first when there is one. What it does not
     touch is the ground, the calibration or the deck's name: those are the
     GM's, and a generator that reset them would be taking more than it was
     asked for. */
  /* Lays terrain over the deck (or the whole grid) from the prompt and the
     grounds ticked. One undoable step, and it says what it understood. */
  const generateTerrainNow = () => {
    const ticked = terrainPick || [...new Set([m.theme, ...customThemes.map((t) => t.id)])];
    const out = generateTerrain({
      map: m, grounds: allGrounds, palette: ticked, prompt: terrainPrompt,
      seed: terrainSeed.trim() || undefined, size: terrainSize, scope: terrainScope,
      // On a blank deck this builds rooms and corridors to paint onto, and
      // uses the layout style the Deck panel is set to rather than a second
      // picker saying the same thing.
      style: genStyle
    });
    setTerrainSeed(out.seed);
    if (out.empty) {
      setTerrainNote('There is nothing to cover: the map has no squares without terrain on them. Try \u201cOver the painted floor\u201d or \u201cThe whole grid\u201d.');
      return;
    }
    const next = { ground: out.ground, obscuring: out.obscuring, cover: out.cover, hazards: out.hazards };
    if (out.laid) next.floor = out.floor;
    // A layout it built brings its own doors.
    if (out.built) next.doors = out.doors;
    patch(next);
    const c = out.counts;
    setTerrainNote(
      `${out.built ? `Built ${out.rooms} rooms and laid ` : 'Laid '}${c.squares.toLocaleString()} squares in ${c.regions} regions from ${c.grounds} ground${c.grounds === 1 ? '' : 's'}`
      + `${c.foliage ? `, ${c.foliage} of foliage` : ''}${c.cover ? `, ${c.cover} of cover` : ''}`
      + `${c.hazards ? `, ${c.hazards} of hazard` : ''}${c.band ? ', and a ' + (terrainRead.band ? terrainRead.band.kind : 'band') : ''}. Seed ${out.seed}.`);
  };

  const rollDeck = async () => {
    const seed = genSeed.trim() || newSeed();
    /* With a deck already painted, the default is to build around it: the
       generator fills the empty ground with rooms joined to what is there,
       and nothing painted is touched. Replacing it is the other choice. */
    if (Object.keys(m.floor).length && buildAround) {
      const built = buildAroundDeck(m, { cols: m.cols, rows: m.rows, style: genStyle, seed });
      setGenSeed(built.seed);
      const g = built.map;
      patch({ floor: g.floor, doors: g.doors, ground: g.ground });
      setDeckMsg(`Built ${built.rooms} new room${built.rooms === 1 ? '' : 's'} around the painted map (seed ${built.seed}).`);
      return;
    }
    if (Object.keys(m.floor).length && !await confirmInMap({
      title: 'Replace the map?',
      body: 'A generated layout takes the place of what is drawn here. The ground, the'
        + ' grid size and the calibration are kept. Undo brings this map back.',
      yes: 'Generate it'
    })) return;
    const out = generateDeck({ cols: m.cols, rows: m.rows, style: genStyle, seed });
    setGenSeed(out.seed);
    patch({
      floor: out.floor,
      doors: out.doors,
      // Everything that was placed ON the old deck refers to squares that no
      // longer exist. Left behind, a crate sits in the void and a contact
      // pings from inside a wall.
      cover: {}, hazards: {}, markers: {}, contacts: {},
      explored: {}, viewpoint: null
    });
    originRef.current = null; measureRef.current = null;
    setMeasureFrom(null); setMeasureTo(null); setOrigin(null); setAim(null);
  };

  /* Generates a floor with the same Gemini pipeline the portraits use. The
     GM describes the ground; the server wraps that in the clauses that make
     it a floor rather than a picture (top-down, seamless, flat light, no grid
     of its own) — so what is ON the ground is theirs and the shot is ours.

     Nothing is written to the deck here. The result is held as a preview
     until they say they are happy with it, because the first attempt usually
     is not the one you keep. */
  const generateGround = async () => {
    setGenErr(''); setGenBusy(true);
    try {
      const blob = await requestImage({ describe: genDescribe, cover: genCover, condition: genCond });
      /* Shrunk hard, because it is kept in the GM's library as a data URL
         and that library has a real byte ceiling. 512 is plenty for a floor
         that TILES — at a 40px square one copy already spans twelve squares
         — and it is the difference between a handful of saved grounds
         fitting and the first one filling the budget on its own. */
      const texture = await shrinkToDataUrl(blob, 512, 0.75);
      setPreview({ texture, numbers: await sampleNumbers(texture) });
    } catch (e) {
      setGenErr(e.message || 'Generation failed');
    } finally {
      setGenBusy(false);
    }
  };

  /* The props that stand on that floor: sixteen doors, barriers, crates,
     pillars, fires and thickets, generated as ONE 4x4 sheet from the same
     description the floor came from.

     One image rather than sixteen, which is one call rather than sixteen —
     but the reason is not the bill. Generated one at a time they come back in
     sixteen different lights and sixteen degrees of wear, and a deck dressed
     in them looks like a collage; asked for together, the model is composing
     a set. It is the same reason the nine that ship are sheets. */
  const generateProps = async () => {
    if (!preview) return;
    setGenErr(''); setPropsBusy(true);
    try {
      const sprites = await keySheet(await requestImage({
        kind: 'sprites', describe: genDescribe, cover: genCover, condition: genCond
      }));
      if (sprites.length > MAX_CUSTOM_SPRITES) {
        throw new Error('That sheet came back too large to store. Try generating it again.');
      }
      setPreview((p) => (p ? { ...p, sprites } : p));
    } catch (e) {
      setGenErr(e.message || 'Generation failed');
    } finally {
      setPropsBusy(false);
    }
  };

  /* A floor of the GM's own. It lands in the same preview a generated one
     does, so it is judged tiled and saved by the same road.

     Cropped and recompressed to match the shipped floors, and SAID so: the
     two files people reach for are a photo and a screenshot, and both are
     the wrong shape for something that tiles. */
  const uploadGround = (file) => {
    if (!file) return;
    setGenErr(''); setUploadNote('');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const advice = textureAdvice({ width: img.naturalWidth, height: img.naturalHeight });
      if (!advice.ok) { URL.revokeObjectURL(url); setGenErr(advice.message); return; }
      setUploadNote(advice.message);
      // Opens on the middle, which is where the old centre-crop took it from.
      // Pressing straight through gives the tile this gave before it could
      // be dragged at all.
      setCrop({ file, url, ...centreCrop(img.naturalWidth, img.naturalHeight, CROP_BOX) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); setGenErr('Could not read that image.'); };
    img.src = url;
  };

  /* The object URL is the browser holding the whole file in memory for us.
     Dropped here rather than on unmount alone, because a GM trying four
     photographs for one floor would otherwise be holding all four. */
  const closeCrop = () => setCrop((c) => {
    if (c) URL.revokeObjectURL(c.url);
    return null;
  });

  const recentre = (c) => ({ ...c, ...centreCrop(c.imgW, c.imgH, c.box) });

  /* Cuts the chosen square and hands it to the same preview a generated
     floor lands in, so both are judged tiled and saved by the same button. */
  const commitCrop = async () => {
    if (!crop) return;
    setGenErr(''); setGenBusy(true);
    try {
      const out = await prepareTexture(crop.file, {
        square: cropSquare,
        // Unticked means take the file as it is, so there is no square to
        // cut and the rect would be meaningless.
        rect: cropSquare ? cropRect(crop) : null
      });
      setPreview({ texture: out.dataUrl, numbers: await sampleNumbers(out.dataUrl) });
      setUploadNote(
        `Stored at ${out.width}\u00d7${out.height}, ${Math.round(out.bytes / 1024)}KB.`
      );
      closeCrop();
    } catch (e) {
      setGenErr(e.message || 'Could not read that image.');
    } finally {
      setGenBusy(false);
    }
  };

  /* Reads the generated floor back to work out its five numbers. Drawn small
     on purpose — this wants the average of the whole floor, not its
     detail, and 64x64 is plenty for that. */
  const sampleNumbers = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      resolve(themeNumbersFor({ r: r / n, g: gg / n, b: b / n }));
    };
    // A floor we cannot read gets the neutral set rather than no theme.
    img.onerror = () => resolve(themeNumbersFor({}));
    img.src = dataUrl;
  });

  /* Keeps it. The preview becomes a named environment in the GM's own
     library, the map switches to it, and it is in the picker from then on
     beside the nine built in. */
  const saveGround = async () => {
    if (!preview) return;
    if (!onSaveTheme) {
      // It used to be a disabled button with nothing to say. A GM pressing
      // it learned only that pressing it did nothing.
      setGenErr('This window cannot save grounds.');
      return;
    }
    setGenBusy(true);
    const saved = await onSaveTheme({
      name: genName.trim() || 'Saved ground',
      texture: preview.texture,
      // Null rather than absent when there are none: the store reads an
      // absent sheet as "leave what is there alone", which is what renaming a
      // dressed ground wants, and an explicit null as "it has none".
      sprites: preview.sprites || null,
      prompt: [genDescribe, genCover].filter(Boolean).join(' / '),
      subtitle: genCover ? `with ${genCover}` : '',
      ...preview.numbers
    });
    setGenBusy(false);
    if (!saved || !saved.id) {
      // The store said no — out of room, or offline. The message is already
      // on screen; keep the preview so the work is not thrown away with it.
      if (!genErr) setGenErr('Could not save that ground.');
      return;
    }
    patch({ theme: saved.id, customTexture: null });
    setPreview(null);
    setGenName('');
    setGenOpen(false);
  };

  // The whole deck, drawn into a canvas of its own: the one on screen is only
  // the part in view. Scaled down so a very big deck stays a picture a browser
  // will make rather than a canvas it refuses.
  const exportPng = () => {
    const doc = (win || window).document;
    const scale = Math.min(1, 8000 / (Math.max(m.cols, m.rows) * px));
    const c = doc.createElement('canvas');
    c.width = Math.max(1, Math.round(m.cols * px * scale));
    c.height = Math.max(1, Math.round(m.rows * px * scale));
    paint(c.getContext('2d'), { left: 0, top: 0, width: c.width, height: c.height, zoom: scale });
    const el = doc.createElement('a');
    el.download = `battle-map-${m.theme}.png`;
    el.href = c.toDataURL('image/png');
    el.click();
  };

  /* ---- the right-click menu ----
     The toolbar can be hidden for a clean map, and the map is then all there
     is on the glass. A right click brings up the tools and what they need
     without bringing the toolbar back: pick a tool, set its option (door kind,
     brush, terrain, weapon…), switch fog, set the light, undo, turn, zoom.
     Everything here is what the toolbar does, through the same handlers.

     Every choice closes the menu; only a group's heading unfolds it. */
  const doMenu = (fn) => () => { fn(); setMenu(null); };
  const radio = (key, label, checked, run) => ({ key, label, checked, run });
  const menuGroups = () => {
    const out = [];
    const add = (id, title, items) => out.push({
      id, title, items, current: (items.find((i) => i.checked) || {}).label || ''
    });
    if (mode === 'stamp') {
      add('tile', 'Tile', TILE_CATALOG.map((t) => radio(t.id, `${t.name} (${t.w}\u00d7${t.h})`, tileId === t.id, () => setTileId(t.id))));
    }
    if (['paint', 'erase', 'ground', 'obscure'].includes(mode)) {
      add('brush', 'Brush size', [1, 2, 3, 5, 7, 10].map((n) => radio('b' + n, `${n}\u00d7${n}`, brush === n, () => setBrush(n))));
    }
    if (mode === 'ground') {
      add('terrain', 'Terrain', [
        radio('own', `This map's ground (${theme.name}) \u2014 lifts paint`, paintGround === m.theme, () => setPaintGround(m.theme)),
        ...allGrounds.filter((t) => t.id !== m.theme).map((t) => radio(t.id, t.name + (t.custom ? ' \u2605' : ''), paintGround === t.id, () => setPaintGround(t.id)))
      ]);
    }
    if (mode === 'obscure') {
      add('density', 'Density', OBSCURING.map((o) => radio(o.id, `${o.name} \u00b7 stops sight after ${o.blocksAfterFt} ft`, obscureType === o.id, () => setObscureType(o.id))));
    }
    if (mode === 'door') add('door', 'Door kind', DOOR_KINDS.map((d) => radio(d.id, `${d.name} \u00b7 AC ${d.ac}`, doorKind === d.id, () => setDoorKind(d.id))));
    if (mode === 'cover') {
      add('cover', 'Cover', COVER_TYPES.map((c) => radio(c.id, `${c.name} \u00b7 ${coverText(c)}`, coverType === c.id, () => setCoverType(c.id))));
      // Reachable with the toolbars hidden, which is how the map is run on a
      // projector \u2014 and laying a barrier is exactly a mid-session job.
      if (coverType === 'low') {
        add('coverturn', 'Wall lies', [
          radio('across', 'Across \u2014 horizontal', coverTurn === 0, () => setCoverTurn(0)),
          radio('along', 'Along \u2014 vertical', coverTurn === 1, () => setCoverTurn(1))
        ]);
      }
    }
    if (mode === 'hazard') add('hazard', 'Hazard', HAZARD_TYPES.map((h) => radio(h.id, h.name, hazardType === h.id, () => setHazardType(h.id))));
    if (mode === 'noise') add('noise', 'Sound', NOISE.map((n) => radio(n.id, `${n.name} \u00b7 heard to ${n.radiusFt} ft`, noiseKind === n.id, () => setNoiseKind(n.id))));
    if (mode === 'marker') add('marker', 'Marker', MARKER_TYPES.map((t) => radio(t.id, t.name, markerType === t.id, () => setMarkerType(t.id))));
    if (mode === 'overlay' || mode === 'measure') {
      // The weapons only: five hundred spells are not a menu. They are
      // searched by name in the bar.
      add('weapon', 'Weapon', [
        radio('none', 'No weapon or spell', !pick, () => { setPick(''); setSpellText(''); }),
        ...ARMED.map((a) => radio(a.key, `${a.label} \u00b7 ${a.kind}`, pick === a.key, () => { setPick(a.key); setSpellText(''); }))
      ]);
    }
    add('light', 'Light', LIGHTING_PRESETS.map((p) => radio(p.id, p.name, m.lighting === p.id, () => patch({ lighting: p.id }))));
    return out;
  };
  const menuActions = () => {
    const a = [];
    // The door that was right-clicked, set to any of its states directly: the
    // click cycles, and a DM who wants it jammed should not have to step
    // through the others to get there.
    const dc = menu && menu.cell;
    const dr = dc ? m.doors[cellKey(dc.x, dc.y)] : null;
    if (dr) {
      const noun = dr.kind === 'trapdoor' ? 'Trapdoor' : 'Door';
      a.push({ key: 'd-open', label: `${noun}: open it`, checked: dr.state === 'open', run: () => clickDoor(dc, 'open') });
      a.push({ key: 'd-closed', label: `${noun}: close it`, checked: dr.state === 'closed', run: () => clickDoor(dc, 'closed') });
      a.push({ key: 'd-jammed', label: `${noun}: jam it`, checked: dr.state === 'jammed', run: () => clickDoor(dc, 'jammed') });
    }
    if (mode === 'stamp') a.push({ key: 'rot', label: `Rotate the tile (now ${rotation}\u00b0)`, hint: 'R', run: () => setRotation((r) => (r + 90) % 360) });
    if (mode === 'ground') {
      a.push({
        key: 'terrain', label: 'Procedural terrain\u2026', icon: 'ground',
        run: () => { setGroundTab('terrain'); setGenOpen(true); setShowOptions(true); }
      });
    }
    if (mode === 'fog') {
      if (m.start) a.push({ key: 'restart', label: 'Back to the starting room', run: () => patch(startPlay(m)) });
      a.push({ key: 'reveal', label: 'Reveal everything', run: () => patch({ explored: allExplored() }) });
      a.push({ key: 'hide', label: 'Hide everything', run: () => patch({ explored: {} }) });
    }
    if (mode === 'overlay') {
      a.push({ key: 'bands', label: 'Range bands', checked: showRings, run: () => setShowRings((v) => !v) });
      a.push({ key: 'los', label: 'Line of sight', checked: showLos, run: () => setShowLos((v) => !v) });
      a.push({ key: 'clear', label: 'Clear the overlay', run: () => { originRef.current = null; setOrigin(null); setAim(null); } });
    }
    return a;
  };
  /* ---- what the right-clicked square can be given ----
     The tools lay hazards, smoke and markers by clicking, and that means
     picking the tool first, which is a trip to the toolbar the projector view
     does not have. So the square under the pointer can be given these
     directly, on either tab and with whatever tool is in hand: set fire to it,
     fill it with smoke, mark it, drop a contact on it. Choosing what is
     already there takes it off again, the way the tools do. */
  const hereCell = menu && menu.cell ? menu.cell : null;
  const hereKey = hereCell ? cellKey(hereCell.x, hereCell.y) : null;
  const hereHas = hereCell
    ? Boolean(m.hazards[hereKey] || m.obscuring[hereKey] || m.markers[hereKey] || m.contacts[hereKey])
    : false;
  const hereGroups = () => {
    if (!hereCell) return [];
    const out = [];
    const add = (id, title, items) => out.push({
      id, title, items, current: (items.find((i) => i.checked) || {}).label || ''
    });
    /* A door or trapdoor on this square, of any kind: the Door tool without
       the tool. A square that already has one keeps its state when the kind
       is changed, so a jammed door swapped for an iron one is still jammed. Its
       open, closed and jammed are further up the menu, and "Remove the door"
       is below. */
    add('h-door', 'Door or trapdoor', DOOR_KINDS.map((d) => radio('dr-' + d.id, `${d.name} \u00b7 AC ${d.ac}`,
      Boolean(m.doors[hereKey] && m.doors[hereKey].kind === d.id), () => {
        const doors = { ...m.doors };
        const here = doors[hereKey];
        doors[hereKey] = { kind: d.id, state: here ? here.state : 'closed' };
        patch({ doors });
      })));
    add('h-hazard', 'Fire, poison, acid\u2026', HAZARD_TYPES.map((h) => radio('hz-' + h.id, h.name, m.hazards[hereKey] === h.id, () => {
      const hazards = { ...m.hazards };
      if (hazards[hereKey] === h.id) delete hazards[hereKey]; else hazards[hereKey] = h.id;
      patch({ hazards });
    })));
    add('h-smoke', 'Fog or foliage', OBSCURING.map((o) => radio('sm-' + o.id, `${o.name} \u00b7 ${cloud}\u00d7${cloud}`, m.obscuring[hereKey] === o.id, () => {
      const obscuring = { ...m.obscuring };
      const lifting = obscuring[hereKey] === o.id;
      for (const c of brushCells(hereCell, cloud, m)) {
        const ck = cellKey(c.x, c.y);
        if (lifting) delete obscuring[ck]; else obscuring[ck] = o.id;
      }
      patch({ obscuring });
    })));
    add('h-cloud', 'Cloud size', [1, 3, 5, 7].map((n) => radio('cl' + n, `${n}\u00d7${n}`, cloud === n, () => setCloud(n))));
    const mkHere = m.markers[hereKey] || null;
    add('h-token', 'Marker', MARKER_TYPES.map((t) => radio('mk-' + t.id, t.name, Boolean(mkHere && mkHere.type === t.id), () => {
      const markers = { ...m.markers };
      if (markers[hereKey] && markers[hereKey].type === t.id) delete markers[hereKey];
      else markers[hereKey] = { type: t.id, label: markerTypeById(t.id).name };
      patch({ markers });
    })));
    return out;
  };
  /* The monster named in the Contacts bar, put on this square as a contact
     the table has not found yet: the same thing the Contacts tool lays,
     without picking it. Picking it again lifts it. */
  const contactItem = () => {
    const name = contactName.trim();
    if (!hereCell || !name) return null;
    const here = m.contacts[hereKey];
    return {
      key: 'h-contact', label: here ? `Lift the contact (${here.name})` : `Hide a ${name} here`,
      run: () => {
        const contacts = { ...m.contacts };
        if (here) delete contacts[hereKey];
        else {
          const mon = monsterByName(name);
          const size = mon ? footprintSquares(mon.size, m.feetPerSquare) : 1;
          contacts[hereKey] = size > 1 ? { name, state: 'hidden', size } : { name, state: 'hidden' };
        }
        patch({ contacts });
      }
    };
  };
  const clearHere = () => {
    const hazards = { ...m.hazards }; const obscuring = { ...m.obscuring };
    const markers = { ...m.markers }; const contacts = { ...m.contacts };
    delete hazards[hereKey]; delete obscuring[hereKey]; delete markers[hereKey]; delete contacts[hereKey];
    patch({ hazards, obscuring, markers, contacts });
  };
  /* ---- the overlay, from the menu ----
     The overlay is two clicks and a weapon or spell: where the caster stands,
     what they point at. With the toolbars hidden (full screen, the projector)
     there is nowhere to pick either and no way to set the squares except by
     already holding the Overlay tool, so the menu does it from any tool, on
     either tab. Choosing "Cast from here" brings the Overlay tool up with it,
     on the Play tab where it lives, so the rings and the line are drawn. */
  const openOverlay = () => {
    if (tabRef.current !== 'play') chooseTab('play');
    modeRef.current = 'overlay';
    setMode('overlay');
  };
  const overlayItems = () => {
    if (!hereCell) return [];
    const a = [];
    if (origin) {
      const name = ov ? ov.name : '';
      const shot = ov ? reachBetween({ from: origin, to: hereCell, map: m, ov }) : null;
      a.push({
        key: 'ov-info', disabled: true,
        label: `From ${origin.x},${origin.y}${name ? ` with ${name}` : ''}`
          + (shot ? ` \u00b7 here ${shot.feet} ft, ${shot.band} range${shot.effect ? ` (${shot.effect})` : ''}` : '')
      });
      a.push({ key: 'ov-aim', label: 'Aim at here', icon: 'overlay', run: () => { openOverlay(); setAim(hereCell); } });
    }
    a.push({
      key: 'ov-from', label: origin ? 'Cast from here instead' : 'Cast or fire from here', icon: 'overlay',
      run: () => { openOverlay(); originRef.current = hereCell; setOrigin(hereCell); setAim(null); }
    });
    if (origin && mode !== 'overlay') {
      a.push({ key: 'ov-clear', label: 'Clear the overlay', run: () => { originRef.current = null; setOrigin(null); setAim(null); } });
    }
    return a;
  };
  // The weapon is a group in the Overlay and Measure tools' own menu already;
  // from any other tool it is offered here, so it can be chosen before firing.
  // Spells are searched by name in the bar, not listed.
  const overlayGroups = () => {
    if (!hereCell || mode === 'overlay' || mode === 'measure') return [];
    return [{
      id: 'h-weapon', title: 'Weapon',
      current: ov ? ov.name : '',
      items: [
        radio('none', 'No weapon or spell', !pick, () => { setPick(''); setSpellText(''); }),
        ...ARMED.map((a) => radio(a.key, `${a.label} \u00b7 ${a.kind}`, pick === a.key, () => { setPick(a.key); setSpellText(''); }))
      ]
    }];
  };
  const renderGroup = (g) => (
    <div key={g.id} className="bm-menu-group">
      <button type="button" className="bm-menu-item head" aria-expanded={menuOpen === g.id}
        onClick={() => setMenuOpen(menuOpen === g.id ? null : g.id)}>
        <span className="bm-menu-tick">{menuOpen === g.id ? '\u25BE' : '\u25B8'}</span>
        <span>{g.title}</span>
        <em>{g.current}</em>
      </button>
      {menuOpen === g.id && <div className="bm-menu-list">{g.items.map(menuItem)}</div>}
    </div>
  );
  const menuItem = (i) => (
    <button key={i.key} type="button" disabled={i.disabled}
      role={i.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={i.checked}
      className={'bm-menu-item' + (i.checked ? ' on' : '')} onClick={doMenu(i.run)}>
      {i.icon ? <Icon name={i.icon} size={15} /> : <span className="bm-menu-tick">{i.checked ? '\u2713' : ''}</span>}
      <span>{i.label}</span>
      {i.hint ? <kbd>{i.hint}</kbd> : null}
    </button>
  );

  // Kept on the screen: opened low or at the right edge, it is moved back in.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const w = win || window;
    const r = el.getBoundingClientRect();
    setMenuAt({
      x: Math.max(4, Math.min(menu.x, w.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(menu.y, w.innerHeight - r.height - 4))
    });
    /* The menu is taller than a small or full-screen window can show, and it
       scrolls. A group that has just been unfolded is brought into view, or its
       list would open below the edge with nothing to say it was there. */
    const list = el.querySelector('.bm-menu-list');
    if (list && list.scrollIntoView) list.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, menuOpen]);

  // A click elsewhere, Escape, or leaving the window closes it. The click that
  // dismisses it on the map is not also a click on the map.
  useEffect(() => {
    if (!menu) return undefined;
    const w = win || window;
    const onDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenu(null);
      if (e.button === 0 && stageRef.current && stageRef.current.contains(e.target)) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setMenu(null); } };
    const close = () => setMenu(null);
    w.addEventListener('mousedown', onDown, true);
    w.addEventListener('keydown', onKey);
    w.addEventListener('blur', close);
    w.addEventListener('resize', close);
    return () => {
      w.removeEventListener('mousedown', onDown, true);
      w.removeEventListener('keydown', onKey);
      w.removeEventListener('blur', close);
      w.removeEventListener('resize', close);
    };
  }, [menu, win]);

  const bar = calibrationBar(m, { targetMm: 100 });
  const tool = MODES.find((x) => x.id === mode) || MODES[0];

  return (
    <div className={'bm-bm' + (win ? ' bm-win' : '')} style={{ position: 'relative' }}>
      {!showOptions && (
        <button type="button" className="bm-btn bm-peek" onClick={() => setShowOptions(true)}
          title="Show the map options (H)">Options</button>
      )}
      {showOptions && (<>
      <div className="bm-bar bm-top">
        {/* Build the map, or play it. What is in the rest of this bar, and in
            the right-click menu, follows the tab. */}
        <div className="bm-group bm-tabs" role="tablist" aria-label="Map tabs">
          {[['build', 'Build'], ['play', 'Play']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={'bm-btn bm-mode bm-tab' + (tab === id ? ' on' : '')}
              title={id === 'play'
                ? 'Run the map: click doors to open, close or jam them, click rooms to reveal them'
                : 'Draw the map: tiles, floor, doors, cover, hazards and the starting room'}
              onClick={() => chooseTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'build' && <select value={m.theme}
          onChange={(e) => patch({ theme: e.target.value, customTexture: null })}>
          <optgroup label="Built in">
            {MAP_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </optgroup>
          {customThemes.length > 0 && (
            <optgroup label="My grounds">
              {customThemes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          )}
        </select>}

        {/* Panels, folded away until wanted. */}
        <div className="bm-group" role="group" aria-label="Panels">
          {tab === 'build' && (
            <button type="button"
              className={'bm-btn bm-mode' + (genOpen ? ' on' : '')}
              onClick={() => setGenOpen((v) => !v)}>
              Ground{m.customTexture ? ' · generated' : ''}
            </button>
          )}
          {tab === 'build' && (
            <button type="button"
              className={'bm-btn bm-mode' + (deckOpen ? ' on' : '')}
              onClick={() => setDeckOpen((v) => !v)}>
              Generate
            </button>
          )}
          <IconButton icon="save" label="Save and load maps" on={libOpen} onClick={() => setLibOpen((v) => !v)} />
          {tab === 'build' && <IconButton icon="grid" label="Grid, scale and light" on={gridOpen} onClick={() => setGridOpen((v) => !v)} />}
        </div>

        {/* The tools: one icon each, the name in the tooltip, and the active
            one named in the row of options below. */}
        <div className="bm-group" role="group" aria-label="Tools">
          {toolsOf(tab).map((x) => (
            <IconButton key={x.id} icon={x.icon} label={x.label} on={mode === x.id}
              onClick={() => setMode(x.id)} />
          ))}
        </div>

        <div className="bm-group" role="group" aria-label="View">
          <IconButton icon="pan" label="Pan: drag the map to move it (or hold Space)" on={panOn}
            onClick={() => setPanOn((v) => !v)} />
          <IconButton icon="zoomOut" label="Zoom out" onClick={() => zoomAt(zoomRef.current / 1.25)} />
          {/* Reads its own value, so it needs no tooltip of ours — but it did
              need a name, which it had only for the pointer. */}
          <button type="button" className="bm-ico-btn bm-ico-text"
            title="Back to 100%. Hold Z or the right button and scroll to zoom."
            aria-label={`Zoom ${Math.round(zoom * 100)}%. Click for 100%.`}
            onClick={() => zoomAt(1)}>{Math.round(zoom * 100)}%</button>
          <IconButton icon="zoomIn" label="Zoom in" onClick={() => zoomAt(zoomRef.current * 1.25)} />
          <IconButton icon="fit" label="Fit the grid to the screen" onClick={fitToStage} />
        </div>

        <div className="bm-group" role="group" aria-label="Edit">
          <IconButton icon="undo" label="Undo (Cmd/Ctrl+Z)" onClick={undo}
            disabled={historyRef.current.past.length === 0} />
          <IconButton icon="redo" label="Redo (Shift+Cmd/Ctrl+Z)" onClick={redo}
            disabled={historyRef.current.future.length === 0} />
          {tab === 'build' && <IconButton icon="rotateLeft" label="Turn what is painted 90° anticlockwise (R+Shift+click)" onClick={() => rotateMapBy(-1)} />}
          {tab === 'build' && <IconButton icon="rotateRight" label="Turn what is painted 90° clockwise (R+click)" onClick={() => rotateMapBy(1)} />}
        </div>

        <div className="bm-group" role="group" aria-label="Map">
          <IconButton icon="download" label="Export the map as a PNG" onClick={exportPng} />
          <IconButton icon="trash" label="Clear the map" onClick={clearAll} />
        </div>

        <div className="bm-group" role="group" aria-label="Window">
          <IconButton icon="hide" label="Hide the options for a clean map (H). Right-click the map for a menu." onClick={() => setShowOptions(false)} />
          {win && (<>
            <IconButton icon="full" label={isFull ? 'Leave full screen (F)' : 'Full screen (F)'} on={isFull} onClick={toggleFullscreen} />
            <IconButton icon="present" label="Full screen with the options hidden, for the projector (P)" onClick={present} />
          </>)}
        </div>
        {turnNote ? <span className="bm-hint">{turnNote}</span> : null}
      </div>

      {libOpen && (
        <div className="bm-gen">
          <div className="bm-sechead">
            <h4>Save and load maps</h4>
            <button type="button" className="bm-btn ghost" onClick={() => setLibOpen(false)}>Close</button>
          </div>
          <div className="bm-bar">
            {onSaveDeck && (<>
              <select value={deckTarget} onChange={(e) => { setDeckTarget(e.target.value); setDeckNote(''); }}>
                {/* Written as the character itself: a backslash-u escape in JSX
                    TEXT is not an escape, it is the six characters, and the GM
                    reads the backslash. */}
                <option value="">Save as a new map…</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>Save over: {d.name || 'Untitled map'}</option>
                ))}
              </select>
              {!deckTarget && (
                <input className="bm-field" value={deckName} maxLength={80}
                  placeholder="Name this map"
                  onChange={(e) => setDeckName(e.target.value)} />
              )}
              <button type="button" className="bm-btn" onClick={() => {
                const saved = onSaveDeck({ id: deckTarget || null, name: deckName, map: m });
                if (saved) {
                  setDeckNote(`Saved to “${saved.name}”.`);
                  setDeckTarget(saved.id);
                  setDeckName('');
                }
              }}>Save map</button>
            </>)}
            {/* One picker, two things to do with what it picks. */}
            {(onLoadDeck || onDeleteDeck) && decks.length > 0 && (<>
              <select value={loadId} onChange={(e) => setLoadId(e.target.value)}>
                <option value="">Pick a saved map…</option>
                {decks.map((d) => <option key={d.id} value={d.id}>{d.name || 'Untitled map'}</option>)}
              </select>
              {onLoadDeck && (
                <button type="button" className="bm-btn" disabled={!loadId} onClick={loadChosenDeck}
                  title="Bring a saved map onto the canvas. Undo takes it back.">Load map</button>
              )}
              {onDeleteDeck && (
                <IconButton icon="trash" disabled={!loadId} onClick={deleteChosenDeck}
                  label="Delete the chosen map from the library. This cannot be undone." />
              )}
            </>)}
            {/* The dashboard keeps its own deck row above this map, so the
                library is already in front of the GM and this panel has
                nothing to add. It used to say "open the map from the GM
                dashboard", which is where it was being read. */}
            {!onSaveDeck && !onLoadDeck && !onDeleteDeck && (
              <span className="bm-hint">
                Decks are picked, named, published and deleted in the row above.
              </span>
            )}
            {deckNote ? <span className="bm-hint">{deckNote}</span> : null}
          </div>
        </div>
      )}

      {gridOpen && (
        <div className="bm-gen">
          <div className="bm-sechead">
            <h4>Grid, scale and light</h4>
            <button type="button" className="bm-btn ghost" onClick={() => setGridOpen(false)}>Close</button>
          </div>
          <div className="bm-bar">
            {num('Cols', m.cols, (v) => patch({ cols: v }), MIN_GRID, MAX_GRID)}
            {num('Rows', m.rows, (v) => patch({ rows: v }), MIN_GRID, MAX_GRID)}
            {num('Px / square', m.pxPerSquare, (v) => patch({ pxPerSquare: v }), 10, 200, 2)}
            {num('mm / square', m.mmPerSquare, (v) => patch({ mmPerSquare: v }), 5, 100)}
            {num('Feet / square', m.feetPerSquare, (v) => patch({ feetPerSquare: v }), 1, 50, 5)}
            <label className="bm-num"><span>Light</span>
              <select value={m.lighting} onChange={(e) => patch({ lighting: e.target.value })}
                title={lightingById(m.lighting).effect}>
                {LIGHTING_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="bm-num">
              <span>Zoom %</span>
              {/* Typed, not picked: a GM matching the deck to a projector wants
                  83%, not the nearest of eight. */}
              <input type="number" value={zoomPct}
                min={Math.round(MIN_ZOOM * 100)} max={Math.round(MAX_ZOOM * 100)} step={5}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => {
                  setZoomPct(e.target.value);
                  if (e.target.value.trim() !== '') setZoom(clampZoom(Number(e.target.value) / 100));
                }}
                onBlur={() => setZoomPct(String(Math.round(zoom * 100)))} />
            </label>
            <label className="bm-num"><input type="checkbox" checked={showZones}
              onChange={(e) => setShowZones(e.target.checked)} /><span>Deployment</span></label>
            <label className="bm-num"><input type="checkbox" checked={showCalibration}
              onChange={(e) => setShowCalibration(e.target.checked)} /><span>Calibrate</span></label>
          </div>
          <p className="bm-hint">
            Up to {MAX_GRID}×{MAX_GRID} squares. Squares keep the size the projector was
            calibrated to however big the grid is; zoom out to see it all.
          </p>
        </div>
      )}

      {/* Laying out the deck, beside generating its ground: the two halves of
          "make me somewhere to fight", in one place. */}
      {deckOpen && (
        <div className="bm-gen">
          <div className="bm-sechead">
            <h4>Generate a map</h4>
            <button type="button" className="bm-btn ghost"
              onClick={() => setDeckOpen(false)}>Close</button>
          </div>

          <div className="bm-bar">
            <label className="bm-num">
              <span>Layout</span>
              <select value={genStyle} onChange={(e) => setGenStyle(e.target.value)}>
                {DECK_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="bm-num">
              <span>Seed</span>
              {/* Typed and kept, because this is what makes a generated deck
                  reproducible. Blank rolls a fresh one and shows it. */}
              <input className="bm-field" value={genSeed} maxLength={24}
                placeholder="blank to roll"
                onChange={(e) => setGenSeed(e.target.value)} />
            </label>
            <button type="button" className="bm-btn ghost"
              onClick={() => setGenSeed(newSeed())}>New seed</button>
            {Object.keys(m.floor).length > 0 && (
              <label className="bm-num" title="Keep everything that is painted and build rooms around it. Untick to replace the map.">
                <input type="checkbox" checked={buildAround}
                  onChange={(e) => setBuildAround(e.target.checked)} />
                <span>Build around what is painted</span>
              </label>
            )}
            <button type="button" className="bm-btn" onClick={rollDeck}>
              Generate map
            </button>
          </div>

          {/* Growing a built deck, rather than laying out a new one. Here
              because "make it bigger" and "make me one" are the same
              question asked at different points. */}
          <div className="bm-bar">
            <label className="bm-num">
              <span>Expand to cols</span>
              <input type="number" min={MIN_GRID} max={MAX_GRID} value={growCols}
                onChange={(e) => setGrowCols(e.target.value)} />
            </label>
            <label className="bm-num">
              <span>rows</span>
              <input type="number" min={MIN_GRID} max={MAX_GRID} value={growRows}
                onChange={(e) => setGrowRows(e.target.value)} />
            </label>
            <label className="bm-num">
              <span>How</span>
              <select value={growHow} onChange={(e) => setGrowHow(e.target.value)}>
                <option value="grow">Grow from what is painted</option>
                <option value="repeat">Repeat the map</option>
                <option value="mirror">Repeat, flipped at the seams</option>
              </select>
            </label>
            <button type="button" className="bm-btn" onClick={expandDeck}>
              Expand map
            </button>
          </div>

          <p className="bm-hint">
            {(() => {
              // Said before the button is pressed, because turning one deck
              // into nine is worth being told about first.
              const p = expandPlan(m, growCols, growRows);
              if (p.shrinking) {
                return `${p.cols}×${p.rows} is smaller than this map. `
                  + 'Anything outside the new grid is dropped.';
              }
              if (growHow === 'grow') {
                return `Grows the grid to ${p.cols}×${p.rows} and builds new rooms in the added space, `
                  + 'each joined to your map with a door where they meet, and carrying its ground on. '
                  + 'What is painted does not move. Contacts and fog are untouched.';
              }
              if (p.copies <= 1) return `${p.cols}×${p.rows} holds one copy of this map.`;
              return `${p.across}×${p.down} copies of the current ${m.cols}×${m.rows} map`
                + `${p.partial ? ', the last one cut short' : ''}`
                + `${growHow === 'mirror' ? ', flipped at each seam so the runs meet' : ', repeated as-is'}.`
                + ' Contacts and fog are not copied.';
            })()}
          </p>

          <p className="bm-hint">
            {styleById(genStyle).note} Laid out across the current
            {' '}{m.cols}×{m.rows} grid, with a door wherever a run meets a
            room — so one fog click reveals one room, not the map.
            {Object.keys(m.floor).length > 0 && buildAround
              ? ' Builds around what is painted: nothing there moves.'
              : ' Replaces the floor and the doors; the ground, the calibration and the map\'s name are kept.'}
          </p>
          {deckMsg ? <p className="bm-hint" role="status">{deckMsg}</p> : null}
        </div>
      )}

      {genOpen && (
        <div className="bm-gen">
          <div className="bm-sechead">
            <h4>Ground</h4>
            <button type="button" className="bm-btn ghost"
              onClick={() => {
                setGenOpen(false); setPreview(null); setGenErr(''); closeCrop();
              }}>Close</button>
          </div>

          <div className="bm-bar" role="tablist" aria-label="Ground">
            <button type="button" role="tab" aria-selected={groundTab === 'make'}
              className={'bm-btn bm-mode' + (groundTab === 'make' ? ' on' : '')}
              onClick={() => setGroundTab('make')}>Generate or upload a ground</button>
            <button type="button" role="tab" aria-selected={groundTab === 'terrain'}
              className={'bm-btn bm-mode' + (groundTab === 'terrain' ? ' on' : '')}
              onClick={() => setGroundTab('terrain')}>Procedural terrain</button>
          </div>

          {groundTab === 'make' && (<>
          <label className="bm-field">
            <span className="bm-der-k">The ground itself</span>
            <textarea rows={3} maxLength={MAX_DESCRIBE} value={genDescribe}
              disabled={genBusy}
              placeholder="A flooded crypt floor: black water over cracked flagstone, bones in the gutters"
              onChange={(e) => setGenDescribe(e.target.value)} />
          </label>

          <label className="bm-field">
            <span className="bm-der-k">Terrain and cover on it</span>
            <textarea rows={2} maxLength={MAX_DESCRIBE} value={genCover}
              disabled={genBusy}
              placeholder="Toppled pillars, a smashed altar, scattered bones and barrels"
              onChange={(e) => setGenCover(e.target.value)} />
          </label>

          <div className="bm-bar">
            <select value={genCond} onChange={(e) => setGenCond(e.target.value)} disabled={genBusy}>
              {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {/* The built-in grounds fill the box rather than restricting it:
                a starting point to edit, which beats a blank page. */}
            <select value="" disabled={genBusy}
              onChange={(e) => {
                const env = ENVIRONMENTS.find((x) => x.id === e.target.value);
                if (!env) return;
                setGenDescribe(env.surface);
                setGenCover(env.detail);
              }}>
              <option value="">Start from…</option>
              {ENVIRONMENTS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button type="button" className="bm-btn" onClick={generateGround} disabled={genBusy}>
              {genBusy ? 'Generating…' : preview ? 'Generate again' : 'Generate'}
            </button>
          </div>

          {/* A floor of the GM's own, down the same road as a generated one:
              it lands in the preview below and is saved by the same button. */}
          <div className="bm-bar">
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => {
                uploadGround(e.target.files && e.target.files[0]);
                // Cleared, or picking the same file twice fires nothing.
                e.target.value = '';
              }} />
            <button type="button" className="bm-btn ghost" disabled={genBusy}
              onClick={() => fileRef.current && fileRef.current.click()}>
              Upload a floor…
            </button>
            <label className="bm-num">
              <input type="checkbox" checked={cropSquare} disabled={genBusy}
                onChange={(e) => setCropSquare(e.target.checked)} />
              <span>Crop to square</span>
            </label>
            <span className="bm-hint">
              A floor tiles, so it wants a square. Pick an image and drag it
              under the window to choose which square. Stored at 512×512 to
              match the shipped grounds.
            </span>
          </div>

          {/* THE CROP WINDOW. The picture moves, the window does not: the
              square on screen is exactly the square that gets cut, so there
              is nothing to read off a number or imagine. */}
          {crop && (
            <div className="bm-bar bm-cropbar">
              <div
                className="bm-crop"
                style={{ width: CROP_BOX, height: CROP_BOX }}
                onPointerDown={(e) => {
                  dragRef.current = { x: e.clientX, y: e.clientY };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d) return;
                  const dx = e.clientX - d.x, dy = e.clientY - d.y;
                  dragRef.current = { x: e.clientX, y: e.clientY };
                  setCrop((c) => (c ? { ...c, ...dragBy(c, dx, dy) } : c));
                }}
                onPointerUp={() => { dragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; }}
                // The wheel zooms this small crop preview; the deck itself needs Z or the right button.
                onWheel={(e) => {
                  setCrop((c) => (c
                    ? { ...c, ...zoomTo(c, c.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)) }
                    : c));
                }}
              >
                <img src={crop.url} alt="" draggable={false}
                  style={{
                    width: crop.imgW * crop.scale,
                    height: crop.imgH * crop.scale,
                    transform: `translate(${crop.x}px, ${crop.y}px)`
                  }} />
              </div>

              <div className="bm-cropside">
                <label className="bm-num">
                  <span>Zoom</span>
                  <input type="range" step="any"
                    min={scaleBounds(crop.imgW, crop.imgH, crop.box).min}
                    max={scaleBounds(crop.imgW, crop.imgH, crop.box).max}
                    value={crop.scale}
                    onChange={(e) => setCrop((c) => (c
                      ? { ...c, ...zoomTo(c, Number(e.target.value)) } : c))} />
                </label>
                <span className="bm-hint">
                  {crop.imgW}×{crop.imgH}. Taking {cropRect(crop).size}px
                  from ({cropRect(crop).sx}, {cropRect(crop).sy}).
                </span>
                <div className="bm-bar">
                  <button type="button" className="bm-btn" onClick={commitCrop}
                    disabled={genBusy}>
                    {genBusy ? 'Working…' : 'Use this crop'}
                  </button>
                  <button type="button" className="bm-btn ghost"
                    onClick={() => setCrop((c) => (c ? recentre(c) : c))}
                    disabled={genBusy}>
                    Centre
                  </button>
                  <button type="button" className="bm-btn ghost" onClick={closeCrop}
                    disabled={genBusy}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {uploadNote ? <p className="bm-hint">{uploadNote}</p> : null}
          {genErr ? <p className="bm-warn">{genErr}</p> : null}

          {preview && (<>
            {/* Tiled at a fixed square size, because a floor is judged on
                how it repeats and a single copy hides every seam. */}
            <div className="bm-preview"
              style={{ backgroundImage: `url(${preview.texture})` }} />

            {/* The props that stand on it. Offered rather than automatic: it
                is a second trip to the model, and the first floor generated
                is usually not the one kept. */}
            <div className="bm-bar">
              <button type="button" className="bm-btn" onClick={generateProps}
                disabled={propsBusy || genBusy}
                title="Doors, cover, hazards and foliage built of this ground's own materials, as one sheet">
                {propsBusy ? 'Generating props…'
                  : preview.sprites ? 'Generate the props again' : 'Generate matching props'}
              </button>
              {preview.sprites ? (
                <span className="bm-hint">
                  Sixteen props, saved with this ground and drawn on any map that uses it.
                </span>
              ) : (
                <span className="bm-hint">
                  Optional. Without them a map on this ground draws its doors and cover
                  as plain shapes, the way it always has.
                </span>
              )}
            </div>
            {preview.sprites && (
              <div className="bm-sheet" title="The sixteen props, cut from the generated sheet">
                {SPRITE_SLOTS.map((s) => (
                  <i key={s.role} title={s.name}
                    style={{ backgroundImage: `url(${preview.sprites})`,
                      backgroundPosition: `${(s.slot % 4) * 33.333}% ${Math.floor(s.slot / 4) * 33.333}%` }} />
                ))}
              </div>
            )}

            <div className="bm-bar">
              <label className="bm-num">
                <span>Name it</span>
                <input value={genName} maxLength={60} placeholder="Refinery floor"
                  onChange={(e) => setGenName(e.target.value)} />
              </label>
              <button type="button" className="bm-btn" onClick={saveGround} disabled={genBusy}>
                Save to my grounds
              </button>
              <button type="button" className="bm-btn ghost"
                onClick={() => patch({ customTexture: preview.texture })}>
                Try it on this map
              </button>
              <span className="bm-hint">
                Saving adds it to the ground picker and switches this map to it.
                Its grid and wash are read off the image.
              </span>
            </div>
          </>)}
          </>)}

          {groundTab === 'terrain' && (<>
            <label className="bm-field">
              <span className="bm-der-k">The terrain</span>
              <textarea rows={3} maxLength={400} value={terrainPrompt}
                placeholder="A flooded marsh with dry islands of scrub, a river cutting through it, ruins and rubble, patches of thick smoke"
                onChange={(e) => setTerrainPrompt(e.target.value)} />
            </label>
            <p className="bm-hint">
              {terrainRead.notes.length
                ? terrainRead.notes.join(' ')
                : 'Name grounds (swamp, tundra, forest…), foliage, cover (ruins, barrels, boulders), hazards (fire, lava, poison gas), a river or a road. Words like dense, sparse, wide, small, ragged and neat shape it.'}
            </p>
            <span className="bm-der-k">Grounds to use</span>
            <div className="bm-palette">
              {allGrounds.map((g) => {
                const ticked = terrainPick || [...new Set([m.theme, ...customThemes.map((t) => t.id)])];
                const on = ticked.includes(g.id);
                return (
                  <label key={g.id} className={'bm-chip' + (on ? ' on' : '')} title={g.custom ? 'A ground you saved (generated or uploaded)' : 'Built in'}>
                    <input type="checkbox" checked={on}
                      onChange={() => setTerrainPick(on ? ticked.filter((id) => id !== g.id) : [...ticked, g.id])} />
                    <i style={{ background: g.fallback }} />
                    <span>{g.name}{g.custom ? ' \u2605' : ''}</span>
                  </label>
                );
              })}
            </div>
            <p className="bm-hint">
              Every ground you have saved is here, whether it was generated or uploaded. A ground the
              description names is used even if it is not ticked.
            </p>
            <div className="bm-bar">
              <label className="bm-num"><span>Patches</span>
                <select value={terrainSize} onChange={(e) => setTerrainSize(e.target.value)}>
                  {TERRAIN_SIZES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="bm-num"><span>Where</span>
                <select value={terrainScope} onChange={(e) => setTerrainScope(e.target.value)}>
                  {TERRAIN_SCOPES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="bm-num"><span>Seed</span>
                <input className="bm-field" value={terrainSeed} maxLength={24} placeholder="blank to roll"
                  onChange={(e) => setTerrainSeed(e.target.value)} />
              </label>
              <button type="button" className="bm-btn ghost" onClick={() => setTerrainSeed(newSeed())}>New seed</button>
              <button type="button" className="bm-btn" onClick={generateTerrainNow}>Generate terrain</button>
            </div>
            {terrainNote ? <p className="bm-hint" role="status">{terrainNote}</p> : null}
            <p className="bm-hint">
              Cuts the map into regions the way the map generator cuts rooms, gives each one a ground,
              roughens the edges, then sows foliage, cover and hazards as described. Undo takes it back.
            </p>
          </>)}
        </div>
      )}
      {genErr ? <p className="bm-warn">{genErr}</p> : null}

      <div className="bm-bar bm-opts">
        <strong className="bm-toolname"><Icon name={tool.icon} size={16} /> {tool.label}</strong>
        {mode === 'stamp' && (<>
          <select value={tileId} onChange={(e) => setTileId(e.target.value)}>
            {TILE_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={cat}>
                {TILE_CATALOG.filter((t) => t.category === cat).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.w}×{t.h})</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className="bm-btn"
            onClick={() => setRotation((r) => (r + 90) % 360)}>Rotate {rotation}° (R)</button>
        </>)}

        {(mode === 'paint' || mode === 'erase' || mode === 'ground') && (
          <label className="bm-num">
            <span>Brush</span>
            <select value={String(brush)} onChange={(e) => setBrush(Number(e.target.value))}>
              {[1, 2, 3, 5, 7, 10].map((n) => (
                <option key={n} value={String(n)}>{n}×{n}</option>
              ))}
            </select>
          </label>
        )}

        {/* Which terrain the brush lays down. The deck's own ground is first
            and named as such, because picking it is how paint comes off. */}
        {mode === 'ground' && (<>
          <button type="button" className="bm-btn" onClick={() => { setGroundTab('terrain'); setGenOpen(true); }}
            title="Lay whole regions of terrain at once, from a description, using any ground you have">Procedural terrain…</button>
          <span className="bm-hint">Paints new squares as well as existing ones.</span>
          <label className="bm-num">
            <span>Terrain</span>
            <select value={paintGround} onChange={(e) => setPaintGround(e.target.value)}>
              <option value={m.theme}>
                {`This map's ground (${theme.name}) \u2014 lifts paint off`}
              </option>
              <optgroup label="Built in">
                {MAP_THEMES.filter((t) => t.id !== m.theme).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
              {customThemes.length > 0 && (
                <optgroup label="Saved grounds">
                  {customThemes.filter((t) => t.id !== m.theme).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <span className="bm-hint">
            {(() => {
              const n = Object.keys(m.ground).filter((k) => m.floor[k]).length;
              return n
                ? `${n} square${n === 1 ? '' : 's'} painted, ${groundIds.length} grounds on this map.`
                : 'Paint terrain over the map. Walls, rooms and fog are unaffected \u2014 this is only what a square looks like.';
            })()}
          </span>
        </>)}

        {mode === 'marker' && (
          <select value={markerType} onChange={(e) => setMarkerType(e.target.value)}>
            {MARKER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        {mode === 'door' && (<>
          <select value={doorKind} onChange={(e) => setDoorKind(e.target.value)}>
            {DOOR_KINDS.map((d) => (
              <option key={d.id} value={d.id}>{d.name} · AC {d.ac}</option>
            ))}
          </select>
          <span className="bm-hint">
            Click to fit one, again to cycle {DOOR_STATES.join(' → ')}. A jammed door still blocks.
          </span>
        </>)}

        {mode === 'cover' && (<>
          <select value={coverType} onChange={(e) => setCoverType(e.target.value)}>
            {COVER_TYPES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {coverText(c)} · {c.blocksSight ? 'blocks sight' : 'see over'}
              </option>
            ))}
          </select>
          {/* Only the low barrier: it is the one cover with a direction. The
              rest fill their square, and are already turned by position so a
              run of them is not one stamp repeated. */}
          {coverType === 'low' && (
            <label className="bm-num">
              <span>Lies</span>
              <select value={coverTurn} onChange={(e) => setCoverTurn(Number(e.target.value))}>
                <option value={0}>Across {'—'} horizontal</option>
                <option value={1}>Along {'—'} vertical</option>
              </select>
            </label>
          )}
          <span className="bm-hint">
            {coverType === 'low'
              ? 'Lay it along a corridor or across one. Clicking a barrier the other way round turns it; the same way round lifts it.'
              : (coverById(coverType) || {}).note}
          </span>
        </>)}

        {mode === 'hazard' && (<>
          <select value={hazardType} onChange={(e) => setHazardType(e.target.value)}>
            {HAZARD_TYPES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <span className="bm-hint">{(hazardById(hazardType) || {}).note}</span>
        </>)}

        {mode === 'obscure' && (<>
          <select value={obscureType} onChange={(e) => setObscureType(e.target.value)}>
            {OBSCURING.map((o) => (
              <option key={o.id} value={o.id}>{o.name} {'\u00b7'} sight stops after {o.blocksAfterFt} ft</option>
            ))}
          </select>
          <span className="bm-hint">
            Click to lay it, drag to paint a stand of it, click again to lift. Not cover:
            it blocks the line of sight once it is deep enough, so the ruler and the
            sight overlay both stop at it. Spell areas pass through.
          </span>
        </>)}

        {mode === 'noise' && (<>
          <select value={noiseKind} onChange={(e) => setNoiseKind(e.target.value)}>
            {NOISE.map((n) => <option key={n.id} value={n.id}>{n.name} {'\u00b7'} heard to {n.radiusFt} ft</option>)}
          </select>
          <span className="bm-hint">
            Click where the sound is made. Anything hidden within earshot comes up as a
            ping. Opening a door does this on its own.
          </span>
        </>)}

        {mode === 'contact' && (<>
          {/* A name may be anything; one that matches a monster exactly brings
              its size, and so the squares it covers. */}
          <label className="bm-num"><span>Monster</span>
            <input type="text" list="bm-monsters" value={contactName} maxLength={60}
              placeholder="Type a name…" onChange={(e) => setContactName(e.target.value)} />
          </label>
          <datalist id="bm-monsters">
            {MONSTERS.map((mo) => <option key={mo.name} value={mo.name} label={monsterLabel(mo)} />)}
          </datalist>
          {(() => {
            const mon = monsterByName(contactName);
            return mon ? (
              <span className="bm-hint">
                {monsterLabel(mon)}{mon.ac ? ` · AC ${mon.ac}` : ''}{mon.hp ? ` · ${mon.hp} HP` : ''}
                {` · covers ${footprintSquares(mon.size, m.feetPerSquare)}×${footprintSquares(mon.size, m.feetPerSquare)}`}
              </span>
            ) : null;
          })()}
          <span className="bm-hint">
            Click to place it; click a contact again to cycle unknown → pinged → seen. The
            models still do the fighting.
          </span>
        </>)}

        {mode === 'start' && (<>
          <span className="bm-hint">
            {m.start
              ? `The party starts in the room marked with the flag (${m.start.x}, ${m.start.y}). Click inside another room to move it, or inside this one to take the choice back.`
              : 'Click inside the room the party arrives in. Turning the fog on lights that room, puts the party in it, and leaves everything else dark until a door is opened.'}
          </span>
          {m.start && (
            <button type="button" className="bm-btn" onClick={() => patch({ start: null })}>Clear the start</button>
          )}
        </>)}

        {mode === 'fog' && (<>
          <label className="bm-num">
            <input type="checkbox" checked={m.fog}
              onChange={(e) => patch(e.target.checked
                // Turning fog on over a map with a starting room and nothing
                // explored opens on that room.
                ? (m.start && Object.keys(m.explored).length === 0 ? startPlay(m) : { fog: true })
                : { fog: false })} /><span>Fog of war</span>
          </label>
          {m.start && (
            <button type="button" className="bm-btn"
              title="Light the starting room again and put the party back in it. Doors stay as they are."
              onClick={() => patch(startPlay(m))}>Back to the start</button>
          )}
          <button type="button" className="bm-btn"
            onClick={() => patch({ explored: allExplored() })}>Reveal all</button>
          <button type="button" className="bm-btn"
            onClick={() => patch({ explored: {} })}>Hide all</button>
          {num('Sense ft', senseFt, setSenseFt, 5, 2500, 5)}
          <span className="bm-hint">
            Click a DOOR to change it: closed, then open, then jammed, then closed
            again (right-click a door to set it directly). Opening one lights the
            room beyond; shutting it again hides that room, not the way back, as if
            the party had fallen back and pulled it to. A jammed door blocks like
            a shut one. Click a room to
            reveal it by hand. Ctrl-click takes a place back, drag reveals square by
            square, alt-click reveals line of sight from a square, and shift-click
            is a sense sweep, the way Detect Magic does it — it reads through walls
            and pings contacts without opening the map.
            {m.start ? '' : ' Pick a starting room with the flag tool and turning the fog on opens on it instead of in the dark.'}
          </span>
        </>)}

        {(mode === 'overlay' || mode === 'measure') && (<>
          <select value={pick.startsWith('w:') ? pick : ''}
            onChange={(e) => { setPick(e.target.value); setSpellText(''); }}>
            <option value="">No weapon</option>
            {['melee', 'ranged'].map((kind) => (
              <optgroup key={kind} label={kind === 'melee' ? 'Melee weapons' : 'Ranged weapons'}>
                {ARMED.filter((a) => a.kind === kind).map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* The spells are five hundred names, so they are searched rather
              than listed. Choosing a suggestion fills the box with a name that
              matches exactly, and that is what selects it. */}
          <input type="text" list="bm-spells" placeholder="Spell: type a name…" aria-label="Spell"
            value={spellText}
            onChange={(e) => {
              setSpellText(e.target.value);
              const hit = entryFor(spellKey(e.target.value));
              if (hit) setPick(spellKey(hit.name));
            }} />
          <datalist id="bm-spells">
            {SPELLS.map((sp) => <option key={sp.name} value={sp.name} label={spellLabel(sp)} />)}
          </datalist>
        </>)}

        {mode === 'overlay' && (<>
          <label className="bm-num"><input type="checkbox" checked={showRings}
            onChange={(e) => setShowRings(e.target.checked)} /><span>Range bands</span></label>
          <label className="bm-num"><input type="checkbox" checked={showLos}
            onChange={(e) => setShowLos(e.target.checked)} /><span>Line of sight</span></label>
          <button type="button" className="bm-btn"
            onClick={() => { originRef.current = null; setOrigin(null); setAim(null); }}>Clear overlay</button>
        </>)}
      </div>

      {mode === 'overlay' && (
        <div className="bm-measure">
          {!origin
            ? 'Click the square the attacker or caster is standing in. Click it again to clear.'
            : <>
                <strong>From {origin.x},{origin.y}</strong>
                {ov ? <span> · {ov.name}{ov.isSpell ? (ov.level === 0 ? ' (cantrip)' : ` (level ${ov.level})`) : ''}</span> : null}
                {ov && ov.range ? <span> · range {ov.range}{ov.longRange ? `/${ov.longRange}` : ''} ft</span> : null}
                {ov && !ov.isSpell && !ov.range ? <span> · melee, reach {ov.reach} ft</span> : null}
                {ov && ov.area ? (
                  <span> · {ov.area.size} ft {ov.area.shape}{ov.self ? ' from the caster — click to aim' : ' at the target'}</span>
                ) : null}
                {ov && ov.save ? <span> · {ov.save} save</span> : null}
                {ov && ov.damage ? <span> · {ov.damage}{ov.damageType ? ' ' + ov.damageType : ''}</span> : null}
                {/* The shot the DM is actually about to rule on, so the band and
                    what it does are on screen without switching to Measure. */}
                {overlay && overlay.shot ? (
                  <span>
                    {' · '}{overlay.shot.feet} ft — {overlay.shot.band} range
                    {overlay.shot.effect ? ` (${overlay.shot.effect})` : ''}
                    {overlay.shot.cover ? ` · target in ${overlay.shot.cover.degreeName.toLowerCase()} (+${overlay.shot.cover.ac} AC)` : ''}
                    {overlay.shot.blocked ? (
                      <strong> · blocked by {blockedText(overlay.shot.blocked)}</strong>
                    ) : null}
                  </span>
                ) : null}
              </>}
        </div>
      )}

      {showCalibration && (
        <div className="bm-measure">
          Lay a ruler on the table across the white bar and adjust <strong>px / square</strong> until
          it reads <strong>{bar.mm} mm</strong>. A square is then {m.mmPerSquare} mm on the table
          and {m.feetPerSquare} ft in the fiction.
        </div>
      )}

      {measurement && (
        <div className={'bm-measure' + (measurement.blocked ? ' blocked' : '')}>
          <strong>{measurement.squares} squares · {measurement.feet} ft</strong>
          {ov ? <span> — {measurement.band} range{measurement.effect ? ` (${measurement.effect})` : ''}</span> : null}
          {measurement.cover ? <span> · target in {measurement.cover.degreeName.toLowerCase()} (+{measurement.cover.ac} AC)</span> : null}
          {measurement.blocked && (
            <span> · blocked by {blockedText(measurement.blocked)} at {measurement.blocked.x},{measurement.blocked.y}</span>
          )}
        </div>
      )}

      </>)}

      <div className="bm-stage" ref={stageRef}>
        {/* The wrapper takes the scaled size because a CSS transform does not
            affect layout — without it the stage would not know there was
            anything to scroll to. */}
        <div style={{ width: m.cols * px * zoom, height: m.rows * px * zoom }}>
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => {
            const pos = posFromEvent(e);
            setHover(pos);
            if (spaceRef.current || panOnRef.current || rHeldRef.current) return;   // panning, or turning the map
            if (e.buttons === 1 && (mode === 'paint' || mode === 'erase' || mode === 'ground' || mode === 'obscure')) {
              applyAt(pos, true);
            }
          }}
          onMouseLeave={() => setHover(null)}
          onMouseDown={(e) => {
            // R held: this click turns the map, a quarter turn clockwise, or
            // anticlockwise with Shift, and does nothing else.
            if (e.button === 0 && rHeldRef.current) {
              rUsedRef.current = true;
              rotateMapBy(e.shiftKey ? -1 : 1);
              return;
            }
            if (e.button === 0) applyAt(posFromEvent(e), false, e.shiftKey, e.altKey, e.ctrlKey || e.metaKey);
          }}
          style={{ cursor: mode === 'measure' || mode === 'overlay' ? 'crosshair' : 'pointer' }}
        />
        </div>
      </div>

      {/* Deliberately outside the toolbars' own gate: the map is run with the
          options hidden on a projector, and a question asked there has to be
          answerable without first bringing the toolbars back. */}
      {ask && (
        <div className="bm-askwrap" role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeAsk(false); }}>
          <div className="bm-ask" role="alertdialog" aria-modal="true"
            aria-labelledby="bm-ask-t" aria-describedby="bm-ask-b"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); closeAsk(false); }
              if (e.key === 'Enter') { e.preventDefault(); closeAsk(true); }
            }}>
            <h4 id="bm-ask-t">{ask.title}</h4>
            <p id="bm-ask-b">{ask.body}</p>
            <div className="bm-askrow">
              {/* Autofocused so Enter answers it and Escape dismisses it
                  without the GM reaching for the mouse mid-session. */}
              <button type="button" className="bm-btn" autoFocus
                onClick={() => closeAsk(true)}>{ask.yes || 'Yes'}</button>
              <button type="button" className="bm-btn ghost"
                onClick={() => closeAsk(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {menu && (
        <div className="bm-menu" ref={menuRef} role="menu" aria-label="Map menu"
          style={{ left: menuAt.x, top: menuAt.y }}
          onContextMenu={(e) => e.preventDefault()}>
          <div className="bm-menu-h">Tab</div>
          <div className="bm-menu-tools">
            {[['build', 'Build', 'paint'], ['play', 'Play', 'fog']].map(([id, label, icon]) => (
              <button key={id} type="button" role="menuitemradio" aria-checked={tab === id}
                className={'bm-menu-tool' + (tab === id ? ' on' : '')}
                onClick={doMenu(() => chooseTab(id))}>
                <Icon name={icon} size={16} /><span>{label}</span>
              </button>
            ))}
          </div>
          <div className="bm-menu-h">Tool</div>
          <div className="bm-menu-tools">
            {toolsOf(tab).map((x) => (
              <button key={x.id} type="button" role="menuitemradio" aria-checked={mode === x.id}
                className={'bm-menu-tool' + (mode === x.id ? ' on' : '')}
                onClick={doMenu(() => setMode(x.id))}>
                <Icon name={x.icon} size={16} /><span>{x.label}</span>
              </button>
            ))}
          </div>
          <div className="bm-menu-sep" />
          {menuActions().map(menuItem)}
          {menuGroups().map(renderGroup)}
          {hereCell && (
            <>
              <div className="bm-menu-sep" />
              <div className="bm-menu-h">At this square</div>
              {hereGroups().map(renderGroup)}
              {contactItem() && menuItem(contactItem())}
              {hereHas && menuItem({ key: 'clear-here', label: 'Clear this square', run: clearHere })}
              {m.doors[hereKey] && menuItem({
                key: 'remove-door', label: `Remove the ${m.doors[hereKey].kind === 'trapdoor' ? 'trapdoor' : 'door'}`,
                run: () => { const doors = { ...m.doors }; delete doors[hereKey]; patch({ doors }); }
              })}
              <div className="bm-menu-sep" />
              <div className="bm-menu-h">Overlay</div>
              {overlayItems().map(menuItem)}
              {overlayGroups().map(renderGroup)}
            </>
          )}
          {menuItem({ key: 'fog', label: 'Fog of war', checked: m.fog, run: () => patch({ fog: !m.fog }) })}
          <div className="bm-menu-sep" />
          <div className="bm-menu-icons">
            <IconButton icon="undo" label="Undo" onClick={doMenu(undo)} disabled={historyRef.current.past.length === 0} />
            <IconButton icon="redo" label="Redo" onClick={doMenu(redo)} disabled={historyRef.current.future.length === 0} />
            <IconButton icon="rotateLeft" label="Turn what is painted 90° anticlockwise" onClick={doMenu(() => rotateMapBy(-1))} />
            <IconButton icon="rotateRight" label="Turn what is painted 90° clockwise" onClick={doMenu(() => rotateMapBy(1))} />
            <IconButton icon="pan" label="Pan tool" on={panOn} onClick={doMenu(() => setPanOn((v) => !v))} />
            <IconButton icon="zoomOut" label="Zoom out" onClick={doMenu(() => zoomAt(zoomRef.current / 1.25))} />
            <IconButton icon="zoomIn" label="Zoom in" onClick={doMenu(() => zoomAt(zoomRef.current * 1.25))} />
            <IconButton icon="fit" label="Fit the grid to the screen" onClick={doMenu(fitToStage)} />
          </div>
          <div className="bm-menu-sep" />
          {menuItem({ key: 'opts', label: showOptions ? 'Hide the options' : 'Show the options', hint: 'H', icon: showOptions ? 'hide' : 'show', run: () => setShowOptions((v) => !v) })}
          {win && menuItem({ key: 'full', label: isFull ? 'Leave full screen' : 'Full screen', hint: 'F', icon: 'full', run: toggleFullscreen })}
          {win && menuItem({ key: 'present', label: 'Present', hint: 'P', icon: 'present', run: present })}
        </div>
      )}

    </div>
  );
}
