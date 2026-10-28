// Shared drawing helpers for the tools that assemble several photos:
// cover/contain scaling, rounded corners, solid rectangles.

import { crop } from "../geometry.ts";
import { raster, type Raster } from "../raster.ts";
import { fitSize, resize } from "../resize.ts";

/** Scale and centre-crop to exactly w×h (CSS object-fit: cover). */
export async function cover(r: Raster, w: number, h: number): Promise<Raster> {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const target = w / h;
  const ratio = r.width / r.height;
  const cw = ratio > target ? r.height * target : r.width;
  const ch = ratio > target ? r.height : r.width / target;
  const cropped = crop(r, (r.width - cw) / 2, (r.height - ch) / 2, cw, ch);
  return resize(cropped, w, h);
}

/** Scale to fit inside w×h, keeping the ratio (no canvas added). */
export async function contain(r: Raster, w: number, h: number, enlarge = true): Promise<Raster> {
  const s = fitSize(r.width, r.height, w, h, "contain", enlarge);
  return resize(r, s.width, s.height);
}

/** A copy with rounded corners (antialiased, through alpha). */
export function roundCorners(r: Raster, radius: number): Raster {
  const rad = Math.min(radius, r.width / 2, r.height / 2);
  if (rad < 0.5) return r;
  const out: Raster = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
  const d = out.data;
  const corner = (cx: number, cy: number, x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = Math.max(0, Math.min(1, rad - dist + 0.5));
        if (cov < 1) d[(y * r.width + x) * 4 + 3] = d[(y * r.width + x) * 4 + 3]! * cov;
      }
    }
  };
  const k = Math.ceil(rad);
  corner(rad, rad, 0, k, 0, k);
  corner(r.width - rad, rad, r.width - k, r.width, 0, k);
  corner(rad, r.height - rad, 0, k, r.height - k, r.height);
  corner(r.width - rad, r.height - rad, r.width - k, r.width, r.height - k, r.height);
  return out;
}

/** Fill a rectangle with an opaque colour, in place. */
export function fillRect(dst: Raster, x: number, y: number, w: number, h: number, c: [number, number, number, number]): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(dst.width, Math.round(x + w));
  const y1 = Math.min(dst.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) dst.data.set(c, (yy * dst.width + xx) * 4);
}

export const canvasOf = (w: number, h: number, bg: [number, number, number, number]) => raster(w, h, bg);

/** "IMG 0001.jpg" → "img-0001". */
export function slug(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image"
  );
}

/** "2024-07-14T18:30:05" → "2024-07-14 18:30". */
export const shortDate = (taken?: string) => (taken ? taken.replace("T", " ").slice(0, 16) : "");
