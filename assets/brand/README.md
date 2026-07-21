# Loopweave brand assets

This directory contains the canonical, non-runtime source artwork for the
Loopweave brand:

- `loopweave-icon-master.png` is the source for the app mark and icons.
- `loopweave-artwork-master.png` is the source for the in-app hero and the social
  card background.
- `fonts/Inter-Loopweave.ttf` is a pinned Inter subset used to render the social
  card typography consistently on every machine.

Regenerate every runtime and public brand asset with ImageMagick:

```sh
pnpm brand:assets
```

The command writes these committed derivatives:

- `src/assets/brand/loopweave-mark.webp`
- `src/assets/brand/loopweave-hero.webp`
- `public/favicon.ico`
- `public/favicon-16.png`
- `public/favicon-32.png`
- `public/apple-touch-icon.png`
- `public/brand/loopweave-icon-192.png`
- `public/brand/loopweave-icon-512.png`
- `public/brand/loopweave-social.jpg`

Files under `src/assets/brand` are imported by the application and fingerprinted
by Vite. Files under `public` require stable external URLs and are copied as-is.
Do not edit generated derivatives independently.

The fixed palette is near-black `#090b0f`, mint `#64e9c4`, and violet
`#9b71ff`. The artwork master must remain 1200 by 630 pixels. The generator uses
it directly for the textless app hero, then adds the approved left-aligned title
and subtitle treatment when producing the social card.
