// Watermark and caption helpers: placeholder tokens filled from the photo's
// details, and where a stamp goes on the photo.

import { cameraName, type PhotoMeta, settingsLine } from "../meta/types.ts";
import type { Raster } from "../raster.ts";
import { draw } from "./canvas.ts";
import { rotateFree } from "./rotate.ts";

/** {date} {time} {year} {camera} {lens} {settings} {name} → this photo's values; separators around empty values are tidied. */
export function fillTokens(template: string, meta: PhotoMeta, name: string, now = new Date()): string {
  const taken = meta.taken ?? "";
  const values: Record<string, string> = {
    date: taken.slice(0, 10),
    time: taken.slice(11, 16),
    year: taken.slice(0, 4) || String(now.getFullYear()),
    camera: cameraName(meta),
    lens: meta.lens?.trim() ?? "",
    settings: settingsLine(meta),
    name: name.replace(/\.[^.]+$/, ""),
  };
  const filled = template.replace(/\{(\w+)\}/g, (all, key: string) => (key.toLowerCase() in values ? values[key.toLowerCase()]! : all));
  const sep = String.raw`\s*[·•|,–—-]\s*`;
  return filled
    .split("\n")
    .map((line) =>
      line
        .replace(new RegExp(`(${sep}){2,}`, "g"), (m) => ` ${m.trim()[0]} `)
        .replace(new RegExp(`^(${sep})+|(${sep})+$`, "g"), "")
        .trim(),
    )
    .join("\n")
    .trim();
}

export type Position = "br" | "bl" | "bc" | "tr" | "tl" | "tc" | "c" | "tile";

/** Top-left corner of a w×h stamp on a W×H photo, `margin` px from the edges. */
export function placeAt(W: number, H: number, w: number, h: number, pos: Position, margin: number): { x: number; y: number } {
  const x = pos === "bl" || pos === "tl" ? margin : pos === "br" || pos === "tr" ? W - w - margin : Math.round((W - w) / 2);
  const y = pos === "tl" || pos === "tr" || pos === "tc" ? margin : pos === "c" ? Math.round((H - h) / 2) : H - h - margin;
  return { x, y };
}

/** Stamp positions repeated over the whole photo, rows staggered. */
export function tilePositions(W: number, H: number, w: number, h: number): { x: number; y: number }[] {
  const gx = Math.max(1, Math.round(w * 1.6));
  const gy = Math.max(1, Math.round(h * 2.2));
  const out: { x: number; y: number }[] = [];
  let row = 0;
  for (let y = -h; y < H + h; y += gy, row++) {
    const shift = row % 2 ? Math.round(gx / 2) : 0;
    for (let x = -w + shift; x < W + w; x += gx) out.push({ x, y });
  }
  return out;
}

/** Draw a stamp (text or logo raster) on the photo, in place. */
export function applyStamp(photo: Raster, stamp: Raster, pos: Position, margin: number, opacity: number, angle = 0): void {
  if (pos === "tile") {
    // Like CSS rotate(): positive turns clockwise, so the default -30° makes text rise to the right.
    const turned = angle ? rotateFree(stamp, angle, "transparent") : stamp;
    for (const p of tilePositions(photo.width, photo.height, turned.width, turned.height)) draw(photo, turned, p.x, p.y, opacity);
    return;
  }
  const p = placeAt(photo.width, photo.height, stamp.width, stamp.height, pos, margin);
  draw(photo, stamp, p.x, p.y, opacity);
}
