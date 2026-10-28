// GIF: frames in (omggif) and out (gifenc, with a shared or per-frame palette).

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { GifReader } from "omggif";
import { DecodeError } from "./errors.ts";
import { raster, type Raster } from "./raster.ts";

export interface Frame {
  raster: Raster;
  /** Milliseconds this frame stays on screen. */
  delay: number;
}

/** Every frame of a GIF, composited the way a browser shows them. */
export function decodeGifFrames(bytes: Uint8Array): Frame[] {
  let reader: GifReader;
  try {
    reader = new GifReader(bytes);
  } catch {
    throw new DecodeError("this GIF is damaged");
  }
  const { width, height } = reader;
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames: Frame[] = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    const before = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas as unknown as number[]);
    frames.push({ raster: { width, height, data: canvas.slice() }, delay: Math.max(20, (info.delay || 10) * 10) });
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y++) canvas.fill(0, (y * width + info.x) * 4, (y * width + info.x + info.width) * 4);
    } else if (before) canvas.set(before);
  }
  return frames;
}

export function decodeGif(bytes: Uint8Array): Raster {
  const first = decodeGifFrames(bytes)[0];
  if (!first) throw new DecodeError("this GIF has no frames");
  return first.raster;
}

/** Frames to an animated (or still) GIF that loops forever. */
export function encodeGif(frames: Frame[], o: { colors?: number; loop?: boolean } = {}): Uint8Array {
  const colors = Math.max(2, Math.min(256, o.colors || 256));
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const r = f.raster;
    const hasAlpha = r.data.some((_, k) => k % 4 === 3 && r.data[k]! < 128);
    const palette = quantize(r.data, colors, { format: hasAlpha ? "rgba4444" : "rgb565", oneBitAlpha: hasAlpha, clearAlpha: hasAlpha });
    const index = applyPalette(r.data, palette, hasAlpha ? "rgba4444" : "rgb565");
    const transparentIndex = hasAlpha ? palette.findIndex((c) => c[3] === 0) : -1;
    gif.writeFrame(index, r.width, r.height, {
      palette,
      delay: f.delay,
      repeat: i === 0 && o.loop !== false ? 0 : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: hasAlpha ? 2 : undefined,
    });
  });
  gif.finish();
  return gif.bytes();
}

/** Same size for every frame, letterboxed onto the first frame's canvas. */
export function uniformFrames(frames: Raster[], width: number, height: number, bg: [number, number, number, number]): Raster[] {
  return frames.map((r) => {
    if (r.width === width && r.height === height) return r;
    const out = raster(width, height, bg);
    const scale = Math.min(width / r.width, height / r.height);
    const w = Math.round(r.width * scale);
    const h = Math.round(r.height * scale);
    const ox = Math.floor((width - w) / 2);
    const oy = Math.floor((height - h) / 2);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(r.height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(r.width - 1, Math.floor(x / scale));
        const s = (sy * r.width + sx) * 4;
        out.data.set(r.data.subarray(s, s + 4), ((oy + y) * width + ox + x) * 4);
      }
    }
    return out;
  });
}
