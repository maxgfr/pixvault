// A fast, reduced-size rendering of what a chain of steps does to a photo,
// for the live before/after preview.

import type { Options } from "../../tools/types.ts";
import { decode, decodeScaled, encode } from "../codecs.ts";
import { sniff } from "../formats.ts";
import { readMeta } from "../meta/read.ts";
import { clone, opaque, type Raster } from "../raster.ts";
import { fitSize, resize } from "../resize.ts";
import type { RecipeStep } from "./index.ts";
import { STEPS } from "./index.ts";
import type { Ctx, Input, Output } from "./types.ts";

interface Prepared {
  r: Raster;
  meta: Awaited<ReturnType<typeof readMeta>>;
  format: ReturnType<typeof sniff> & string;
  before: Output;
  width: number;
  height: number;
}

/**
 * The reduced photo, kept between slider moves: decoding a 24 MP photo or a
 * HEIC takes most of a second, applying a step to its preview a few ms.
 * Keyed by the page (photo id, size, preview size); the last few are kept.
 */
const prepared = new Map<string, Prepared>();
const KEEP = 3;

export const isPrepared = (key: string) => prepared.has(key);

/** The photo reduced to `maxSide`: decoded at that size by the browser when it can, else decoded whole and resized. */
export async function reduced(input: Input, maxSide: number, quality: ResizeQuality = "high"): Promise<{ r: Raster; width: number; height: number }> {
  const scaled = await decodeScaled(input.bytes, input.name, maxSide, quality);
  if (scaled) return { r: scaled.raster, width: scaled.width, height: scaled.height };
  const full = await decode(input.bytes, input.name);
  const { width, height } = fitSize(full.width, full.height, maxSide, maxSide, "inside", false);
  return { r: await resize(full, width, height, "triangle"), width: full.width, height: full.height };
}

/** A workspace thumbnail and the photo's real (upright) size. */
export async function thumbnail(input: Input, maxSide: number): Promise<{ before: Output; width: number; height: number }> {
  const { r, width, height } = await reduced(input, maxSide, "medium");
  return { before: await toFile(r), width, height };
}

async function prepare(input: Input, maxSide: number, key?: string): Promise<Prepared> {
  const hit = key ? prepared.get(key) : undefined;
  if (hit) return hit;
  const format = (sniff(input.bytes, input.name) ?? "png") as Prepared["format"];
  const [meta, { r, width, height }] = await Promise.all([readMeta(input.bytes), reduced(input, maxSide)]);
  const p: Prepared = { r, meta, format, before: await toFile(r), width, height };
  if (key) {
    prepared.set(key, p);
    while (prepared.size > KEEP) prepared.delete(prepared.keys().next().value!);
  }
  return p;
}

const copy = (o: Output): Output => ({ ...o, bytes: o.bytes.slice() });

export async function preview(input: Input, steps: RecipeStep[], maxSide: number, ctx: Ctx, beforeOnly = false, key?: string): Promise<{ before: Output; after: Output; width: number; height: number }> {
  const p = await prepare(input, maxSide, key);
  // The page receives copies: the cached file must survive the transfer.
  const before = copy(p.before);
  if (beforeOnly) return { before, after: copy(p.before), width: p.width, height: p.height };
  // A copy: a step that works in place must not change the cached photo.
  let r: Raster = clone(p.r);
  for (const s of steps) {
    const fn = STEPS[s.tool];
    if (fn) r = await fn(r, s.options as Options, { ...ctx, name: input.name, format: p.format, meta: p.meta });
  }
  return { before, after: await toFile(r), width: p.width, height: p.height };
}

/** The browser's own encoder when the worker has a canvas (much faster than wasm for a preview), else ours. */
async function toFile(r: Raster): Promise<Output> {
  const alpha = !opaque(r);
  if (typeof OffscreenCanvas === "function") {
    try {
      const canvas = new OffscreenCanvas(r.width, r.height);
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      const blob = await canvas.convertToBlob(alpha ? { type: "image/webp", quality: 0.85 } : { type: "image/jpeg", quality: 0.85 });
      return { name: `preview.${blob.type.split("/")[1]}`, bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
    } catch {
      // Fall through to the wasm encoders.
    }
  }
  const bytes = await encode(r, alpha ? "webp" : "jpeg", { quality: 82, effort: 1 });
  return { name: alpha ? "preview.webp" : "preview.jpg", bytes, mime: alpha ? "image/webp" : "image/jpeg" };
}
