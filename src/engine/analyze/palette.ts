// Dominant colours by k-means (k-means++ seeding, deterministic) in CIELAB,
// where distances match what the eye sees.

import type { Raster } from "../raster.ts";

export interface Swatch {
  hex: string;
  rgb: [number, number, number];
  /** Share of the (opaque) pixels, 0–1. */
  share: number;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** `count` colours from a raster (downscale it first; every opaque pixel is used). */
export function palette(r: Raster, count: number): Swatch[] {
  const k0 = Math.max(1, Math.min(16, Math.round(count)));
  const labs: number[][] = [];
  const rgbs: number[][] = [];
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3]! < 128) continue;
    const c = [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!];
    rgbs.push(c);
    labs.push(rgbToLab(c[0]!, c[1]!, c[2]!));
  }
  const n = labs.length;
  if (!n) return [];
  const k = Math.min(k0, n);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const d2 = (a: number[], b: number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
  // k-means++: each new centre far from the ones chosen.
  const centres: number[][] = [labs[Math.floor(rand() * n)]!.slice()];
  const dist = labs.map((p) => d2(p, centres[0]!));
  while (centres.length < k) {
    const total = dist.reduce((s, v) => s + v, 0);
    if (total === 0) break;
    let pick = rand() * total;
    let idx = 0;
    while (idx < n - 1 && (pick -= dist[idx]!) > 0) idx++;
    centres.push(labs[idx]!.slice());
    for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i]!, d2(labs[i]!, centres[centres.length - 1]!));
  }
  const assign = new Int32Array(n);
  for (let iter = 0; iter < 16; iter++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = d2(labs[i]!, centres[c]!);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]!]!;
      s[0]! += labs[i]![0]!;
      s[1]! += labs[i]![1]!;
      s[2]! += labs[i]![2]!;
      s[3]!++;
    }
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
    if (iter > 0 && moved === 0) break;
  }
  // Report each cluster by the average of its pixels in RGB (exact colours, no Lab round trip).
  const acc = centres.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const a = acc[assign[i]!]!;
    a[0]! += rgbs[i]![0]!;
    a[1]! += rgbs[i]![1]!;
    a[2]! += rgbs[i]![2]!;
    a[3]!++;
  }
  return acc
    .filter((a) => a[3]! > 0)
    .map((a) => {
      const rgb: [number, number, number] = [Math.round(a[0]! / a[3]!), Math.round(a[1]! / a[3]!), Math.round(a[2]! / a[3]!)];
      return { hex: toHex(rgb), rgb, share: a[3]! / n };
    })
    .sort((x, y) => y.share - x.share);
}
