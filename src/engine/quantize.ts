// Reduce to N colours (PNG palette, GIF), with gifenc's PnnQuant.

import { applyPalette, quantize as pnn } from "gifenc";
import type { Raster } from "./raster.ts";

export function quantize(r: Raster, colors: number): { raster: Raster; palette: number[][] } {
  const alpha = r.data.some((_, i) => i % 4 === 3 && r.data[i] !== 255);
  const format = alpha ? "rgba4444" : "rgb565";
  const palette = pnn(r.data, Math.max(2, Math.min(256, colors)), { format });
  const index = applyPalette(r.data, palette, format);
  const out = new Uint8ClampedArray(r.data.length);
  for (let i = 0; i < index.length; i++) {
    const c = palette[index[i]!]!;
    out[i * 4] = c[0]!;
    out[i * 4 + 1] = c[1]!;
    out[i * 4 + 2] = c[2]!;
    out[i * 4 + 3] = alpha ? (c[3] ?? 255) : 255;
  }
  return { raster: { width: r.width, height: r.height, data: out }, palette };
}
