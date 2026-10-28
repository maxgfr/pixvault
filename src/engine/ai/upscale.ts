// Super-resolution with Swin2SR, tile by tile so any photo fits in memory.
// Tiles overlap and each keeps only its centre, so no seam shows. Alpha is
// enlarged separately with Lanczos.

import { raster, type Raster } from "../raster.ts";
import { resize } from "../resize.ts";
import type { Ctx } from "../run/types.ts";
import { hasWebGPU, ort, session } from "./runtime.ts";

const OVERLAP = 8;

/** Tile origins along one side: every tile is `tile` long, the last one flush with the edge. */
export function tileStarts(length: number, tile: number): number[] {
  if (length <= tile) return [0];
  const out: number[] = [];
  for (let x = 0; x + tile < length; x += tile - OVERLAP) out.push(x);
  out.push(length - tile);
  return out;
}

export async function upscale(r: Raster, scale: 2 | 4, ctx?: Pick<Ctx, "progress" | "check">): Promise<Raster> {
  const o = await ort();
  const s = await session(scale === 4 ? "upscale-4" : "upscale-2");
  const tile = (await hasWebGPU()) ? 192 : 64;
  // A photo smaller than a tile is padded by repeating its edge.
  const tw = Math.min(tile, Math.ceil(r.width / 8) * 8);
  const th = Math.min(tile, Math.ceil(r.height / 8) * 8);
  const xs = tileStarts(Math.max(r.width, tw), tw);
  const ys = tileStarts(Math.max(r.height, th), th);
  const out = raster(r.width * scale, r.height * scale);
  const total = xs.length * ys.length;
  let done = 0;
  for (const y0 of ys) {
    for (const x0 of xs) {
      ctx?.check();
      const plane = tw * th;
      const input = new Float32Array(3 * plane);
      for (let y = 0; y < th; y++) {
        const sy = Math.min(r.height - 1, y0 + y);
        for (let x = 0; x < tw; x++) {
          const sx = Math.min(r.width - 1, x0 + x);
          const p = (sy * r.width + sx) * 4;
          for (let c = 0; c < 3; c++) input[c * plane + y * tw + x] = r.data[p + c]! / 255;
        }
      }
      const res = (await s.run({ pixel_values: new o.Tensor("float32", input, [1, 3, th, tw]) })).reconstruction!;
      const data = res.data as Float32Array;
      const ow = res.dims[3]!;
      const oh = res.dims[2]!;
      const oplane = ow * oh;
      // Keep the tile's centre: half the overlap is trimmed on every shared side.
      const left = x0 > 0 ? OVERLAP / 2 : 0;
      const top = y0 > 0 ? OVERLAP / 2 : 0;
      const right = Math.min(r.width, x0 + tw) - (x0 + tw < r.width ? OVERLAP / 2 : 0);
      const bottom = Math.min(r.height, y0 + th) - (y0 + th < r.height ? OVERLAP / 2 : 0);
      for (let y = (y0 + top) * scale; y < bottom * scale; y++) {
        const ty = y - y0 * scale;
        if (ty >= oh) break;
        for (let x = (x0 + left) * scale; x < right * scale; x++) {
          const tx = x - x0 * scale;
          if (tx >= ow) break;
          const p = (y * out.width + x) * 4;
          const q = ty * ow + tx;
          out.data[p] = data[q]! * 255;
          out.data[p + 1] = data[oplane + q]! * 255;
          out.data[p + 2] = data[2 * oplane + q]! * 255;
          out.data[p + 3] = 255;
        }
      }
      ctx?.progress(++done, total);
    }
  }
  if (r.data.some((v, i) => i % 4 === 3 && v !== 255)) {
    const alpha = await resize(r, out.width, out.height);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = alpha.data[i]!;
  }
  return out;
}
