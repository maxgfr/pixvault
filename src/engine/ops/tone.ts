// Light and colour adjustments: white balance and tone curve as per-channel
// lookup tables, then saturation, detail, vignette and grain. Every control
// at zero leaves the pixels untouched.

import { clone, type Raster } from "../raster.ts";
import { gaussianBlur } from "./blur.ts";

export interface Adjustments {
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  temperature?: number;
  tint?: number;
  saturation?: number;
  vibrance?: number;
  sharpness?: number;
  blur?: number;
  vignette?: number;
  grain?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** The tone curve for one channel value in 0–1 (exposure, contrast, highlights, shadows). */
export function toneCurve(v: number, a: Adjustments): number {
  if (a.exposure) v = clamp01(toSrgb(toLinear(v) * 2 ** (a.exposure / 50)));
  if (a.contrast) {
    const k = a.contrast / 100;
    // An S curve for more contrast, a flattening towards mid-grey for less.
    const s = v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v);
    v = k > 0 ? v + k * (s - v) : 0.5 + (v - 0.5) * (1 + k * 0.7);
  }
  if (a.highlights) v += (a.highlights / 100) * 0.5 * smooth(0.45, 1, v) * (a.highlights > 0 ? 1 - v : v);
  if (a.shadows) v += (a.shadows / 100) * 0.5 * (1 - smooth(0, 0.55, v)) * (a.shadows > 0 ? 1 - v : v);
  return clamp01(v);
}

/** Per-channel 256-entry tables combining white balance and the tone curve. */
export function channelLuts(a: Adjustments): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const t = (a.temperature ?? 0) / 100;
  const g = (a.tint ?? 0) / 100;
  // Gains in linear light: warmer = more red, less blue; positive tint = magenta (less green).
  const gains = [1 + 0.25 * t, 1 - 0.18 * g, 1 - 0.25 * t];
  return gains.map((gain) => {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      if (gain !== 1) v = clamp01(toSrgb(toLinear(v) * gain));
      lut[i] = Math.round(toneCurve(v, a) * 255);
    }
    return lut;
  }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
}

/** Saturation (uniform) and vibrance (strongest on muted colours), around luminance. */
function saturate(d: Uint8ClampedArray, saturation: number, vibrance: number) {
  const s = 1 + saturation / 100;
  const v = vibrance / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    // Warm, mid-saturated tones (skin) get half the vibrance boost.
    const skin = r > g && g > b && max - min < 140 ? 0.5 : 1;
    const k = s * (1 + v * (1 - (max - min) / 255) * (v > 0 ? skin : 1));
    d[i] = y + (r - y) * k;
    d[i + 1] = y + (g - y) * k;
    d[i + 2] = y + (b - y) * k;
  }
}

/** Unsharp mask: add back the difference with a blurred copy. */
export function sharpen(r: Raster, amount: number, sigma: number): Raster {
  const blurred = gaussianBlur(r, sigma);
  const out = clone(r);
  const d = out.data;
  const s = blurred.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c]! - s[i + c]!;
      if (diff > 2 || diff < -2) d[i + c] = d[i + c]! + diff * amount;
    }
  }
  return out;
}

/** Darken (amount > 0) or lighten (< 0) towards the corners. */
export function vignette(r: Raster, amount: number): void {
  const { width: w, height: h, data: d } = r;
  const cx = w / 2;
  const cy = h / 2;
  const k = Math.abs(amount) / 100;
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5 - cy) / cy;
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / cx;
      const wgt = smooth(0.45, 1.35, Math.sqrt(dx * dx + dy * dy)) * k * 0.85;
      if (wgt <= 0) continue;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = amount > 0 ? d[i + c]! * (1 - wgt) : d[i + c]! + (255 - d[i + c]!) * wgt;
    }
  }
}

/** Monochrome film grain from a fixed seed: the same photo gets the same grain. */
export function grain(r: Raster, amount: number, seed = 0x9e3779b9): void {
  const d = r.data;
  const amp = (amount / 100) * 48;
  let s = seed >>> 0 || 1;
  for (let i = 0; i < d.length; i += 4) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    // Sum of two uniforms: a softer, roughly triangular distribution.
    const u = ((s >>> 0) / 4294967296 + ((s >>> 11) & 0xffff) / 65536 - 1) * amp;
    d[i] = d[i]! + u;
    d[i + 1] = d[i + 1]! + u;
    d[i + 2] = d[i + 2]! + u;
  }
}

/** Every adjustment, in a fixed order. Returns the input itself when nothing changes. */
export function adjust(r: Raster, a: Adjustments): Raster {
  const curve = Boolean(a.exposure || a.contrast || a.highlights || a.shadows || a.temperature || a.tint);
  const colour = Boolean(a.saturation || a.vibrance);
  if (!curve && !colour && !a.sharpness && !a.blur && !a.vignette && !a.grain) return r;
  const short = Math.min(r.width, r.height);
  let out = clone(r);
  if (curve) {
    const [lr, lg, lb] = channelLuts(a);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lr[d[i]!]!;
      d[i + 1] = lg[d[i + 1]!]!;
      d[i + 2] = lb[d[i + 2]!]!;
    }
  }
  if (colour) saturate(out.data, a.saturation ?? 0, a.vibrance ?? 0);
  // Radii scale with the photo, so a reduced preview looks like the full result.
  if (a.sharpness) out = sharpen(out, (a.sharpness / 100) * 1.6, Math.max(0.7, short / 1400));
  if (a.blur && a.blur > 0) out = gaussianBlur(out, (a.blur / 100) * Math.max(1.5, short * 0.02));
  if (a.vignette) vignette(out, a.vignette);
  if (a.grain) grain(out, a.grain);
  return out;
}

/** Per-channel histograms. */
export function histograms(r: Raster): [Uint32Array, Uint32Array, Uint32Array] {
  const hs: [Uint32Array, Uint32Array, Uint32Array] = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const d = r.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    hs[0][d[i]!]!++;
    hs[1][d[i + 1]!]!++;
    hs[2][d[i + 2]!]!++;
  }
  return hs;
}

function percentile(h: Uint32Array, p: number): number {
  let total = 0;
  for (const n of h) total += n;
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += h[i]!;
    if (acc > target) return i;
  }
  return 255;
}

/** Levels stretched to the 0.5–99.5 percentiles, optional grey-world white balance, blended by strength (0–1). */
export function autoEnhance(r: Raster, strength: number, whiteBalance: boolean): Raster {
  if (strength <= 0) return r;
  const hs = histograms(r);
  const lows = hs.map((h) => percentile(h, 0.005));
  const highs = hs.map((h) => percentile(h, 0.995));
  // Without white balance, one range for all channels keeps the colours as they are.
  const lo = whiteBalance ? lows : lows.map(() => Math.min(...lows));
  const hi = whiteBalance ? highs : highs.map(() => Math.max(...highs));
  const luts = [0, 1, 2].map((c) => {
    const lut = new Float32Array(256);
    const span = hi[c]! - lo[c]!;
    for (let i = 0; i < 256; i++) lut[i] = span < 12 ? i : Math.min(255, Math.max(0, ((i - lo[c]!) / span) * 255));
    return lut;
  });
  if (whiteBalance) {
    // Grey world: scale each channel so the stretched means agree.
    const means = [0, 1, 2].map((c) => {
      let sum = 0;
      let n = 0;
      hs[c]!.forEach((count, v) => {
        sum += luts[c]![v]! * count;
        n += count;
      });
      return n ? sum / n : 128;
    });
    const grey = (means[0]! + means[1]! + means[2]!) / 3;
    luts.forEach((lut, c) => {
      // Half strength: a full grey-world correction over-corrects sunsets and interiors.
      const k = 1 + (grey / Math.max(1, means[c]!) - 1) * 0.5;
      for (let i = 0; i < 256; i++) lut[i] = Math.min(255, lut[i]! * k);
    });
  }
  const out = clone(r);
  const d = out.data;
  const tables = luts.map((lut) => Uint8ClampedArray.from(lut, (v, i) => i + (v - i) * strength));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = tables[0]![d[i]!]!;
    d[i + 1] = tables[1]![d[i + 1]!]!;
    d[i + 2] = tables[2]![d[i + 2]!]!;
  }
  return out;
}
