// Text as pixels: watermarks, captions, labels. In the browser the canvas
// draws it (OffscreenCanvas works in workers) with system fonts: the CSP
// loads nothing from elsewhere, and system-ui reads well in every language.
// Without a canvas (the command line, the tests) the glyph outlines of the
// registered fonts are filled here (vector.ts).

import { DecodeError } from "../errors.ts";
import type { Raster } from "../raster.ts";
import { hasVectorFonts, vectorText, vectorWidth } from "./vector.ts";

export const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export type FontName = keyof typeof FONTS;

export interface TextStyle {
  /** Pixel size of the font. */
  size: number;
  color: [number, number, number, number];
  font?: FontName;
  weight?: number;
  align?: "left" | "center" | "right";
  /** Soft dark shadow behind light text, for legibility on photos. */
  shadow?: boolean;
  /** Wrap lines longer than this many pixels. */
  maxWidth?: number;
  lineHeight?: number;
}

const hasCanvas = () => typeof OffscreenCanvas === "function";

export const canDrawText = () => hasCanvas() || hasVectorFonts();

function context(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!canDrawText()) throw new DecodeError("drawing text needs a browser canvas", "unsupported");
  const ctx = new OffscreenCanvas(Math.max(1, w), Math.max(1, h)).getContext("2d");
  if (!ctx) throw new DecodeError("drawing text needs a browser canvas", "unsupported");
  return ctx;
}

const fontOf = (s: TextStyle) => `${s.weight ?? 600} ${Math.max(1, Math.round(s.size))}px ${FONTS[s.font ?? "sans"]}`;

/** Split text into lines that fit maxWidth (explicit newlines kept). */
export function wrap(text: string, s: TextStyle): string[] {
  let measure: (t: string) => number;
  if (hasCanvas()) {
    const ctx = context(1, 1);
    ctx.font = fontOf(s);
    measure = (t) => ctx.measureText(t).width;
  } else measure = (t) => vectorWidth(t, s);
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!s.maxWidth) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > s.maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** The text drawn on a transparent raster just big enough to hold it. */
export function renderText(text: string, s: TextStyle): Raster {
  if (!hasCanvas()) {
    if (!hasVectorFonts()) throw new DecodeError("drawing text needs a browser canvas", "unsupported");
    return vectorText(wrap(text, s), s);
  }
  const lines = wrap(text, s);
  const lh = Math.round(s.size * (s.lineHeight ?? 1.25));
  const pad = Math.ceil(s.size * (s.shadow ? 0.35 : 0.1));
  const measure = context(1, 1);
  measure.font = fontOf(s);
  const width = Math.ceil(Math.max(1, ...lines.map((l) => measure.measureText(l).width))) + pad * 2;
  const height = lh * lines.length + pad * 2;
  const ctx = context(width, height);
  ctx.font = fontOf(s);
  ctx.textBaseline = "middle";
  ctx.textAlign = s.align ?? "left";
  const [r, g, b, a] = s.color;
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
  if (s.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = s.size * 0.25;
    ctx.shadowOffsetY = s.size * 0.04;
  }
  const x = s.align === "center" ? width / 2 : s.align === "right" ? width - pad : pad;
  lines.forEach((l, i) => ctx.fillText(l, x, pad + lh * i + lh / 2));
  const img = ctx.getImageData(0, 0, width, height);
  return { width, height, data: img.data };
}
