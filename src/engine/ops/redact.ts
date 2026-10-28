// Hide areas of a photo: pixelate, blur or cover rectangles given in percent.

import { parseColor, type Raster } from "../raster.ts";
import { crop } from "../geometry.ts";
import { gaussianBlur } from "./blur.ts";
import type { Rect } from "./crop.ts";

/** "x,y,w,h;x,y,w,h" in % of the image → rectangles; malformed entries are skipped. */
export function parseRegions(s: string | undefined): { x: number; y: number; w: number; h: number }[] {
  return (s ?? "")
    .split(";")
    .map((part) => part.split(",").map((n) => Number(n.trim())))
    .filter((p) => p.length === 4 && p.every((n) => Number.isFinite(n)) && p[2]! > 0 && p[3]! > 0)
    .map(([x, y, w, h]) => ({ x: x!, y: y!, w: w!, h: h! }));
}

/** The inverse, for the editor to write what the user drew. */
export const formatRegions = (rs: { x: number; y: number; w: number; h: number }[]) => rs.map((r) => [r.x, r.y, r.w, r.h].map((n) => +n.toFixed(2)).join(",")).join(";");

export function toPixels(w: number, h: number, p: { x: number; y: number; w: number; h: number }): Rect | null {
  const x0 = Math.max(0, Math.floor((p.x / 100) * w));
  const y0 = Math.max(0, Math.floor((p.y / 100) * h));
  const x1 = Math.min(w, Math.ceil(((p.x + p.w) / 100) * w));
  const y1 = Math.min(h, Math.ceil(((p.y + p.h) / 100) * h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

export type RedactStyle = "pixelate" | "blur" | "fill";

/** Hide one rectangle in place. `strength` 1–100; `mask` optionally limits it to an ellipse. */
export function redactRect(r: Raster, rect: Rect, style: RedactStyle, strength: number, color = "#000000", ellipse = false): void {
  const { width: w, data: d } = r;
  const inside = (x: number, y: number) => {
    if (!ellipse) return true;
    const nx = (x + 0.5 - rect.x - rect.width / 2) / (rect.width / 2);
    const ny = (y + 0.5 - rect.y - rect.height / 2) / (rect.height / 2);
    return nx * nx + ny * ny <= 1;
  };
  if (style === "fill") {
    const [cr, cg, cb] = parseColor(color, [0, 0, 0, 255]);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (!inside(x, y)) continue;
        const i = (y * w + x) * 4;
        d[i] = cr;
        d[i + 1] = cg;
        d[i + 2] = cb;
      }
    }
    return;
  }
  const short = Math.min(rect.width, rect.height);
  const k = Math.max(1, Math.min(100, strength)) / 100;
  if (style === "pixelate") {
    // Blocks big enough that the content is unreadable: at least 8 px, up to a third of the area.
    const block = Math.max(4, Math.round(Math.max(8, short * 0.34 * k)));
    for (let by = rect.y; by < rect.y + rect.height; by += block) {
      for (let bx = rect.x; bx < rect.x + rect.width; bx += block) {
        const ex = Math.min(rect.x + rect.width, bx + block);
        const ey = Math.min(rect.y + rect.height, by + block);
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const i = (y * w + x) * 4;
            sr += d[i]!;
            sg += d[i + 1]!;
            sb += d[i + 2]!;
            n++;
          }
        }
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            if (!inside(x, y)) continue;
            const i = (y * w + x) * 4;
            d[i] = sr / n;
            d[i + 1] = sg / n;
            d[i + 2] = sb / n;
          }
        }
      }
    }
    return;
  }
  // Blur: strong enough to hide text and faces, with a margin so edges blend in.
  const sigma = 2 + short * 0.18 * k;
  const m = Math.ceil(sigma * 2);
  const ox = Math.max(0, rect.x - m);
  const oy = Math.max(0, rect.y - m);
  const area = crop(r, ox, oy, Math.min(r.width - ox, rect.width + 2 * m), Math.min(r.height - oy, rect.height + 2 * m));
  // Two passes: one gaussian of this size still lets large shapes show through.
  const blurred = gaussianBlur(gaussianBlur(area, sigma), sigma);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (!inside(x, y)) continue;
      const i = (y * w + x) * 4;
      const j = ((y - oy) * blurred.width + (x - ox)) * 4;
      d[i] = blurred.data[j]!;
      d[i + 1] = blurred.data[j + 1]!;
      d[i + 2] = blurred.data[j + 2]!;
    }
  }
}
