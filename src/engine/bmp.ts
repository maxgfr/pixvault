// BMP: 24-bit writer, and a reader for the common uncompressed and bitfield variants.

import { DecodeError } from "./errors.ts";
import { raster, type Raster } from "./raster.ts";

export function encodeBmp(r: Raster): Uint8Array {
  const { width: w, height: h, data } = r;
  const stride = (w * 3 + 3) & ~3;
  const size = 54 + stride * h;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, stride * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = data[i + 2]!;
      out[o++] = data[i + 1]!;
      out[o++] = data[i]!;
    }
  }
  return out;
}

/** A DIB (BMP without its 14-byte file header, as inside ICO files) or a whole BMP. */
export function decodeBmp(bytes: Uint8Array, dibOnly = false, icoHeight = false): Raster {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = dibOnly ? 0 : 14;
  const headerSize = v.getUint32(base, true);
  const w = v.getInt32(base + 4, true);
  let h = v.getInt32(base + 8, true);
  if (icoHeight) h = h / 2;
  const bpp = v.getUint16(base + 14, true);
  const compression = v.getUint32(base + 16, true);
  const topDown = h < 0;
  h = Math.abs(h);
  if (w <= 0 || h <= 0 || ![1, 4, 8, 24, 32].includes(bpp) || (compression !== 0 && compression !== 3)) {
    throw new DecodeError("this BMP variant cannot be read; save it as PNG first", "unsupported");
  }
  const colors = bpp <= 8 ? v.getUint32(base + 32, true) || 1 << bpp : 0;
  const paletteAt = base + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const pixelsAt = dibOnly ? paletteAt + colors * 4 : v.getUint32(10, true);
  const stride = ((w * bpp + 31) >> 5) << 2;
  const out = raster(w, h);
  const d = out.data;
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const row = pixelsAt + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (bpp === 24 || bpp === 32) {
        const p = row + x * (bpp / 8);
        d[i] = bytes[p + 2]!;
        d[i + 1] = bytes[p + 1]!;
        d[i + 2] = bytes[p]!;
        d[i + 3] = bpp === 32 ? bytes[p + 3]! : 255;
        if (bpp === 32 && bytes[p + 3]) anyAlpha = true;
      } else {
        const bit = x * bpp;
        const byte = bytes[row + (bit >> 3)]!;
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = paletteAt + idx * 4;
        d[i] = bytes[c + 2]!;
        d[i + 1] = bytes[c + 1]!;
        d[i + 2] = bytes[c]!;
        d[i + 3] = 255;
      }
    }
  }
  // 32-bit BMPs often leave alpha at zero: treat them as opaque.
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return out;
}
