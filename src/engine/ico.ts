// ICO: written with PNG entries (every browser and Windows Vista+ read them),
// read from PNG or BMP entries, keeping the largest.

import { decodeBmp } from "./bmp.ts";
import { DecodeError } from "./errors.ts";
import type { Raster } from "./raster.ts";

export const FAVICON_SIZES = [256, 128, 64, 48, 32, 16];

export async function encodeIco(r: Raster, sizes: number[] = FAVICON_SIZES): Promise<Uint8Array> {
  const { resize } = await import("./resize.ts");
  const { encodePngFast } = await import("./codecs.ts");
  const { squareFit } = await import("./ops/canvas.ts");
  const square = squareFit(r);
  const entries: { size: number; png: Uint8Array }[] = [];
  for (const size of [...new Set(sizes)].filter((s) => s >= 1 && s <= 256).sort((a, b) => b - a)) {
    entries.push({ size, png: await encodePngFast(await resize(square, size, size)) });
  }
  const header = 6 + 16 * entries.length;
  const total = header + entries.reduce((n, e) => n + e.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let offset = header;
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    out[at] = e.size >= 256 ? 0 : e.size;
    out[at + 1] = e.size >= 256 ? 0 : e.size;
    v.setUint16(at + 4, 1, true);
    v.setUint16(at + 6, 32, true);
    v.setUint32(at + 8, e.png.length, true);
    v.setUint32(at + 12, offset, true);
    out.set(e.png, offset);
    offset += e.png.length;
  });
  return out;
}

export async function decodeIco(bytes: Uint8Array, decodePng: (b: Uint8Array) => Promise<Raster>): Promise<Raster> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint16(4, true);
  let best: { size: number; at: number; len: number } | null = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) break;
    const size = (bytes[at] || 256) * (bytes[at + 1] || 256);
    const len = v.getUint32(at + 8, true);
    const off = v.getUint32(at + 12, true);
    if (off + len <= bytes.length && (!best || size > best.size)) best = { size, at: off, len };
  }
  if (!best) throw new DecodeError("this icon file is empty or damaged");
  const entry = bytes.subarray(best.at, best.at + best.len);
  if (entry[0] === 0x89 && entry[1] === 0x50) return decodePng(entry);
  return decodeBmp(entry, true, true);
}
