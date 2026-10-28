// Crop rectangles: to an aspect ratio with an anchor, from percentages drawn
// in the editor, or around the most detailed area ("attention").

import type { Raster } from "../raster.ts";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Anchor = "center" | "top" | "bottom" | "left" | "right" | "attention";

/** "4:5" → 0.8 (width / height); null when not a ratio. */
export function parseRatio(s: string | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(s ?? "");
  if (!m) return null;
  const v = Number(m[1]) / Number(m[2]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The largest rectangle of this ratio inside w×h, placed by the anchor (attention is resolved by the caller). */
export function ratioRect(w: number, h: number, ratio: number, anchor: Anchor = "center"): Rect {
  let cw = w;
  let ch = Math.round(w / ratio);
  if (ch > h) {
    ch = h;
    cw = Math.min(w, Math.round(h * ratio));
  }
  cw = Math.max(1, cw);
  ch = Math.max(1, ch);
  const x = anchor === "left" ? 0 : anchor === "right" ? w - cw : Math.floor((w - cw) / 2);
  const y = anchor === "top" ? 0 : anchor === "bottom" ? h - ch : Math.floor((h - ch) / 2);
  return { x, y, width: cw, height: ch };
}

/** A rectangle from percentages of the image (the editor's drawn crop), clamped. */
export function percentRect(w: number, h: number, px: number, py: number, pw: number, ph: number): Rect {
  const x = Math.max(0, Math.min(w - 1, Math.round((px / 100) * w)));
  const y = Math.max(0, Math.min(h - 1, Math.round((py / 100) * h)));
  return { x, y, width: Math.max(1, Math.min(w - x, Math.round((pw / 100) * w))), height: Math.max(1, Math.min(h - y, Math.round((ph / 100) * h))) };
}

/** Edge energy (luminance gradient) on a reduced grid, for attention cropping. */
export function energyMap(r: Raster, maxSide = 256): { grid: Float32Array; gw: number; gh: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(r.width, r.height));
  const gw = Math.max(1, Math.round(r.width * scale));
  const gh = Math.max(1, Math.round(r.height * scale));
  const lum = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const sy = Math.min(r.height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < gw; x++) {
      const sx = Math.min(r.width - 1, Math.floor((x + 0.5) / scale));
      const i = (sy * r.width + sx) * 4;
      lum[y * gw + x] = (0.2126 * r.data[i]! + 0.7152 * r.data[i + 1]! + 0.0722 * r.data[i + 2]!) * (r.data[i + 3]! / 255);
    }
  }
  const grid = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const c = lum[y * gw + x]!;
      const dx = x + 1 < gw ? Math.abs(lum[y * gw + x + 1]! - c) : 0;
      const dy = y + 1 < gh ? Math.abs(lum[(y + 1) * gw + x]! - c) : 0;
      grid[y * gw + x] = dx + dy;
    }
  }
  return { grid, gw, gh, scale };
}

/** Slide a window of the ratio's size along the free axis and keep the position with the most detail. */
export function attentionRect(r: Raster, ratio: number): Rect {
  const base = ratioRect(r.width, r.height, ratio, "center");
  const horizontal = base.width < r.width;
  if (!horizontal && base.height >= r.height) return base;
  const { grid, gw, gh, scale } = energyMap(r);
  const lines = horizontal ? gw : gh;
  const sums = new Float64Array(lines);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) sums[horizontal ? x : y]! += grid[y * gw + x]!;
  const win = Math.max(1, Math.min(lines, Math.round((horizontal ? base.width : base.height) * scale)));
  let acc = 0;
  for (let i = 0; i < win; i++) acc += sums[i]!;
  let best = acc;
  let at = 0;
  const centre = (lines - win) / 2;
  for (let i = win; i < lines; i++) {
    acc += sums[i]! - sums[i - win]!;
    const pos = i - win + 1;
    // Clearly more detail wins; a tie goes to the more central window (a flat photo stays centred).
    if (acc > best * 1.001 + 1e-6 || (acc >= best * 0.999 - 1e-6 && Math.abs(pos - centre) < Math.abs(at - centre))) {
      if (acc > best) best = acc;
      at = pos;
    }
  }
  const pos = Math.round(at / scale);
  return horizontal
    ? { ...base, x: Math.max(0, Math.min(r.width - base.width, pos)) }
    : { ...base, y: Math.max(0, Math.min(r.height - base.height, pos)) };
}
