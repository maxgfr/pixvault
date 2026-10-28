// Gaussian blur approximated by three box blurs (separable, sliding sums):
// linear in the image size whatever the radius. Transparent pixels are
// premultiplied first so they do not bleed dark fringes.

import { clone, opaque, type Raster } from "../raster.ts";

/** Box sizes whose three passes approximate a gaussian of this sigma. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

/** One box pass along lines: `lines` lines of `len` pixels. */
function pass(src: Uint8ClampedArray, dst: Uint8ClampedArray, lines: number, len: number, lineStride: number, step: number, r: number) {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  const inv = 1 / (r + r + 1);
  const last = len - 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    // Window centred on x = -1, edges clamped.
    for (let k = -r - 1; k <= r - 1; k++) {
      const p = base + Math.min(last, Math.max(0, k)) * step;
      s0 += src[p]!;
      s1 += src[p + 1]!;
      s2 += src[p + 2]!;
      s3 += src[p + 3]!;
    }
    for (let x = 0; x < len; x++) {
      const add = base + Math.min(last, x + r) * step;
      const sub = base + Math.max(0, x - r - 1) * step;
      s0 += src[add]! - src[sub]!;
      s1 += src[add + 1]! - src[sub + 1]!;
      s2 += src[add + 2]! - src[sub + 2]!;
      s3 += src[add + 3]! - src[sub + 3]!;
      const o = base + x * step;
      dst[o] = s0 * inv + 0.5;
      dst[o + 1] = s1 * inv + 0.5;
      dst[o + 2] = s2 * inv + 0.5;
      dst[o + 3] = s3 * inv + 0.5;
    }
  }
}

function premultiply(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    d[i] = d[i]! * a;
    d[i + 1] = d[i + 1]! * a;
    d[i + 2] = d[i + 2]! * a;
  }
}

function unpremultiply(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    if (a === 0 || a === 255) continue;
    const k = 255 / a;
    d[i] = d[i]! * k;
    d[i + 1] = d[i + 1]! * k;
    d[i + 2] = d[i + 2]! * k;
  }
}

/** A blurred copy; sigma in pixels. */
export function gaussianBlur(r: Raster, sigma: number): Raster {
  if (sigma < 0.3) return clone(r);
  const { width: w, height: h } = r;
  const a = new Uint8ClampedArray(r.data);
  const b = new Uint8ClampedArray(a.length);
  const alpha = !opaque(r);
  if (alpha) premultiply(a);
  for (const size of boxesForGauss(sigma)) {
    const rad = (size - 1) >> 1;
    pass(a, b, h, w, w * 4, 4, Math.min(rad, w));
    pass(b, a, w, h, 4, w * 4, Math.min(rad, h));
  }
  if (alpha) unpremultiply(a);
  return { width: w, height: h, data: a };
}
