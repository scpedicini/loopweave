#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
master="$project_root/src/assets/brand/loopweave-icon-master.png"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick is required (missing 'magick' command)." >&2
  exit 1
fi

if [[ ! -f "$master" ]]; then
  echo "Icon master not found: $master" >&2
  exit 1
fi

render_png() {
  local size="$1"
  local output="$2"

  magick "$master" \
    -filter Lanczos \
    -resize "${size}x${size}" \
    -strip \
    -define png:color-type=2 \
    -define png:compression-level=9 \
    "$output"
}

render_png 16 "$project_root/public/favicon-16.png"
render_png 32 "$project_root/public/favicon-32.png"
render_png 180 "$project_root/public/apple-touch-icon.png"
render_png 192 "$project_root/public/brand/loopweave-icon-192.png"
render_png 512 "$project_root/public/brand/loopweave-icon-512.png"

magick "$master" \
  -strip \
  -define icon:auto-resize=48,32,16 \
  "$project_root/public/favicon.ico"

magick "$master" \
  -transparent '#090b0f' \
  -trim \
  +repage \
  -filter Lanczos \
  -resize 512x512 \
  -strip \
  -define webp:lossless=true \
  "$project_root/src/assets/brand/loopweave-mark.webp"
