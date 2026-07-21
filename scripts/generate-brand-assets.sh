#!/usr/bin/env bash

set -euo pipefail

readonly project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly icon_master="$project_root/assets/brand/loopweave-icon-master.png"
readonly artwork_master="$project_root/assets/brand/loopweave-artwork-master.png"
readonly brand_font="$project_root/assets/brand/fonts/Inter-Loopweave.ttf"
readonly social_title='LOOPWEAVE'
readonly social_subtitle='AMBIENT AUDIO LOOP MAKER'

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick is required (missing 'magick' command)." >&2
  exit 1
fi

for source_asset in "$icon_master" "$artwork_master" "$brand_font"; do
  if [[ ! -f "$source_asset" ]]; then
    echo "Brand source not found: $source_asset" >&2
    exit 1
  fi
done

readonly artwork_dimensions="$(magick identify -format '%wx%h' "$artwork_master")"
if [[ "$artwork_dimensions" != "1200x630" ]]; then
  echo "Artwork master must be 1200x630; found $artwork_dimensions." >&2
  exit 1
fi

mkdir -p "$project_root/src/assets/brand" "$project_root/public/brand"

render_png() {
  local size="$1"
  local output="$2"

  magick "$icon_master" \
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

magick "$icon_master" \
  -strip \
  -define icon:auto-resize=48,32,16 \
  "$project_root/public/favicon.ico"

magick "$icon_master" \
  -transparent '#090b0f' \
  -trim \
  +repage \
  -filter Lanczos \
  -resize 512x512 \
  -strip \
  -define webp:lossless=true \
  "$project_root/src/assets/brand/loopweave-mark.webp"

magick "$artwork_master" \
  -strip \
  -colorspace sRGB \
  -depth 8 \
  -quality 92 \
  -define webp:method=6 \
  "$project_root/src/assets/brand/loopweave-hero.webp"

magick "$artwork_master" \
  -font "$brand_font" \
  -pointsize 59.5 \
  -kerning 0.875 \
  -fill '#f3f6f6' \
  -annotate +71+304 "$social_title" \
  -pointsize 20 \
  -kerning 4.26 \
  -fill '#64e9c4' \
  -annotate +72+335 "$social_subtitle" \
  -strip \
  -colorspace sRGB \
  -depth 8 \
  -sampling-factor 4:2:0 \
  -interlace Plane \
  -quality 92 \
  "$project_root/public/brand/loopweave-social.jpg"

echo "Generated Loopweave brand assets."
