// High-quality resampling (Lanczos3 by default) with Squoosh's resize wasm,
// premultiplied so transparent edges do not darken, in linear light.

import initResize, { resize as wasmResize } from "@jsquash/resize/lib/resize/pkg/squoosh_resize.js";
import type { Raster } from "./raster.ts";
import { once, wasm } from "./wasm.ts";

export type Method = "triangle" | "catrom" | "mitchell" | "lanczos3";
const METHODS: Method[] = ["triangle", "catrom", "mitchell", "lanczos3"];

const ready = once(async () => initResize(await wasm("resize")));

export async function resize(r: Raster, width: number, height: number, method: Method = "lanczos3", linear = true): Promise<Raster> {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === r.width && height === r.height) return r;
  await ready();
  const out = wasmResize(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), r.width, r.height, width, height, METHODS.indexOf(method), true, linear);
  return { width, height, data: new Uint8ClampedArray(out) };
}

export type Fit = "contain" | "cover" | "fill" | "inside";

/** Target size for a box: contain/inside keep the ratio inside it, cover fills it (then crop), fill stretches. */
export function fitSize(w: number, h: number, boxW: number | undefined, boxH: number | undefined, fit: Fit, enlarge: boolean): { width: number; height: number } {
  const bw = boxW || (boxH ? (w * boxH) / h : w);
  const bh = boxH || (boxW ? (h * boxW) / w : h);
  if (fit === "fill") return { width: Math.round(bw), height: Math.round(bh) };
  const s = fit === "cover" ? Math.max(bw / w, bh / h) : Math.min(bw / w, bh / h);
  const scale = enlarge ? s : Math.min(1, s);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
