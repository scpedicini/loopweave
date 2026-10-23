# Loopweave

Loopweave is a browser-first audio texture tool that finds, renders, auditions, and exports perceptually promising loops from an arbitrary recording. Audio decoding and every analysis step happens entirely clientside. These audio files can be used for ambience, ASMR, and other loopable content. Trying belching or vomiting on your mic to find the perfect ASMR quiet-time loop for those midnight marathon study sessions.

Loopweave is also fully deployed and ready to use at [loopweave.specr.net](https://loopweave.specr.net). No installation or local build is required.

## Demo

https://github.com/user-attachments/assets/6ddda0eb-7c39-4557-8cbb-76c7fddcb81a

## Current vertical slice

- Drag-and-drop browser decoding for locally supported audio formats.
- Worker-owned PCM and DSP so long analysis does not block the interface.
- Multiresolution spectral features and content-regime estimation.
- Bounded recurrence search without a dense self-similarity matrix.
- Joint endpoint refinement and hard-cut/crossfade selection.
- Correlation-aware, equal-power, and linear circular overlap rendering.
- Multiple ranked alternatives, diagnostics, and an explicit confidence verdict.
- Persistent loop-length constraints with a per-file source-maximum shortcut.
- Original-source playback and waveform playheads for source and loop previews.
- Full-loop and focused seam auditioning, plus baked 24-bit WAV export.

## Commands

```sh
pnpm install
pnpm dev
pnpm brand:assets
pnpm test
pnpm check
pnpm quality
```

The development server uses port `6772`. `pnpm build` produces a static `dist/` deployment.
Canonical artwork and the generated-file mapping are documented in
[`assets/brand/README.md`](./assets/brand/README.md).

## Browser constraints

While the application technically works on mobile, `decodeAudioData()` decodes a complete file into memory. Stereo 48 kHz float PCM costs roughly 22 MiB per minute before temporary buffers. That means there's a high probability of it turning into a mountain of bountiful butts if you insist on using it on your Nokia N-Gage. The current application is therefore desktop-first. 

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the component boundaries and backend path.
