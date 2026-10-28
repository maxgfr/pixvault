// Compress and convert: the two tools that are mostly about the encoder.

import type { Options } from "../../tools/types.ts";
import { decode, encode, encodePngFast } from "../codecs.ts";
import { DecodeError } from "../errors.ts";
import { type Format, FORMATS, type OutFormat, rename, sniff } from "../formats.ts";
import { jpegOrientation } from "../meta/jpeg.ts";
import { carryMeta, type MetaMode } from "../meta/carry.ts";
import { readMeta } from "../meta/read.ts";
import type { PhotoMeta } from "../meta/types.ts";
import { keepFormat, writeOutput } from "../output.ts";
import { opaque, type Raster } from "../raster.ts";
import { fitSize, resize } from "../resize.ts";
import { bool, type Ctx, type Input, num, type Output, type RunFn, type RunResult, type StepFn, str } from "./types.ts";

export const steps: Record<string, StepFn> = {};

/** Why a compressed file is what it is, for the interface to explain. */
export type CompressNote =
  /** The result was not smaller: the original is returned untouched. */
  | "kept-original"
  /** Size mode: the original already fits. */
  | "already-fits"
  /** Size mode: the target could only be reached by shrinking the photo. */
  | "downscaled"
  /** Size mode: even the smallest attempt is above the target. */
  | "target-missed"
  /** Lossless mode on a JPEG: it cannot be recompressed without loss, so it is kept. */
  | "lossless-jpeg";

export interface CompressReport {
  name: string;
  before: number;
  after: number;
  format: OutFormat | Format;
  quality?: number;
  width: number;
  height: number;
  /** The output is the input, byte for byte. */
  kept: boolean;
  note?: CompressNote;
}

export interface ConvertReport {
  name: string;
  before: number;
  after: number;
  from: Format;
  to: string;
  width: number;
  height: number;
}

const LOSSY = new Set<OutFormat>(["jpeg", "webp", "avif", "jxl"]);

/** One slider for every encoder: AVIF's scale runs lower for the same look. */
export function qualityFor(format: OutFormat, q: number): number {
  return format === "avif" ? Math.max(1, Math.round(q * 0.78)) : q;
}

interface Attempt {
  bytes: Uint8Array;
  format: OutFormat;
  quality?: number;
  raster: Raster;
}

async function attempt(r: Raster, format: OutFormat, q: number | undefined, o: { effort: number; colors?: number; lossless?: boolean }): Promise<Attempt> {
  const bytes = await encode(r, format, {
    quality: q === undefined ? undefined : qualityFor(format, q),
    effort: o.effort,
    colors: o.colors,
    lossless: o.lossless,
  });
  return { bytes, format, quality: q, raster: r };
}

/** The highest quality whose file fits `target` bytes, by bisection (≤ 7 encodes); null when even q=5 is too big. */
async function fitQuality(r: Raster, format: OutFormat, target: number, effort: number): Promise<Attempt | null> {
  let lo = 5;
  let hi = 95;
  let best: Attempt | null = null;
  const floor = await attempt(r, format, lo, { effort });
  if (floor.bytes.length > target) return null;
  best = floor;
  while (hi - lo > 2) {
    const mid = Math.round((lo + hi) / 2);
    const a = await attempt(r, format, mid, { effort });
    if (a.bytes.length <= target) {
      best = a;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

/** PNG under a size: full colour, then fewer palette colours. */
async function fitPng(r: Raster, target: number, effort: number): Promise<Attempt | null> {
  for (const colors of [0, 256, 128, 64, 32, 16]) {
    const a = await attempt(r, "png", undefined, { effort, colors: colors || undefined });
    if (a.bytes.length <= target) return a;
  }
  return null;
}

async function fitSizeTarget(r: Raster, format: OutFormat, target: number, effort: number): Promise<{ a: Attempt; note?: CompressNote }> {
  let cur = r;
  for (let round = 0; round < 4; round++) {
    const a = format === "png" ? await fitPng(cur, target, effort) : LOSSY.has(format) ? await fitQuality(cur, format, target, effort) : null;
    if (a) return { a, note: round ? "downscaled" : undefined };
    // Shrink by the square root of the size ratio (file size ~ pixel count), a little more for safety.
    const probe = format === "png" ? await attempt(cur, "png", undefined, { effort, colors: 16 }) : await attempt(cur, format, 5, { effort });
    const scale = Math.max(0.2, Math.min(0.9, Math.sqrt(target / probe.bytes.length) * 0.92));
    cur = await resize(cur, cur.width * scale, cur.height * scale);
  }
  const last = format === "png" ? await attempt(cur, "png", undefined, { effort, colors: 16 }) : await attempt(cur, format, 5, { effort });
  return { a: last, note: "target-missed" };
}

function candidatesFor(asked: string, source: Format, r: Raster, lossless: boolean): OutFormat[] {
  if (asked === "auto") {
    if (lossless) return ["png", "webp", "jxl"];
    const alpha = !opaque(r);
    return alpha ? ["webp", "avif", "png"] : ["webp", "avif", "jpeg"];
  }
  if (asked === "keep") return [keepFormat(source, r)];
  return [asked as OutFormat];
}

async function compressOne(input: Input, o: Options): Promise<{ file: Output; report: CompressReport }> {
  const source = sniff(input.bytes, input.name);
  if (!source) throw new DecodeError("this is not an image format pixvault reads", "unsupported");
  const meta = await readMeta(input.bytes);
  const mode = str(o.mode, "quality");
  const effort = Math.max(0, Math.min(9, num(o.effort, 4)));
  const colors = num(o.colors, 0);
  const metaMode = (str(o.metadata, "no-gps") || "no-gps") as MetaMode;
  let r = await decode(input.bytes, input.name);
  const maxSide = num(o.maxSide, 0);
  let resized = false;
  if (maxSide > 0 && Math.max(r.width, r.height) > maxSide) {
    const s = fitSize(r.width, r.height, maxSide, maxSide, "inside", false);
    r = await resize(r, s.width, s.height);
    resized = true;
  }
  const asked = str(o.format, "keep");
  const lossless = mode === "lossless";
  const formats = candidatesFor(asked, source, r, lossless);
  const target = Math.max(1, num(o.targetKb, 300)) * 1024;

  const keep = (note: CompressNote): { file: Output; report: CompressReport } => ({
    file: { name: input.name, bytes: input.bytes, mime: FORMATS[source].mime },
    report: { name: input.name, before: input.bytes.length, after: input.bytes.length, format: source, width: r.width, height: r.height, kept: true, note },
  });

  // A JPEG cannot be made smaller without loss here.
  if (lossless && formats.length === 1 && formats[0] === "jpeg" && source === "jpeg" && !resized) return keep("lossless-jpeg");
  if (mode === "size" && !resized && input.bytes.length <= target && formats.length === 1 && formats[0] === source) return keep("already-fits");

  let best: Attempt | null = null;
  let note: CompressNote | undefined;
  for (const f of formats) {
    let a: Attempt;
    let n: CompressNote | undefined;
    if (lossless) a = f === "jpeg" ? await attempt(r, "jpeg", 98, { effort }) : await attempt(r, f, undefined, { effort, lossless: true });
    else if (mode === "size") ({ a, note: n } = await fitSizeTarget(r, f, target, effort));
    else a = await attempt(r, f, LOSSY.has(f) ? num(o.quality, 78) : undefined, { effort, colors: f === "png" && colors >= 2 ? colors : undefined });
    if (!best || a.bytes.length < best.bytes.length) {
      best = a;
      note = n;
    }
  }
  if (!best) throw new DecodeError("nothing to encode", "bad-options");
  // Never larger: the same format, the same pixels, and no gain → the original, untouched.
  if (!resized && best.format === source && best.bytes.length >= input.bytes.length) return keep("kept-original");
  const bytes = await carryMeta(best.bytes, best.format, input.bytes, source, meta, metaMode);
  return {
    file: { name: rename(input.name, FORMATS[best.format].ext), bytes, mime: FORMATS[best.format].mime },
    report: { name: input.name, before: input.bytes.length, after: bytes.length, format: best.format, quality: best.quality, width: best.raster.width, height: best.raster.height, kept: false, note },
  };
}

async function eachFile<R>(inputs: Input[], ctx: Ctx, fn: (i: Input) => Promise<{ file: Output | Output[]; report: R }>): Promise<RunResult> {
  const files: Output[] = [];
  const reports: R[] = [];
  for (const [i, input] of inputs.entries()) {
    ctx.check();
    ctx.progress(i, inputs.length, input.name);
    const r = await fn(input);
    files.push(...(Array.isArray(r.file) ? r.file : [r.file]));
    reports.push(r.report);
  }
  return { files, report: reports };
}

const compress: RunFn = (inputs, o, ctx) => eachFile(inputs, ctx, (i) => compressOne(i, o));

/** A one-page PDF of a photo, at its pixel size (1 px = 1 pt). */
export async function photoPdf(r: Raster, original: { bytes: Uint8Array; format: Format } | null, quality: number, background: [number, number, number]): Promise<Uint8Array> {
  const { newPdf, embed, save } = await import("../compose/pdf.ts");
  const doc = await newPdf();
  const img = await pdfImage(r, original, quality, background);
  const page = doc.addPage([r.width, r.height]);
  page.drawImage(await embed(doc, img), { x: 0, y: 0, width: r.width, height: r.height });
  return save(doc);
}

/**
 * The image bytes to put in a PDF: the original JPEG when it can go in as
 * is (upright, same size: no recompression), else JPEG for opaque photos and
 * PNG when there is transparency.
 */
export async function pdfImage(r: Raster, original: { bytes: Uint8Array; format: Format } | null, quality: number, background: [number, number, number]): Promise<{ bytes: Uint8Array; kind: "jpeg" | "png" }> {
  if (original?.format === "jpeg" && jpegOrientation(original.bytes) === 1) return { bytes: original.bytes, kind: "jpeg" };
  if (!opaque(r)) return { bytes: await encodePngFast(r), kind: "png" };
  return { bytes: await encode(r, "jpeg", { quality, background, progressive: false }), kind: "jpeg" };
}

const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

async function convertOne(input: Input, o: Options): Promise<{ file: Output; report: ConvertReport }> {
  const from = sniff(input.bytes, input.name);
  if (!from) throw new DecodeError("this is not an image format pixvault reads", "unsupported");
  const to = str(o.to, "jpeg");
  const r = await decode(input.bytes, input.name);
  let file: Output;
  if (to === "pdf") {
    const bytes = await photoPdf(r, { bytes: input.bytes, format: from }, num(o.quality, 88), hexRgb(str(o.background, "#ffffff")));
    file = { name: rename(input.name, "pdf"), bytes, mime: "application/pdf" };
  } else {
    const meta: PhotoMeta = await readMeta(input.bytes);
    file = await writeOutput(r, { ...o, format: to }, { name: input.name, bytes: input.bytes, format: from, meta }, { lossless: bool(o.lossless) });
  }
  return { file, report: { name: input.name, before: input.bytes.length, after: file.bytes.length, from, to, width: r.width, height: r.height } };
}

const convert: RunFn = (inputs, o, ctx) => eachFile(inputs, ctx, (i) => convertOne(i, o));

export const runs: Record<string, RunFn> = { compress, convert };
