# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyone who has photos to process and would rather not hand them to a website: people converting iPhone HEIC photos, shrinking pictures for an email or a form, removing the location before sharing; and professionals working in batches — web developers (WebP/AVIF, favicons, sprites), photographers (watermarks, contact sheets, metadata), e-commerce and community managers (background removal, social-media sizes, consistent crops). They usually arrive with a task and a handful to a few hundred files, on a laptop or a phone.

## Product Purpose

pixvault is a photo toolbox that runs entirely in the browser: drop one or many photos, then compress, convert, resize, crop, adjust, watermark, clean metadata, combine, analyse, or edit them with AI models running on the device. Success is the job done in a few clicks, the files saved, and nothing ever uploaded.

## Positioning

Private and all-in-one. Every operation — including AI background removal, upscaling and face blurring — happens on the user's device; a strict Content Security Policy and a CI gate prove the shipped site cannot reach another origin. And it is everything in one place, batch-first, instead of one website per task (Squoosh, TinyPNG, iLoveIMG, remove.bg, EXIF removers). Sibling of maxgfr/pdfvault (the same promise for PDFs).

## Operating Context

Static site on GitHub Pages (maxgfr.github.io/pixvault), installable PWA that works offline, can receive photos shared from a phone's share sheet and files opened from the OS. Files live in memory for the session; nothing is stored unless the user downloads, saves to a folder or shares. Typical inputs: iPhone HEIC, camera JPEG and RAW (embedded preview), screenshots PNG, web formats WebP/AVIF/JPEG XL, GIF, TIFF, SVG.

## Capabilities and Constraints

- Front-only: Bun build, React 19, hand-written CSS, codecs in WebAssembly (MozJPEG, OxiPNG, libwebp, libavif, libjxl, libheif), Web Workers pool.
- No third-party requests: no CDN, no analytics, no web fonts from elsewhere. Large AI models download only after explicit consent; optional "bring your own API key" AI is the only network call the user can enable.
- Bilingual interface, English and French, following the browser with a manual switch.
- Batch is the default: every per-photo tool applies to the whole selection; pixel tools chain into recipes.
- Compression never returns a larger file.
- RAW is handled through the camera's embedded full-size preview, not demosaicing.

## Brand Commitments

- Name: pixvault, lowercase.
- Voice: sober, factual, concrete, like pdfvault — say what happens to the file, never hype.
- Must have its own identity, distinct from pdfvault's "paper, ink, teal".

## Evidence on Hand

No testimonials, users, benchmarks or press. Do not invent any. Verifiable facts only: open source (MIT), the CSP, the no-network CI gate, the list of codecs and models with their licences.

## Product Principles

1. Nothing leaves the device unless the user explicitly asks — and that is provable.
2. The photos are the interface: what you dropped stays visible, and results are shown, not described.
3. Batch first: one choice applies to all selected photos.
4. Safe by default: originals are kept until replaced on purpose; the location is not carried into new files unless asked.
5. Plain words in both languages; advanced settings stay folded until needed.

## Accessibility & Inclusion

WCAG 2.2 AA: full keyboard use (drop zone, selection, sliders, editors), visible focus, labels on every control, live-region progress, reduced motion respected, touch targets for phone use.
