// Rotation by any angle (straightening a horizon), resampled bilinearly in
// premultiplied alpha, with three ways to treat the new corners.

import { raster, type Raster } from "../raster.ts";

/** The largest axis-aligned rectangle inside a w×h rectangle rotated by `rad`. */
export function inscribedSize(w: number, h: number, rad: number): { width: number; height: number } {
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  if (sin < 1e-9) return { width: w, height: h };
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  let wr: number;
  let hr: number;
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * short;
    [wr, hr] = w >= h ? [x / sin, x / cos] : [x / cos, x / sin];
  } else {
    const cos2 = cos * cos - sin * sin;
    wr = (w * cos - h * sin) / cos2;
    hr = (h * cos - w * sin) / cos2;
  }
  return { width: Math.max(1, Math.floor(wr)), height: Math.max(1, Math.floor(hr)) };
}

/** The bounding box of a w×h rectangle rotated by `rad`. */
export function rotatedBounds(w: number, h: number, rad: number): { width: number; height: number } {
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  return { width: Math.max(1, Math.ceil(w * cos + h * sin - 1e-6)), height: Math.max(1, Math.ceil(w * sin + h * cos - 1e-6)) };
}

export type CornerFill = "crop" | "color" | "transparent";

/** Rotate clockwise by `degrees`. "crop" keeps only the largest rectangle without empty corners. */
export function rotateFree(r: Raster, degrees: number, fill: CornerFill = "crop", bg: [number, number, number, number] = [255, 255, 255, 255]): Raster {
  const rad = (degrees * Math.PI) / 180;
  if (Math.abs(degrees) < 1e-6) return r;
  const { width: sw, height: sh, data: s } = r;
  const size = fill === "crop" ? inscribedSize(sw, sh, rad) : rotatedBounds(sw, sh, rad);
  const back = fill === "color" ? bg : ([0, 0, 0, 0] as [number, number, number, number]);
  const out = raster(size.width, size.height, back);
  const d = out.data;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ocx = size.width / 2;
  const ocy = size.height / 2;
  const icx = sw / 2;
  const icy = sh / 2;
  for (let y = 0; y < size.height; y++) {
    const dy = y + 0.5 - ocy;
    for (let x = 0; x < size.width; x++) {
      const dx = x + 0.5 - ocx;
      // Inverse rotation: where in the source this output pixel comes from.
      const fx = cos * dx + sin * dy + icx - 0.5;
      const fy = -sin * dx + cos * dy + icy - 0.5;
      if (fx <= -1 || fy <= -1 || fx >= sw || fy >= sh) continue;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let k = 0; k < 4; k++) {
        const xx = x0 + (k & 1);
        const yy = y0 + (k >> 1);
        if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
        const wgt = (k & 1 ? ax : 1 - ax) * (k >> 1 ? ay : 1 - ay);
        const i = (yy * sw + xx) * 4;
        const a = (s[i + 3]! / 255) * wgt;
        pr += s[i]! * a;
        pg += s[i + 1]! * a;
        pb += s[i + 2]! * a;
        pa += a;
      }
      const o = (y * size.width + x) * 4;
      if (pa <= 0) continue;
      // Composite the sample over the background (edges blend smoothly).
      const ba = d[o + 3]! / 255;
      const oa = pa + ba * (1 - pa);
      d[o] = (pr + d[o]! * ba * (1 - pa)) / oa;
      d[o + 1] = (pg + d[o + 1]! * ba * (1 - pa)) / oa;
      d[o + 2] = (pb + d[o + 2]! * ba * (1 - pa)) / oa;
      d[o + 3] = oa * 255;
    }
  }
  return out;
}
