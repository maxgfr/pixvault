// Watermarks, captions and hidden areas.

import { decode } from "../codecs.ts";
import { DecodeError } from "../errors.ts";
import { draw } from "../ops/canvas.ts";
import { parseRegions, type RedactStyle, redactRect, toPixels } from "../ops/redact.ts";
import { applyStamp, fillTokens, type Position } from "../ops/stamp.ts";
import { type FontName, renderText } from "../ops/text.ts";
import { clone, parseColor, raster, type Raster } from "../raster.ts";
import { resize } from "../resize.ts";
import { bool, bytesOf, num, type RunFn, type StepFn, str } from "./types.ts";

const POSITIONS = new Set(["br", "bl", "bc", "tr", "tl", "tc", "c", "tile"]);
const FONTS = new Set(["sans", "serif", "mono"]);

// The same logo goes on every photo of a batch: decode it once.
let lastLogo: { bytes: Uint8Array; raster: Raster } | null = null;

async function logoOf(bytes: Uint8Array): Promise<Raster> {
  if (lastLogo?.bytes !== bytes) lastLogo = { bytes, raster: await decode(bytes) };
  return lastLogo.raster;
}

/** Logo size: its longer side is 4× the size setting, in % of the photo's shorter side (4 % → 16 %). */
export function logoSize(lw: number, lh: number, short: number, sizePct: number): { width: number; height: number } {
  const target = Math.max(4, (Math.min(100, sizePct * 4) / 100) * short);
  const s = target / Math.max(lw, lh);
  return { width: Math.max(1, Math.round(lw * s)), height: Math.max(1, Math.round(lh * s)) };
}

const watermarkStep: StepFn = async (r, o, ctx) => {
  const short = Math.min(r.width, r.height);
  const size = Math.max(1, Math.min(60, num(o.size, 4)));
  const pos = (POSITIONS.has(str(o.position)) ? str(o.position) : "br") as Position;
  const margin = Math.round((Math.max(0, num(o.margin, 3)) / 100) * short);
  const opacity = Math.max(0.05, Math.min(1, num(o.opacity, 70) / 100));
  let stamp: Raster;
  if (str(o.kind, "text") === "image") {
    const bytes = bytesOf(o.logo);
    if (!bytes?.length) throw new DecodeError("choose a logo image first", "bad-options");
    const logo = await logoOf(bytes);
    const s = logoSize(logo.width, logo.height, short, size);
    stamp = await resize(logo, s.width, s.height);
  } else {
    const text = fillTokens(str(o.text, "© "), ctx.meta, ctx.name);
    if (!text.trim()) return r;
    stamp = renderText(text, {
      size: (size / 100) * short,
      color: parseColor(str(o.color, "#ffffff")),
      font: (FONTS.has(str(o.font)) ? str(o.font) : "sans") as FontName,
      shadow: bool(o.shadow, true),
    });
  }
  const out = clone(r);
  applyStamp(out, stamp, pos, margin, opacity, num(o.angle, -30));
  return out;
};

const captionStep: StepFn = (r, o, ctx) => {
  const text = fillTokens(str(o.text, "{date} · {camera}"), ctx.meta, ctx.name);
  if (!text.trim()) return r;
  const place = str(o.place, "below");
  const px = (Math.max(1, Math.min(12, num(o.size, 3))) / 100) * r.width;
  const align = (["left", "center", "right"].includes(str(o.align)) ? str(o.align) : "center") as "left" | "center" | "right";
  const pad = Math.round(px * 0.8);
  const label = renderText(text, { size: px, color: parseColor(str(o.color, "#1a1a1a")), align, shadow: place !== "below", maxWidth: r.width - pad * 2, weight: 500 });
  const x = align === "left" ? pad : align === "right" ? r.width - pad - label.width : Math.round((r.width - label.width) / 2);
  if (place === "below") {
    const out = raster(r.width, r.height + label.height + pad * 2, parseColor(str(o.band, "#ffffff")));
    draw(out, r, 0, 0);
    draw(out, label, x, r.height + pad);
    return out;
  }
  const out = clone(r);
  draw(out, label, x, place === "top" ? pad : r.height - label.height - pad);
  return out;
};

const STYLES = new Set(["pixelate", "blur", "fill"]);

const redactStep: StepFn = (r, o) => {
  const regions = parseRegions(str(o.regions));
  if (!regions.length) return r;
  const out = clone(r);
  const style = (STYLES.has(str(o.style)) ? str(o.style) : "pixelate") as RedactStyle;
  for (const p of regions) {
    const rect = toPixels(r.width, r.height, p);
    if (rect) redactRect(out, rect, style, num(o.strength, 60), str(o.color, "#000000"));
  }
  return out;
};

export const steps: Record<string, StepFn> = { watermark: watermarkStep, caption: captionStep, redact: redactStep };
export const runs: Record<string, RunFn> = {};
