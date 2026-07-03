# Hydrox Feedback Form

Standalone, client-side prescriber feedback form. The printed form image is the
background; name, feedback text, a photo, and a signature are overlaid, then the
whole thing is composited into a single landscape JPEG entirely in the browser
(no server, no uploads).

This is a self-contained project — it shares nothing with the other apps in the
parent folder.

## Stack

- **Vite + TypeScript** — fast dev server, type safety, small static build.
- **[signature_pad](https://github.com/szimek/signature_pad)** — device-pixel-ratio
  aware, smoothed signature capture. This is what makes the exported signature
  sharp on phones instead of a blurry upscale (the original bug).

## Develop

```bash
npm install
npm run dev      # http://localhost:5190
```

## Build

```bash
npm run build    # type-check + bundle to dist/
npm run preview  # serve the production build
```

## Why the signature is now crisp

The original single-file version sized the signature canvas backing store to CSS
pixels only. On phones (device pixel ratio 2–3) the signature was captured at a
fraction of the real resolution, then stretched ~4× into the 576×160 export box —
blurry and jagged. Here the canvas backing store is scaled by `devicePixelRatio`
(re-applied on resize/orientation change, preserving existing strokes), so the
signature is captured at full physical resolution and downscales cleanly into the
export. See `resizeSignature()` in `src/main.ts`.
