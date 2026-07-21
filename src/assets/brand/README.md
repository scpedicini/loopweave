# Loopweave icon assets

`loopweave-icon-master.png` is the only source image for the Loopweave icon.
The favicon, Apple touch icon, PWA icons, and in-app WebP mark are generated from
that master with ImageMagick:

```sh
pnpm brand:icons
```

Do not edit the derived icon files independently.

The fixed palette is near-black `#090b0f`, mint `#64e9c4`, and violet
`#9b71ff`. The hero and social-card artwork are separate editorial assets, not
icon sources.
