// Placing an image on a larger or different canvas: square fit, padding,
// borders, and drawing one raster onto another.

import { raster, type Raster } from "../raster.ts";

/** Alpha-composite `src` onto `dst` at (x, y), in place, with an extra opacity. */
export function draw(dst: Raster, src: Raster, x: number, y: number, opacity = 1): void {
  x = Math.round(x);
  y = Math.round(y);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(dst.width, x + src.width);
  const y1 = Math.min(dst.height, y + src.height);
  const d = dst.data;
  const s = src.data;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const si = ((yy - y) * src.width + (xx - x)) * 4;
      const di = (yy * dst.width + xx) * 4;
      const sa = (s[si + 3]! / 255) * opacity;
      if (sa <= 0) continue;
      const da = d[di + 3]! / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) d[di + c] = (s[si + c]! * sa + d[di + c]! * da * (1 - sa)) / oa;
      d[di + 3] = oa * 255;
    }
  }
}

/** The image centred on a transparent square (icons). */
export function squareFit(r: Raster, bg: [number, number, number, number] = [0, 0, 0, 0]): Raster {
  if (r.width === r.height) return r;
  const side = Math.max(r.width, r.height);
  const out = raster(side, side, bg);
  draw(out, r, (side - r.width) / 2, (side - r.height) / 2);
  return out;
}

/** Add margins around the image, filled with a colour. */
export function pad(r: Raster, top: number, right: number, bottom: number, left: number, bg: [number, number, number, number]): Raster {
  const out = raster(r.width + left + right, r.height + top + bottom, bg);
  draw(out, r, left, top);
  return out;
}
