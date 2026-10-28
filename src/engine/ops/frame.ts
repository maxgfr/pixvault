// Frames around a photo: borders, rounded corners, drop shadows, and the
// "fit the whole photo in a square" canvas with a blurred background.

import { clone, raster, type Raster } from "../raster.ts";
import { resize } from "../resize.ts";
import { gaussianBlur } from "./blur.ts";
import { draw } from "./canvas.ts";
import { crop } from "../geometry.ts";
import { ratioRect } from "./crop.ts";

/** Canvas size and photo position for "square and margins": margin is % of the longer side. */
export function canvasLayout(w: number, h: number, ratio: number | null, marginPct: number): { width: number; height: number; x: number; y: number } {
  const m = Math.round((Math.max(0, marginPct) / 100) * Math.max(w, h));
  let cw = w + 2 * m;
  let ch = h + 2 * m;
  if (ratio) {
    if (cw / ch > ratio) ch = Math.round(cw / ratio);
    else cw = Math.round(ch * ratio);
  }
  return { width: cw, height: ch, x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2) };
}

/** The photo scaled to cover width×height, centred, cropped. */
export async function coverResize(r: Raster, width: number, height: number): Promise<Raster> {
  const s = Math.max(width / r.width, height / r.height);
  const scaled = await resize(r, Math.max(width, Math.round(r.width * s)), Math.max(height, Math.round(r.height * s)), "triangle");
  const rect = ratioRect(scaled.width, scaled.height, width / height, "center");
  const cut = crop(scaled, rect.x, rect.y, rect.width, rect.height);
  return cut.width === width && cut.height === height ? cut : resize(cut, width, height, "triangle");
}

/** A soft, blurred version of the photo filling width×height (blurred small, then enlarged: fast and smooth). */
export async function blurredBackdrop(r: Raster, width: number, height: number): Promise<Raster> {
  const small = Math.min(1, 160 / Math.max(width, height));
  const sw = Math.max(2, Math.round(width * small));
  const sh = Math.max(2, Math.round(height * small));
  const bg = gaussianBlur(await coverResize(r, sw, sh), Math.max(sw, sh) * 0.04);
  // Slightly darker so the photo in front stands out.
  for (let i = 0; i < bg.data.length; i += 4) {
    bg.data[i] = bg.data[i]! * 0.88;
    bg.data[i + 1] = bg.data[i + 1]! * 0.88;
    bg.data[i + 2] = bg.data[i + 2]! * 0.88;
    bg.data[i + 3] = 255;
  }
  return resize(bg, width, height, "triangle");
}

/** Multiply alpha by an anti-aliased rounded-rectangle mask, in place. */
export function roundCorners(r: Raster, radius: number): void {
  const rad = Math.min(radius, r.width / 2, r.height / 2);
  if (rad < 0.5) return;
  const { width: w, height: h, data: d } = r;
  const span = Math.ceil(rad);
  for (let y = 0; y < h; y++) {
    const inTop = y < span;
    const inBottom = y >= h - span;
    if (!inTop && !inBottom) continue;
    const cy = inTop ? rad : h - rad;
    for (let x = 0; x < w; x++) {
      const inLeft = x < span;
      const inRight = x >= w - span;
      if (!inLeft && !inRight) continue;
      const cx = inLeft ? rad : w - rad;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if ((inLeft && dx > 0) || (inRight && dx < 0) || (inTop && dy > 0) || (inBottom && dy < 0)) continue;
      const cover = Math.max(0, Math.min(1, rad - Math.sqrt(dx * dx + dy * dy) + 0.5));
      const i = (y * w + x) * 4 + 3;
      d[i] = d[i]! * cover;
    }
  }
}

/** A soft shadow under the shape (its alpha), on a larger transparent canvas. */
export function dropShadow(r: Raster): Raster {
  const short = Math.min(r.width, r.height);
  const pad = Math.max(4, Math.round(short * 0.06));
  const offset = Math.round(pad * 0.35);
  const out = raster(r.width + pad * 2, r.height + pad * 2);
  const shadow = raster(out.width, out.height);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const a = r.data[(y * r.width + x) * 4 + 3]!;
      const yy = y + pad + offset;
      if (yy < shadow.height) shadow.data[(yy * shadow.width + x + pad) * 4 + 3] = a * 0.42;
    }
  }
  const soft = gaussianBlur(shadow, pad / 2.6);
  out.data.set(soft.data);
  draw(out, r, pad, pad);
  return out;
}

export interface BorderOptions {
  /** Border thickness, % of the shorter side. */
  width: number;
  color: [number, number, number, number];
  /** Extra border at the bottom (Polaroid), % of the shorter side. */
  bottom: number;
  /** Corner radius, % of the framed shorter side (50 = pill). */
  radius: number;
  shadow: boolean;
}

export function borderSize(w: number, h: number, o: Pick<BorderOptions, "width" | "bottom">): { width: number; height: number; inset: number; extra: number } {
  const short = Math.min(w, h);
  const inset = Math.round((Math.max(0, o.width) / 100) * short);
  const extra = Math.round((Math.max(0, o.bottom) / 100) * short);
  return { width: w + inset * 2, height: h + inset * 2 + extra, inset, extra };
}

export function frame(r: Raster, o: BorderOptions): Raster {
  if (o.width <= 0 && o.bottom <= 0 && o.radius <= 0 && !o.shadow) return r;
  const size = borderSize(r.width, r.height, o);
  let out: Raster;
  if (size.inset || size.extra) {
    out = raster(size.width, size.height, o.color);
    draw(out, r, size.inset, size.inset);
  } else out = clone(r);
  if (o.radius > 0) roundCorners(out, (o.radius / 100) * Math.min(out.width, out.height));
  return o.shadow ? dropShadow(out) : out;
}
