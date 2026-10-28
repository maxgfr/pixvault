// Tools that assemble several photos into one file (collage, contact sheet,
// side by side, PDF, GIF, sprite sheet), or one photo into several (GIF
// frames, favicon set).

import type { Options } from "../../tools/types.ts";
import { decode, encode, encodePngFast } from "../codecs.ts";
import { canvasOf, contain, cover, fillRect, roundCorners, shortDate, slug } from "../compose/draw.ts";
import { columnLayout, gridLayout, type Layout, mosaicLayout, rowLayout } from "../compose/layout.ts";
import { DecodeError } from "../errors.ts";
import { type Format, FORMATS, sniff } from "../formats.ts";
import { encodeGif } from "../gif.ts";
import { encodeIco } from "../ico.ts";
import { readMeta } from "../meta/read.ts";
import { draw } from "../ops/canvas.ts";
import { canDrawText, renderText } from "../ops/text.ts";
import { opaque, parseColor, raster, type Raster } from "../raster.ts";
import { fitSize, resize } from "../resize.ts";
import { pdfImage } from "./optimize.ts";
import { bool, type Ctx, type Input, num, type Output, type RunFn, type StepFn, str } from "./types.ts";

export const steps: Record<string, StepFn> = {};

type RGBA = [number, number, number, number];

/** Decode every input, shrunk on the way in so a batch of large photos fits in memory. */
async function decodeAll(inputs: Input[], ctx: Ctx, maxSide: number): Promise<Raster[]> {
  const out: Raster[] = [];
  for (const [i, input] of inputs.entries()) {
    ctx.check();
    ctx.progress(i, inputs.length, input.name);
    const r = await decode(input.bytes, input.name);
    const s = fitSize(r.width, r.height, maxSide, maxSide, "inside", false);
    out.push(s.width === r.width && s.height === r.height ? r : await resize(r, s.width, s.height));
  }
  return out;
}

const imageFormat = (v: unknown) => (["jpeg", "png", "webp"].includes(str(v)) ? (str(v) as "jpeg" | "png" | "webp") : "jpeg");

async function asFile(r: Raster, base: string, format: "jpeg" | "png" | "webp", quality = 90): Promise<Output> {
  const f = format === "jpeg" && !opaque(r) ? "png" : format;
  return { name: `${base}.${FORMATS[f].ext}`, bytes: await encode(r, f, { quality }), mime: FORMATS[f].mime };
}

/** Text drawn onto `dst`, when this environment can draw text. Returns the height used. */
function label(dst: Raster, text: string, x: number, y: number, size: number, color: RGBA, align: "left" | "center" = "left", maxWidth?: number, shadow = false): number {
  if (!text || !canDrawText()) return 0;
  const t = renderText(text, { size, color, align, maxWidth, shadow, weight: 500 });
  draw(dst, t, align === "center" ? x - t.width / 2 : x, y);
  return t.height;
}

// ── Collage ────────────────────────────────────────────────────────────────

export function collageLayout(ratios: number[], o: Options): Layout {
  const width = Math.max(200, Math.min(12000, num(o.width, 2400)));
  const gap = Math.round((width * Math.max(0, num(o.gap, 1))) / 100);
  switch (str(o.layout, "mosaic")) {
    case "grid":
      return gridLayout(ratios.length, width, gap, num(o.cols, 0) || undefined);
    case "row":
      return rowLayout(ratios, width, gap);
    case "column":
      return columnLayout(ratios, width, gap);
    default:
      return mosaicLayout(ratios, width, gap);
  }
}

const collage: RunFn = async (inputs, o, ctx) => {
  if (inputs.length < 2) throw new DecodeError("a collage needs at least two photos", "bad-options");
  const width = Math.max(200, Math.min(12000, num(o.width, 2400)));
  const images = await decodeAll(inputs, ctx, width);
  const layout = collageLayout(
    images.map((r) => r.width / r.height),
    o,
  );
  const canvas = canvasOf(layout.width, layout.height, parseColor(str(o.background, "#ffffff")));
  const radius = Math.max(0, num(o.radius, 0)) / 100;
  for (const [i, t] of layout.tiles.entries()) {
    ctx.check();
    let tile = await cover(images[i]!, t.w, t.h);
    if (radius) tile = roundCorners(tile, Math.min(t.w, t.h) * radius);
    draw(canvas, tile, t.x, t.y);
  }
  return { files: [await asFile(canvas, "collage", imageFormat(o.format))], report: { width: layout.width, height: layout.height, count: inputs.length } };
};

// ── Contact sheet ──────────────────────────────────────────────────────────

function labelOf(input: Input, taken: string | undefined, mode: string, index: number): string {
  const date = shortDate(taken);
  const name = input.name;
  const body = mode === "name" ? name : mode === "date" ? date || name : mode === "both" ? (date ? `${name} · ${date}` : name) : "";
  return mode === "none" ? `${index + 1}` : `${index + 1}. ${body}`;
}

const contactSheet: RunFn = async (inputs, o, ctx) => {
  const cols = Math.max(2, Math.min(12, Math.round(num(o.cols, 5))));
  const mode = str(o.labels, "name");
  const title = str(o.title).trim();
  const to = str(o.to, "pdf");
  const metas = await Promise.all(inputs.map((i) => readMeta(i.bytes)));
  const labels = inputs.map((input, i) => labelOf(input, metas[i]!.taken, mode, i));

  if (to === "pdf") {
    const { newPdf, embed, save, helvetica, helveticaBold, fit, winAnsi, rgb, PAGE_SIZES } = await import("../compose/pdf.ts");
    const doc = await newPdf(title || "Contact sheet");
    const font = await helvetica(doc);
    const bold = await helveticaBold(doc);
    const [pw, ph] = PAGE_SIZES.a4;
    const margin = 36;
    const gap = 10;
    const cell = (pw - 2 * margin - (cols - 1) * gap) / cols;
    const labelSize = cols >= 8 ? 5.5 : 7;
    const rowH = cell + labelSize * 2.4;
    const titleH = title ? 28 : 0;
    // Thumbnails at 2× the printed size: sharp on paper and on screens.
    const px = Math.min(1200, Math.round(cell * 2.5));
    let page = doc.addPage([pw, ph]);
    let y = ph - margin;
    const header = () => {
      if (!title) return;
      page.drawText(fit(bold, title, 14, pw - 2 * margin), { x: margin, y: y - 14, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
      y -= titleH;
    };
    header();
    for (let i = 0; i < inputs.length; i += cols) {
      if (y - rowH < margin) {
        page = doc.addPage([pw, ph]);
        y = ph - margin;
        header();
      }
      for (let c = 0; c < cols && i + c < inputs.length; c++) {
        const k = i + c;
        ctx.check();
        ctx.progress(k, inputs.length, inputs[k]!.name);
        const full = await decode(inputs[k]!.bytes, inputs[k]!.name);
        const thumb = await contain(full, px, px, false);
        const img = await embed(doc, await pdfImage(thumb, null, 80, [255, 255, 255]));
        const s = Math.min(cell / thumb.width, cell / thumb.height);
        const w = thumb.width * s;
        const h = thumb.height * s;
        const x = margin + c * (cell + gap);
        page.drawImage(img, { x: x + (cell - w) / 2, y: y - cell + (cell - h) / 2, width: w, height: h });
        if (labels[k]) page.drawText(fit(font, winAnsi(labels[k]!), labelSize, cell), { x, y: y - cell - labelSize * 1.5, size: labelSize, font, color: rgb(0.25, 0.25, 0.25) });
      }
      y -= rowH + gap;
    }
    return { files: [{ name: "contact-sheet.pdf", bytes: await save(doc), mime: "application/pdf" }], report: { pages: doc.getPageCount(), count: inputs.length } };
  }

  // One tall image.
  const width = 2400;
  const margin = 60;
  const gap = 24;
  const cell = Math.floor((width - 2 * margin - (cols - 1) * gap) / cols);
  const text = canDrawText();
  const labelSize = Math.round(cell * 0.075);
  const labelH = text && mode !== "none" ? Math.round(labelSize * 2) : text ? Math.round(labelSize * 1.6) : 0;
  const titleH = text && title ? 110 : 0;
  const rows = Math.ceil(inputs.length / cols);
  const height = margin * 2 + titleH + rows * (cell + labelH) + (rows - 1) * gap;
  const canvas = raster(width, height, [255, 255, 255, 255]);
  if (titleH) label(canvas, title, margin, margin, 56, [26, 26, 26, 255], "left", width - 2 * margin);
  for (const [k, input] of inputs.entries()) {
    ctx.check();
    ctx.progress(k, inputs.length, input.name);
    const thumb = await contain(await decode(input.bytes, input.name), cell, cell, false);
    const x = margin + (k % cols) * (cell + gap);
    const y = margin + titleH + Math.floor(k / cols) * (cell + labelH + gap);
    fillRect(canvas, x, y, cell, cell, [242, 242, 242, 255]);
    draw(canvas, thumb, x + (cell - thumb.width) / 2, y + (cell - thumb.height) / 2);
    if (labelH) label(canvas, labels[k]!, x, y + cell + labelSize * 0.25, labelSize, [64, 64, 64, 255], "left", cell);
  }
  return { files: [await asFile(canvas, "contact-sheet", to === "png" ? "png" : "jpeg", 88)], report: { width, height, count: inputs.length } };
};

// ── Side by side ───────────────────────────────────────────────────────────

const compare: RunFn = async (inputs, o, ctx) => {
  if (inputs.length < 2) throw new DecodeError("pick two photos to compare", "bad-options");
  const [a0, b0] = await decodeAll(inputs.slice(0, 2), ctx, 3000);
  const layout = str(o.layout, "side");
  const bg = parseColor(str(o.background, "#ffffff"));
  const names = str(o.labels, "Before, After")
    .split(",")
    .map((s) => s.trim());
  let canvas: Raster;
  let panels: { x: number; y: number; w: number }[];
  if (layout === "split") {
    const a = a0!;
    const b = await cover(b0!, a.width, a.height);
    canvas = raster(a.width, a.height, bg);
    draw(canvas, a, 0, 0);
    const half = Math.round(a.width / 2);
    const right = { width: a.width - half, height: a.height, data: new Uint8ClampedArray((a.width - half) * a.height * 4) };
    for (let y = 0; y < a.height; y++) right.data.set(b.data.subarray((y * a.width + half) * 4, (y + 1) * a.width * 4), y * right.width * 4);
    draw(canvas, right, half, 0);
    fillRect(canvas, half - Math.max(1, Math.round(a.width / 400)), 0, Math.max(2, Math.round(a.width / 200)), a.height, [255, 255, 255, 255]);
    panels = [
      { x: 0, y: 0, w: half },
      { x: half, y: 0, w: a.width - half },
    ];
  } else if (layout === "stack") {
    const w = Math.min(a0!.width, b0!.width);
    const a = await contain(a0!, w, 100000);
    const b = await contain(b0!, w, 100000);
    const gap = Math.round((w * num(o.gap, 1)) / 100);
    canvas = raster(w, a.height + b.height + gap, bg);
    draw(canvas, a, 0, 0);
    draw(canvas, b, 0, a.height + gap);
    panels = [
      { x: 0, y: 0, w },
      { x: 0, y: a.height + gap, w },
    ];
  } else {
    const h = Math.min(a0!.height, b0!.height);
    const a = await contain(a0!, 100000, h);
    const b = await contain(b0!, 100000, h);
    const gap = Math.round(((a.width + b.width) * num(o.gap, 1)) / 100);
    canvas = raster(a.width + b.width + gap, h, bg);
    draw(canvas, a, 0, 0);
    draw(canvas, b, a.width + gap, 0);
    panels = [
      { x: 0, y: 0, w: a.width },
      { x: a.width + gap, y: 0, w: b.width },
    ];
  }
  const size = Math.max(14, Math.round(Math.min(canvas.width, canvas.height) * 0.04));
  panels.forEach((p, i) => {
    if (names[i]) label(canvas, names[i]!, p.x + size * 0.8, p.y + size * 0.6, size, [255, 255, 255, 255], "left", p.w - size * 1.6, true);
  });
  return { files: [await asFile(canvas, "compare", "jpeg", 90)], report: { width: canvas.width, height: canvas.height } };
};

// ── Photos to PDF ──────────────────────────────────────────────────────────

const toPdf: RunFn = async (inputs, o, ctx) => {
  const { newPdf, embed, save, MM, PAGE_SIZES } = await import("../compose/pdf.ts");
  const doc = await newPdf();
  const pageKind = str(o.page, "fit");
  const margin = Math.max(0, num(o.margin, 10)) * MM;
  const quality = num(o.quality, 85);
  const maxSide = Math.max(300, num(o.maxSide, 2400));
  for (const [i, input] of inputs.entries()) {
    ctx.check();
    ctx.progress(i, inputs.length, input.name);
    const format = sniff(input.bytes, input.name);
    const full = await decode(input.bytes, input.name);
    const s = fitSize(full.width, full.height, maxSide, maxSide, "inside", false);
    const shrunk = s.width !== full.width || s.height !== full.height;
    const r = shrunk ? await resize(full, s.width, s.height) : full;
    const img = await embed(doc, await pdfImage(r, shrunk || !format ? null : { bytes: input.bytes, format: format as Format }, quality, [255, 255, 255]));
    if (pageKind === "a4" || pageKind === "letter") {
      let [pw, ph]: [number, number] = [PAGE_SIZES[pageKind][0], PAGE_SIZES[pageKind][1]];
      if (r.width > r.height) [pw, ph] = [ph, pw];
      const k = Math.min((pw - 2 * margin) / r.width, (ph - 2 * margin) / r.height);
      const page = doc.addPage([pw, ph]);
      page.drawImage(img, { x: (pw - r.width * k) / 2, y: (ph - r.height * k) / 2, width: r.width * k, height: r.height * k });
    } else {
      const page = doc.addPage([r.width, r.height]);
      page.drawImage(img, { x: 0, y: 0, width: r.width, height: r.height });
    }
  }
  return { files: [{ name: inputs.length === 1 ? inputs[0]!.name.replace(/\.[^.]+$/, "") + ".pdf" : "photos.pdf", bytes: await save(doc), mime: "application/pdf" }], report: { pages: doc.getPageCount() } };
};

// ── Animated GIF ───────────────────────────────────────────────────────────

/** The frame order, with the boomerang's way back (without repeating the ends). */
export function frameOrder(n: number, boomerang: boolean): number[] {
  const forward = Array.from({ length: n }, (_, i) => i);
  return boomerang && n > 2 ? [...forward, ...forward.slice(1, -1).reverse()] : forward;
}

const gif: RunFn = async (inputs, o, ctx) => {
  if (inputs.length < 2) throw new DecodeError("an animation needs at least two photos", "bad-options");
  const width = Math.max(32, Math.min(2000, Math.round(num(o.width, 640))));
  const images = await decodeAll(inputs, ctx, width * 2);
  const height = Math.max(1, Math.round((width * images[0]!.height) / images[0]!.width));
  const frames: Raster[] = [];
  for (const r of images) {
    const fitted = await contain(r, width, height);
    const canvas = raster(width, height, [255, 255, 255, 255]);
    draw(canvas, fitted, (width - fitted.width) / 2, (height - fitted.height) / 2);
    frames.push(canvas);
  }
  const delay = Math.max(20, num(o.delay, 500));
  const order = frameOrder(frames.length, bool(o.boomerang));
  const bytes = encodeGif(
    order.map((i) => ({ raster: frames[i]!, delay })),
    { colors: num(o.colors, 256) },
  );
  return { files: [{ name: "animation.gif", bytes, mime: "image/gif" }], report: { frames: order.length, width, height } };
};

// ── GIF frames ─────────────────────────────────────────────────────────────

const frames: RunFn = async (inputs, o, ctx) => {
  const { decodeGifFrames } = await import("../gif.ts");
  const every = Math.max(1, Math.round(num(o.every, 1)));
  const files: Output[] = [];
  for (const [i, input] of inputs.entries()) {
    ctx.progress(i, inputs.length, input.name);
    if (sniff(input.bytes, input.name) !== "gif") throw new DecodeError("this is not a GIF", "unsupported");
    const all = decodeGifFrames(input.bytes);
    const base = input.name.replace(/\.[^.]+$/, "") || "frame";
    const digits = Math.max(3, String(all.length).length);
    for (let k = 0; k < all.length; k += every) {
      ctx.check();
      files.push({ name: `${base}-${String(k + 1).padStart(digits, "0")}.png`, bytes: await encodePngFast(all[k]!.raster), mime: "image/png" });
    }
  }
  return { files, report: { frames: files.length } };
};

// ── Sprite sheet ───────────────────────────────────────────────────────────

const sprite: RunFn = async (inputs, o, ctx) => {
  const images = await decodeAll(inputs, ctx, 4096);
  const n = images.length;
  const cols = Math.max(1, Math.round(num(o.cols, 0) || Math.ceil(Math.sqrt(n))));
  const cell = Math.max(1, Math.round(num(o.cell, 0) || Math.max(...images.map((r) => Math.max(r.width, r.height)))));
  const padding = Math.max(0, Math.round(num(o.padding, 2)));
  const rows = Math.ceil(n / cols);
  const sheet = raster(cols * cell + (cols + 1) * padding, rows * cell + (rows + 1) * padding, [0, 0, 0, 0]);
  const used = new Map<string, number>();
  const css = [".sprite { background-image: url(sprite.png); background-repeat: no-repeat; display: inline-block; }"];
  for (const [i, r0] of images.entries()) {
    const r = r0.width > cell || r0.height > cell ? await contain(r0, cell, cell) : r0;
    const x = padding + (i % cols) * (cell + padding);
    const y = padding + Math.floor(i / cols) * (cell + padding);
    draw(sheet, r, x, y);
    let name = slug(inputs[i]!.name);
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen) name = `${name}-${seen + 1}`;
    css.push(`.sprite-${name} { width: ${r.width}px; height: ${r.height}px; background-position: -${x}px -${y}px; }`);
  }
  return {
    files: [
      { name: "sprite.png", bytes: await encode(sheet, "png"), mime: "image/png" },
      { name: "sprite.css", bytes: new TextEncoder().encode(`${css.join("\n")}\n`), mime: "text/css" },
    ],
    report: { width: sheet.width, height: sheet.height, cols, cell },
  };
};

// ── Favicon set ────────────────────────────────────────────────────────────

/** The square icon: padding inside, optional rounded corners, optional solid background. */
async function iconAt(square: Raster, size: number, padPct: number, radiusPct: number, bg?: RGBA): Promise<Raster> {
  const inner = Math.max(1, Math.round(size * (1 - (2 * padPct) / 100)));
  const art = await resize(square, inner, inner);
  let out = raster(size, size, bg ?? [0, 0, 0, 0]);
  draw(out, art, (size - inner) / 2, (size - inner) / 2);
  if (radiusPct > 0) out = roundCorners(out, (size * radiusPct) / 100);
  return out;
}

const favicon: RunFn = async (inputs, o, ctx) => {
  const files: Output[] = [];
  const padPct = Math.max(0, Math.min(30, num(o.padding, 0)));
  const radiusPct = Math.max(0, Math.min(50, num(o.radius, 0)));
  const bg = parseColor(str(o.background, "#ffffff"));
  const solid: RGBA = [bg[0], bg[1], bg[2], 255];
  const appName = str(o.name).trim() || "App";
  for (const [i, input] of inputs.entries()) {
    ctx.progress(i, inputs.length, input.name);
    const r = await decode(input.bytes, input.name);
    const side = Math.max(r.width, r.height);
    const square = raster(side, side, [0, 0, 0, 0]);
    draw(square, r, (side - r.width) / 2, (side - r.height) / 2);
    const prefix = inputs.length > 1 ? `${slug(input.name)}/` : "";
    const png = async (name: string, icon: Raster) => files.push({ name: prefix + name, bytes: await encode(icon, "png"), mime: "image/png" });
    const icoArt = await iconAt(square, 256, padPct, radiusPct);
    files.push({ name: `${prefix}favicon.ico`, bytes: await encodeIco(icoArt, [48, 32, 16]), mime: "image/x-icon" });
    await png("favicon-16.png", await iconAt(square, 16, padPct, radiusPct));
    await png("favicon-32.png", await iconAt(square, 32, padPct, radiusPct));
    // iOS rounds the corners itself and shows transparency as black: solid, square.
    await png("apple-touch-icon.png", await iconAt(square, 180, Math.max(padPct, 6), 0, solid));
    await png("icon-192.png", await iconAt(square, 192, padPct, radiusPct));
    await png("icon-512.png", await iconAt(square, 512, padPct, radiusPct));
    // Maskable: the platform crops to a circle of 80 %; keep the art inside it.
    await png("icon-maskable-512.png", await iconAt(square, 512, Math.max(padPct, 15), 0, solid));
    const manifest = {
      name: appName,
      short_name: appName,
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      theme_color: str(o.background, "#ffffff"),
      background_color: str(o.background, "#ffffff"),
      display: "standalone",
    };
    files.push({ name: `${prefix}site.webmanifest`, bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), mime: "application/manifest+json" });
    const html = [
      '<link rel="icon" href="/favicon.ico" sizes="48x48">',
      '<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">',
      '<link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<link rel="manifest" href="/site.webmanifest">',
    ].join("\n");
    files.push({ name: `${prefix}favicon.html`, bytes: new TextEncoder().encode(`${html}\n`), mime: "text/html" });
  }
  return { files, report: { files: files.map((f) => f.name) } };
};

export const runs: Record<string, RunFn> = { collage, "contact-sheet": contactSheet, compare, pdf: toPdf, gif, frames, sprite, favicon };
