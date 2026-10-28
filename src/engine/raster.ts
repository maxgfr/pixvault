// The one pixel format every operation works on: 8-bit RGBA, straight
// (not premultiplied) alpha, rows top to bottom. Same shape as ImageData, so
// a Raster goes to a canvas or a codec as it is.

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Refuse images whose pixels alone would not fit in memory (a "pixel bomb"). */
export const MAX_PIXELS = 160_000_000;

export function raster(width: number, height: number, fill?: [number, number, number, number]): Raster {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width * height > MAX_PIXELS) throw new RangeError(`${width}×${height} is too large to process here`);
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    const [r, g, b, a] = fill;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

export const clone = (r: Raster): Raster => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) });

/** A Raster from anything ImageData-shaped (codec output, canvas). */
export function fromImageData(img: { width: number; height: number; data: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset?: number; byteLength?: number } }): Raster {
  const d = img.data;
  const data = d instanceof Uint8ClampedArray ? d : new Uint8ClampedArray(d.buffer, d.byteOffset ?? 0, img.width * img.height * 4);
  return { width: img.width, height: img.height, data };
}

/**
 * True when no pixel shows real transparency. Alpha ≥ 250 counts as opaque:
 * HEIC and some PNG exports carry an alpha plane with stray 254s that no one
 * can see, and treating them as transparent would turn photos into PNGs.
 */
export function opaque(r: Raster): boolean {
  const d = r.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]! < 250) return false;
  return true;
}

/** Flatten transparency onto a solid colour (for formats without alpha). */
export function flatten(r: Raster, bg: [number, number, number] = [255, 255, 255]): Raster {
  if (r.data.every((v, i) => i % 4 !== 3 || v === 255)) return r;
  const out = clone(r);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    d[i] = d[i]! * a + bg[0] * (1 - a);
    d[i + 1] = d[i + 1]! * a + bg[1] * (1 - a);
    d[i + 2] = d[i + 2]! * a + bg[2] * (1 - a);
    d[i + 3] = 255;
  }
  return out;
}

/** "#rrggbb" or "#rrggbbaa" to RGBA. */
export function parseColor(hex: string | undefined, fallback: [number, number, number, number] = [255, 255, 255, 255]): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex?.trim() ?? "");
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
