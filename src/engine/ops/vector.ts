// Text without a canvas: glyph outlines from a TrueType font (opentype.js),
// flattened to polygons and filled with the nonzero rule, 4×4 supersampled
// for smooth edges. Used by the command line and the tests; the browser
// draws text with its canvas instead.

import { parse as parseFont } from "opentype.js";
import { raster, type Raster } from "../raster.ts";
import { gaussianBlur } from "./blur.ts";
import type { FontName, TextStyle } from "./text.ts";

type Font = ReturnType<typeof parseFont>;
const fonts = new Map<FontName, Font>();

/** Make fonts available to text drawing where there is no canvas. */
export function registerFonts(map: Partial<Record<FontName, Uint8Array>>) {
  for (const [name, bytes] of Object.entries(map) as [FontName, Uint8Array][]) {
    fonts.set(name, parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
  }
}

export const hasVectorFonts = () => fonts.size > 0;

const fontFor = (s: TextStyle): Font => fonts.get(s.font ?? "sans") ?? fonts.values().next().value!;

export const vectorWidth = (text: string, s: TextStyle) => fontFor(s).getAdvanceWidth(text, s.size);

type Pt = [number, number];

/** Path commands to closed polygons, curves split into short segments. */
function polygons(commands: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let at: Pt = [0, 0];
  for (const c of commands) {
    if (c.type === "M") {
      if (cur.length > 2) out.push(cur);
      at = [c.x!, c.y!];
      cur = [at];
    } else if (c.type === "L") {
      at = [c.x!, c.y!];
      cur.push(at);
    } else if (c.type === "Q") {
      const [x0, y0] = at;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        cur.push([u * u * x0 + 2 * u * t * c.x1! + t * t * c.x!, u * u * y0 + 2 * u * t * c.y1! + t * t * c.y!]);
      }
      at = [c.x!, c.y!];
    } else if (c.type === "C") {
      const [x0, y0] = at;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const u = 1 - t;
        cur.push([
          u * u * u * x0 + 3 * u * u * t * c.x1! + 3 * u * t * t * c.x2! + t * t * t * c.x!,
          u * u * u * y0 + 3 * u * u * t * c.y1! + 3 * u * t * t * c.y2! + t * t * t * c.y!,
        ]);
      }
      at = [c.x!, c.y!];
    } else if (c.type === "Z") {
      if (cur.length > 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

const SS = 4;

/** Coverage (0–1) of the polygons on a width × height grid, nonzero winding. */
function fill(polys: Pt[][], width: number, height: number): Float32Array {
  const cover = new Float32Array(width * height);
  const edges: [number, number, number, number, number][] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]!;
      const [x1, y1] = poly[(i + 1) % poly.length]!;
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
    }
  }
  const xs: [number, number][] = [];
  for (let sy = 0; sy < height * SS; sy++) {
    const y = (sy + 0.5) / SS;
    xs.length = 0;
    for (const [x0, y0, x1, y1, dir] of edges) if (y >= y0 && y < y1) xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), dir]);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a[0] - b[0]);
    const row = Math.floor(sy / SS) * width;
    let winding = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      winding += xs[i]![1];
      if (!winding) continue;
      // Horizontal coverage, sampled SS times per pixel.
      const a = xs[i]![0] * SS;
      const b = xs[i + 1]![0] * SS;
      for (let sx = Math.max(0, Math.ceil(a - 0.5)); sx < Math.min(width * SS, Math.ceil(b - 0.5)); sx++) cover[row + (sx >> 2)]! += 1 / (SS * SS);
    }
  }
  return cover;
}

export function vectorText(lines: string[], s: TextStyle): Raster {
  const font = fontFor(s);
  const lh = Math.round(s.size * (s.lineHeight ?? 1.25));
  const pad = Math.ceil(s.size * (s.shadow ? 0.35 : 0.1));
  const widths = lines.map((l) => font.getAdvanceWidth(l, s.size));
  const width = Math.ceil(Math.max(1, ...widths)) + pad * 2;
  const height = lh * lines.length + pad * 2;
  const ascent = (font.ascender / font.unitsPerEm) * s.size;
  const descent = (-font.descender / font.unitsPerEm) * s.size;
  const polys: Pt[][] = [];
  lines.forEach((l, i) => {
    const x = s.align === "center" ? (width - widths[i]!) / 2 : s.align === "right" ? width - pad - widths[i]! : pad;
    // Centre the line box on its baseline like the canvas's textBaseline "middle".
    const baseline = pad + lh * i + lh / 2 + (ascent - descent) / 2;
    polys.push(...polygons(font.getPath(l, x, baseline, s.size).commands as never));
  });
  const cover = fill(polys, width, height);
  const out = raster(width, height);
  const [r, g, b, a] = s.color;
  if (s.shadow) {
    const shadow = raster(width, height);
    const dy = Math.round(s.size * 0.04);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const c = cover[y * width + x]!;
      if (c > 0 && y + dy < height) shadow.data[((y + dy) * width + x) * 4 + 3] = Math.min(255, c * 255 * 0.55);
    }
    const blurred = gaussianBlur(shadow, Math.max(1, s.size * 0.125));
    out.data.set(blurred.data);
  }
  for (let i = 0; i < cover.length; i++) {
    const c = Math.min(1, cover[i]!) * (a / 255);
    if (c <= 0) continue;
    const p = i * 4;
    const sa = out.data[p + 3]! / 255;
    const oa = c + sa * (1 - c);
    out.data[p] = (r * c) / oa;
    out.data[p + 1] = (g * c) / oa;
    out.data[p + 2] = (b * c) / oa;
    out.data[p + 3] = oa * 255;
  }
  return out;
}
