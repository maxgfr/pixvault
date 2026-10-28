// Light and colour distribution, and what it says about the exposure.

import type { Raster } from "../raster.ts";

export interface HistogramReport {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  pixels: number;
  /** Mean luma, 0–255. */
  mean: number;
  median: number;
  /** Share of pixels crushed to black / blown to white, 0–1. */
  clippedShadows: number;
  clippedHighlights: number;
  /** Luma spread between the 1st and 99th percentiles, 0–255. */
  range: number;
  hint: "balanced" | "under" | "over" | "low-contrast";
  width: number;
  height: number;
}

export function histogram(img: Raster): HistogramReport {
  const r = Array.from({ length: 256 }, () => 0);
  const g = Array.from({ length: 256 }, () => 0);
  const b = Array.from({ length: 256 }, () => 0);
  const luma = Array.from({ length: 256 }, () => 0);
  const d = img.data;
  let sum = 0;
  let pixels = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const R = d[i]!;
    const G = d[i + 1]!;
    const B = d[i + 2]!;
    r[R]!++;
    g[G]!++;
    b[B]!++;
    const y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
    luma[y]!++;
    sum += y;
    pixels++;
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += luma[v]!;
      if (acc >= p * pixels) return v;
    }
    return 255;
  };
  const mean = pixels ? sum / pixels : 0;
  const clippedShadows = pixels ? (luma[0]! + luma[1]! + luma[2]!) / pixels : 0;
  const clippedHighlights = pixels ? (luma[253]! + luma[254]! + luma[255]!) / pixels : 0;
  const range = pixels ? pct(0.99) - pct(0.01) : 0;
  const hint = clippedHighlights > 0.02 || mean > 190 ? "over" : clippedShadows > 0.02 || mean < 60 ? "under" : range < 128 ? "low-contrast" : "balanced";
  return { r, g, b, luma, pixels, mean, median: pixels ? pct(0.5) : 0, clippedShadows, clippedHighlights, range, hint, width: img.width, height: img.height };
}
