// Lossless pixel geometry: quarter turns, mirrors, crops, EXIF orientation.

import { raster, type Raster } from "./raster.ts";

export function rotate90(r: Raster, turns: number): Raster {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  if (t === 0) return r;
  const { width: w, height: h, data: s } = r;
  const out = t === 2 ? raster(w, h) : raster(h, w);
  const d = new Uint32Array(out.data.buffer);
  const src = new Uint32Array(s.buffer, s.byteOffset, w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = src[y * w + x]!;
      if (t === 1) d[x * h + (h - 1 - y)] = p;
      else if (t === 2) d[(h - 1 - y) * w + (w - 1 - x)] = p;
      else d[(w - 1 - x) * h + y] = p;
    }
  }
  return out;
}

export function flip(r: Raster, horizontal: boolean, vertical: boolean): Raster {
  if (!horizontal && !vertical) return r;
  const { width: w, height: h } = r;
  const out = raster(w, h);
  const d = new Uint32Array(out.data.buffer);
  const s = new Uint32Array(r.data.buffer, r.data.byteOffset, w * h);
  for (let y = 0; y < h; y++) {
    const sy = vertical ? h - 1 - y : y;
    for (let x = 0; x < w; x++) d[y * w + x] = s[sy * w + (horizontal ? w - 1 - x : x)]!;
  }
  return out;
}

/** Crop to a rectangle, clamped to the image. */
export function crop(r: Raster, x: number, y: number, width: number, height: number): Raster {
  const x0 = Math.max(0, Math.min(r.width - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(r.height - 1, Math.round(y)));
  const w = Math.max(1, Math.min(r.width - x0, Math.round(width)));
  const h = Math.max(1, Math.min(r.height - y0, Math.round(height)));
  if (x0 === 0 && y0 === 0 && w === r.width && h === r.height) return r;
  const out = raster(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y0 + row) * r.width + x0) * 4;
    out.data.set(r.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

/** Make pixels stored with EXIF orientation 1–8 upright. */
export function applyOrientation(r: Raster, orientation: number): Raster {
  switch (orientation) {
    case 2:
      return flip(r, true, false);
    case 3:
      return rotate90(r, 2);
    case 4:
      return flip(r, false, true);
    case 5:
      return flip(rotate90(r, 1), true, false);
    case 6:
      return rotate90(r, 1);
    case 7:
      return flip(rotate90(r, 3), true, false);
    case 8:
      return rotate90(r, 3);
    default:
      return r;
  }
}
