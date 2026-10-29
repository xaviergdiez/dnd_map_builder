#!/bin/bash
# Install a generated image as a battle-map floor texture.
#
#   scripts/add-map-texture.sh <image> <theme-id> [crop-bottom-px]
#
# e.g. scripts/add-map-texture.sh ~/Downloads/textures/jungle.png jungle 0
#      scripts/add-map-texture.sh ~/Downloads/raw.png tau_station 94
#
# Uses sips, which ships with macOS, so there is nothing to install. The
# third argument trims pixels off the BOTTOM before resampling, which is
# where generators put their watermark — tiled, one watermark becomes a grid
# of them, and it is the first thing anyone notices on a projector.
#
# Everything here is deliberately lossy in one direction only: the source
# image is never touched, so a bad crop is re-run, not recovered.
set -euo pipefail

SRC=${1:-}
ID=${2:-}
CROP=${3:-0}
SIZE=1024          # see TEXTURES.md: the tile covers a whole canvas at this
QUALITY=85         # ~300-480KB, in line with every other deck in the set

if [ -z "$SRC" ] || [ -z "$ID" ]; then
  echo "usage: $0 <image> <theme-id> [crop-bottom-px]" >&2
  exit 2
fi
if [ ! -f "$SRC" ]; then
  echo "no such image: $SRC" >&2
  exit 1
fi
case "$ID" in
  *[!a-z0-9_]*) echo "theme id must be lower-case letters, digits and _: $ID" >&2; exit 2 ;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/public/maps/$ID.jpg"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

W=$(sips -g pixelWidth  "$SRC" | tail -1 | tr -dc 0-9)
H=$(sips -g pixelHeight "$SRC" | tail -1 | tr -dc 0-9)
echo "source: ${W}x${H}"

STAGE="$SRC"
if [ "$CROP" -gt 0 ]; then
  sips -c "$((H - CROP))" "$W" --cropOffset 0 0 "$SRC" --out "$TMP/crop.png" >/dev/null
  STAGE="$TMP/crop.png"
  echo "cropped ${CROP}px off the bottom"
fi

sips -Z "$SIZE" -s format jpeg -s formatOptions "$QUALITY" "$STAGE" --out "$OUT" >/dev/null

BYTES=$(stat -f %z "$OUT")
echo "wrote $OUT  ($((BYTES / 1024))KB)"
if [ "$BYTES" -gt 900000 ]; then
  echo "WARNING: over 900KB. battlemap.check.mjs will fail — lower QUALITY." >&2
fi
echo
echo "Now add the theme in src/battlemap.js (see TEXTURES.md for picking the"
echo "colours), then: node src/battlemap.check.mjs"
