// Object eraser with MI-GAN (Picsart AI Research): the painted area is
// filled by a model trained on what photos look like. Only a window around
// the strokes goes through the model, and only masked pixels are replaced.
// Graph (checked against the file): image uint8 [1,3,H,W] RGB, mask uint8
// [1,1,H,W] with 0 for the hole and 255 for known pixels, result uint8
// [1,3,H,W]; any size that is a multiple of 8.

import { decode } from "../codecs.ts";
import { DecodeError } from "../errors.ts";
import type { Rect } from "../ops/crop.ts";
import { clone, raster, type Raster } from "../raster.ts";
import { resize } from "../resize.ts";
import { ort, session } from "./runtime.ts";

const MIN_WINDOW = 256;
const MAX_WINDOW = 1024;

/** The painted mask (any size, white or opaque = erase) as one byte per photo pixel. */
export async function maskFor(r: Raster, bytes: Uint8Array): Promise<Uint8Array> {
  const m = await decode(bytes, "mask.png");
  const big = m.width === r.width && m.height === r.height ? m : await resize(m, r.width, r.height, "triangle", false);
  const out = new Uint8Array(r.width * r.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = big.data[p + 3]! > 127 && big.data[p]! + big.data[p + 1]! + big.data[p + 2]! > 3 * 127 ? 1 : 0;
  }
  return out;
}

/** The square-ish window around the mask's bounding box, with context, inside the photo. */
export function windowFor(width: number, height: number, mask: Uint8Array): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const side = Math.min(Math.max(width, height), Math.max(MIN_WINDOW, Math.round(Math.max(x1 - x0, y1 - y0) * 2)));
  const w = Math.min(width, side);
  const h = Math.min(height, side);
  const x = Math.max(0, Math.min(width - w, Math.round((x0 + x1) / 2 - w / 2)));
  const y = Math.max(0, Math.min(height - h, Math.round((y0 + y1) / 2 - h / 2)));
  return { x, y, width: w, height: h };
}

export async function erase(r: Raster, mask: Uint8Array): Promise<Raster> {
  const win = windowFor(r.width, r.height, mask);
  if (!win) throw new DecodeError("paint over what to erase first", "bad-options");
  // The model sees at most MAX_WINDOW pixels a side; a bigger window is shrunk and the fill enlarged back.
  const k = Math.min(1, MAX_WINDOW / Math.max(win.width, win.height));
  const w = Math.max(8, Math.round((win.width * k) / 8) * 8);
  const h = Math.max(8, Math.round((win.height * k) / 8) * 8);
  const region = raster(win.width, win.height);
  const regionMask = raster(win.width, win.height);
  for (let y = 0; y < win.height; y++) {
    region.data.set(r.data.subarray(((win.y + y) * r.width + win.x) * 4, ((win.y + y) * r.width + win.x + win.width) * 4), y * win.width * 4);
    for (let x = 0; x < win.width; x++) {
      const v = mask[(win.y + y) * r.width + win.x + x] ? 255 : 0;
      const p = (y * win.width + x) * 4;
      regionMask.data[p] = regionMask.data[p + 1] = regionMask.data[p + 2] = v;
      regionMask.data[p + 3] = 255;
    }
  }
  const small = await resize(region, w, h, "catrom");
  const smallMask = await resize(regionMask, w, h, "triangle", false);
  const plane = w * h;
  const image = new Uint8Array(3 * plane);
  const hole = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) {
    image[i] = small.data[i * 4]!;
    image[plane + i] = small.data[i * 4 + 1]!;
    image[2 * plane + i] = small.data[i * 4 + 2]!;
    // Grow the hole slightly: a stroke's soft edge is still the object.
    hole[i] = smallMask.data[i * 4]! > 20 ? 0 : 255;
  }
  const o = await ort();
  const s = await session("inpaint");
  const out = await s.run({ image: new o.Tensor("uint8", image, [1, 3, h, w]), mask: new o.Tensor("uint8", hole, [1, 1, h, w]) });
  const res = out.result!.data as Uint8Array;
  const filled = raster(w, h);
  for (let i = 0; i < plane; i++) {
    filled.data[i * 4] = res[i]!;
    filled.data[i * 4 + 1] = res[plane + i]!;
    filled.data[i * 4 + 2] = res[2 * plane + i]!;
    filled.data[i * 4 + 3] = 255;
  }
  const back = await resize(filled, win.width, win.height, "catrom");
  const result = clone(r);
  for (let y = 0; y < win.height; y++) {
    for (let x = 0; x < win.width; x++) {
      const i = (win.y + y) * r.width + win.x + x;
      if (!mask[i]) continue;
      const p = i * 4;
      const q = (y * win.width + x) * 4;
      result.data[p] = back.data[q]!;
      result.data[p + 1] = back.data[q + 1]!;
      result.data[p + 2] = back.data[q + 2]!;
    }
  }
  return result;
}
