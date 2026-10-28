// Background removal: an alpha matte from BiRefNet lite (WebGPU with
// half-precision shaders and 11 storage buffers per shader) or MODNet
// (everywhere else), then the subject on transparency, a colour or a
// blurred copy of the photo.

import { parseColor, raster, type Raster } from "../raster.ts";
import { gaussianBlur } from "../ops/blur.ts";
import { resize } from "../resize.ts";
import { backgroundModel } from "../../ai/catalog.ts";
import { gpuSupport, ort, session, toCHW } from "./runtime.ts";

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The matte as an 8-bit alpha plane at the photo's size (255 = subject). */
export async function matte(r: Raster, prefer?: "background" | "background-lite"): Promise<Uint8ClampedArray> {
  const o = await ort();
  const id = prefer ?? backgroundModel(await gpuSupport());
  const s = await session(id);
  let w: number;
  let h: number;
  let input: Float32Array;
  if (id === "background") {
    w = h = 1024;
    const small = await resize(r, w, h, "triangle");
    input = toCHW(small.data, w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
  } else {
    // MODNet: shortest edge 512, both sides multiples of 32.
    const k = 512 / Math.min(r.width, r.height);
    w = Math.max(32, Math.round((r.width * k) / 32) * 32);
    h = Math.max(32, Math.round((r.height * k) / 32) * 32);
    const small = await resize(r, w, h, "triangle");
    input = toCHW(small.data, w, h, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  }
  const out = await s.run({ [s.inputNames[0]!]: new o.Tensor("float32", input, [1, 3, h, w]) });
  const m = out[s.outputNames[0]!]!.data as Float32Array;
  const small = raster(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round((id === "background" ? sigmoid(m[i]!) : m[i]!) * 255);
    small.data[i * 4] = small.data[i * 4 + 1] = small.data[i * 4 + 2] = v;
    small.data[i * 4 + 3] = 255;
  }
  const big = await resize(small, r.width, r.height, "triangle", false);
  const alpha = new Uint8ClampedArray(r.width * r.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = big.data[i * 4]!;
  return alpha;
}

export interface CutOptions {
  fill: "transparent" | "color" | "blur";
  color?: string;
  trim?: boolean;
}

/** Put the matte to use. */
export function cutOut(r: Raster, alpha: Uint8ClampedArray, o: CutOptions): Raster {
  const out = raster(r.width, r.height);
  const d = out.data;
  const s = r.data;
  const bg = o.fill === "blur" ? gaussianBlur(r, Math.max(8, Math.min(r.width, r.height) / 40)) : null;
  const [cr, cg, cb] = parseColor(o.color, [255, 255, 255, 255]);
  for (let i = 0; i < alpha.length; i++) {
    const a = (alpha[i]! / 255) * (s[i * 4 + 3]! / 255);
    const p = i * 4;
    if (o.fill === "transparent") {
      d[p] = s[p]!;
      d[p + 1] = s[p + 1]!;
      d[p + 2] = s[p + 2]!;
      d[p + 3] = a * 255;
    } else {
      const b0 = bg ? bg.data[p]! : cr;
      const b1 = bg ? bg.data[p + 1]! : cg;
      const b2 = bg ? bg.data[p + 2]! : cb;
      d[p] = s[p]! * a + b0 * (1 - a);
      d[p + 1] = s[p + 1]! * a + b1 * (1 - a);
      d[p + 2] = s[p + 2]! * a + b2 * (1 - a);
      d[p + 3] = 255;
    }
  }
  return o.trim ? trimTo(out, alpha) : out;
}

/** Crop to the subject (alpha above a small threshold), with a 2 % margin. */
export function trimTo(r: Raster, alpha: Uint8ClampedArray): Raster {
  let x0 = r.width;
  let y0 = r.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (alpha[y * r.width + x]! > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return r;
  const m = Math.round(Math.max(r.width, r.height) * 0.02);
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(r.width - 1, x1 + m);
  y1 = Math.min(r.height - 1, y1 + m);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = raster(w, h);
  for (let y = 0; y < h; y++) out.data.set(r.data.subarray(((y0 + y) * r.width + x0) * 4, ((y0 + y) * r.width + x0 + w) * 4), y * w * 4);
  return out;
}
