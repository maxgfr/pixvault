// A fast, reduced-size rendering of what a chain of steps does to a photo,
// for the live before/after preview.

import type { Options } from "../../tools/types.ts";
import { decode, encode } from "../codecs.ts";
import { sniff } from "../formats.ts";
import { readMeta } from "../meta/read.ts";
import { opaque, type Raster } from "../raster.ts";
import { fitSize, resize } from "../resize.ts";
import type { RecipeStep } from "./index.ts";
import { STEPS } from "./index.ts";
import type { Ctx, Input, Output } from "./types.ts";

export async function preview(input: Input, steps: RecipeStep[], maxSide: number, ctx: Ctx, beforeOnly = false): Promise<{ before: Output; after: Output }> {
  const format = sniff(input.bytes, input.name) ?? "png";
  const meta = await readMeta(input.bytes);
  const full = await decode(input.bytes, input.name);
  const { width, height } = fitSize(full.width, full.height, maxSide, maxSide, "inside", false);
  let r: Raster = await resize(full, width, height, "triangle");
  const before = await toFile(r);
  if (beforeOnly) return { before, after: before };
  for (const s of steps) {
    const fn = STEPS[s.tool];
    if (fn) r = await fn(r, s.options as Options, { ...ctx, name: input.name, format, meta });
  }
  return { before, after: await toFile(r) };
}

async function toFile(r: Raster): Promise<Output> {
  const alpha = !opaque(r);
  const bytes = await encode(r, alpha ? "webp" : "jpeg", { quality: 82, effort: 1 });
  return { name: alpha ? "preview.webp" : "preview.jpg", bytes, mime: alpha ? "image/webp" : "image/jpeg" };
}
