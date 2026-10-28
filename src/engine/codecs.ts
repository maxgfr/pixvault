// Decode any supported file to a Raster, and encode a Raster to any output
// format. The browser's own decoder is tried first (fast, applies EXIF
// orientation); the wasm decoders cover what it cannot read, and the tests.

import { defaultOptions as avifDefaults } from "@jsquash/avif/meta.js";
import avifDecFactory from "@jsquash/avif/codec/dec/avif_dec.js";
import avifEncFactory from "@jsquash/avif/codec/enc/avif_enc.js";
import { defaultOptions as jpegDefaults } from "@jsquash/jpeg/meta.js";
import jpegDecFactory from "@jsquash/jpeg/codec/dec/mozjpeg_dec.js";
import jpegEncFactory from "@jsquash/jpeg/codec/enc/mozjpeg_enc.js";
import { initEmscriptenModule } from "@jsquash/jpeg/utils.js";
import { defaultOptions as jxlDefaults } from "@jsquash/jxl/meta.js";
import jxlDecFactory from "@jsquash/jxl/codec/dec/jxl_dec.js";
import jxlEncFactory from "@jsquash/jxl/codec/enc/jxl_enc.js";
import initOxipng, { optimise_raw } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import initPng, { decode as pngDecode, encode as pngEncode } from "@jsquash/png/codec/pkg/squoosh_png.js";
import qoiDecFactory from "@jsquash/qoi/codec/dec/qoi_dec.js";
import qoiEncFactory from "@jsquash/qoi/codec/enc/qoi_enc.js";
import { defaultOptions as webpDefaults } from "@jsquash/webp/meta.js";
import webpDecFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import webpEncFactory from "@jsquash/webp/codec/enc/webp_enc_simd.js";
import { decodeBmp, encodeBmp } from "./bmp.ts";
import { DecodeError } from "./errors.ts";
import { type Format, FORMATS, type OutFormat, sniff } from "./formats.ts";
import { decodeGif, encodeGif } from "./gif.ts";
import { decodeHeif } from "./heif.ts";
import { decodeIco, encodeIco } from "./ico.ts";
import { rawPreview } from "./raw.ts";
import { flatten, fromImageData, MAX_PIXELS, type Raster } from "./raster.ts";
import { decodeTiff, encodeTiff } from "./tiff.ts";
import { once, wasm, type WasmName } from "./wasm.ts";

export { DecodeError };

// Emscripten modules are untyped at this level.
type Emscripten = any;

const emscripten = (factory: unknown, name: WasmName) =>
  once<Emscripten>(async () => initEmscriptenModule(factory as never, await wasm(name)));

const jpegEnc = emscripten(jpegEncFactory, "jpeg-enc");
const jpegDec = emscripten(jpegDecFactory, "jpeg-dec");
const webpEnc = emscripten(webpEncFactory, "webp-enc");
const webpDec = emscripten(webpDecFactory, "webp-dec");
const avifEnc = emscripten(avifEncFactory, "avif-enc");
const avifDec = emscripten(avifDecFactory, "avif-dec");
const jxlEnc = emscripten(jxlEncFactory, "jxl-enc");
const jxlDec = emscripten(jxlDecFactory, "jxl-dec");
const qoiEnc = emscripten(qoiEncFactory, "qoi-enc");
const qoiDec = emscripten(qoiDecFactory, "qoi-dec");
const png = once(async () => initPng(await wasm("png")));
const oxipng = once(async () => initOxipng(await wasm("oxipng")));

/** Decode with the browser (createImageBitmap + OffscreenCanvas), or null where it cannot. */
async function nativeDecode(bytes: Uint8Array, mime: string): Promise<Raster | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" });
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) throw new DecodeError(`${bitmap.width}×${bitmap.height} is too large to process here`, "too-large");
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      return fromImageData(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
    } finally {
      bitmap.close();
    }
  } catch (e) {
    if (e instanceof DecodeError) throw e;
    return null;
  }
}

function wasmResult(img: unknown, label: string): Raster {
  if (!img) throw new DecodeError(`this ${label} file could not be read`);
  return fromImageData(img as Raster);
}

/** Any supported file to pixels, upright. */
export async function decode(bytes: Uint8Array, name = ""): Promise<Raster> {
  const format = sniff(bytes, name);
  if (!format) throw new DecodeError("this is not an image format pixvault reads", "unsupported");
  return decodeAs(bytes, format);
}

export async function decodeAs(bytes: Uint8Array, format: Format): Promise<Raster> {
  // The browser reads these natively almost everywhere; HEIC only in Safari, JPEG XL only in Safari.
  if (format !== "raw" && format !== "tiff" && format !== "qoi" && format !== "svg") {
    const native = await nativeDecode(bytes, FORMATS[format].mime);
    if (native) return native;
  }
  switch (format) {
    case "jpeg": {
      const { orientJpeg } = await import("./orient.ts");
      return orientJpeg(bytes, wasmResult((await jpegDec()).decode(bytes, false), "JPEG"));
    }
    case "png":
      await png();
      return wasmResult(pngDecode(bytes), "PNG");
    case "webp":
      return wasmResult((await webpDec()).decode(bytes), "WebP");
    case "avif":
      return wasmResult((await avifDec()).decode(bytes, 8), "AVIF");
    case "jxl":
      return wasmResult((await jxlDec()).decode(bytes), "JPEG XL");
    case "qoi":
      return wasmResult((await qoiDec()).decode(bytes), "QOI");
    case "gif":
      return decodeGif(bytes);
    case "bmp":
      return decodeBmp(bytes);
    case "ico":
      return decodeIco(bytes, (b) => decode(b));
    case "tiff":
      return decodeTiff(bytes);
    case "heic":
      return decodeHeif(bytes);
    case "raw": {
      const preview = rawPreview(bytes);
      if (!preview) throw new DecodeError("this RAW file has no embedded full-size preview pixvault can read", "no-preview");
      return decodeAs(preview, "jpeg");
    }
    case "svg":
      throw new DecodeError("SVG is rasterised by the page before it gets here");
  }
}

export interface EncodeOptions {
  /** 0–100 for lossy formats. */
  quality?: number;
  lossless?: boolean;
  /** 0 (fastest) to 9 (smallest), for the slow encoders. */
  effort?: number;
  /** Colours for a palette PNG or a GIF (2–256); 0 keeps full colour for PNG. */
  colors?: number;
  progressive?: boolean;
  /** Background for formats without transparency, "#rrggbb". */
  background?: [number, number, number];
  /** ICO sizes, largest first; defaults to the common favicon set. */
  icoSizes?: number[];
}

const clampQ = (q: number | undefined, d: number) => Math.max(0, Math.min(100, Math.round(q ?? d)));

/** Pixels to a file. */
export async function encode(r: Raster, format: OutFormat, o: EncodeOptions = {}): Promise<Uint8Array> {
  const effort = Math.max(0, Math.min(9, o.effort ?? 4));
  switch (format) {
    case "jpeg": {
      const flat = flatten(r, o.background);
      const out: Uint8Array = (await jpegEnc()).encode(flat.data, flat.width, flat.height, {
        ...jpegDefaults,
        quality: clampQ(o.quality, 82),
        progressive: o.progressive ?? true,
        optimize_coding: true,
        trellis_multipass: effort >= 6,
      });
      return out.slice();
    }
    case "webp": {
      const out: Uint8Array = (await webpEnc()).encode(r.data, r.width, r.height, {
        ...webpDefaults,
        quality: o.lossless ? 100 : clampQ(o.quality, 80),
        lossless: o.lossless ? 1 : 0,
        method: Math.min(6, Math.round(effort * 0.67)),
        exact: o.lossless ? 1 : 0,
      });
      if (!out) throw new Error("WebP encoding failed");
      return out.slice();
    }
    case "avif": {
      const q = o.lossless ? 100 : clampQ(o.quality, 60);
      const out: Uint8Array | null = (await avifEnc()).encode(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), r.width, r.height, {
        ...avifDefaults,
        quality: q,
        qualityAlpha: o.lossless ? -1 : q,
        subsample: o.lossless ? 3 : 1,
        // libavif speed runs 0 (slowest) to 10; effort 4 → speed 6.
        speed: Math.max(0, Math.min(10, 10 - effort)),
      });
      if (!out) throw new Error("AVIF encoding failed");
      return out.slice();
    }
    case "jxl": {
      const out: Uint8Array | null = (await jxlEnc()).encode(r.data, r.width, r.height, {
        ...jxlDefaults,
        quality: o.lossless ? 100 : clampQ(o.quality, 75),
        lossless: Boolean(o.lossless),
        effort: Math.max(1, Math.min(9, effort + 3)),
      });
      if (!out) throw new Error("JPEG XL encoding failed");
      return out.slice();
    }
    case "png": {
      const colors = o.colors ?? 0;
      const src = colors >= 2 && colors <= 256 ? (await import("./quantize.ts")).quantize(r, colors).raster : r;
      // OxiPNG writes the smallest valid PNG it finds, and turns ≤256 colours into a palette by itself.
      await oxipng();
      return optimise_raw(src.data, src.width, src.height, Math.max(1, Math.min(6, Math.round(effort * 0.67))), false, true).slice();
    }
    case "qoi": {
      const out: Uint8Array = (await qoiEnc()).encode(r.data, r.width, r.height);
      return out.slice();
    }
    case "gif":
      return encodeGif([{ raster: r, delay: 0 }], { colors: o.colors });
    case "bmp":
      return encodeBmp(flatten(r, o.background));
    case "tiff":
      return encodeTiff(r);
    case "ico":
      return encodeIco(r, o.icoSizes);
  }
}

/** A plain, fast lossless PNG (no OxiPNG pass), for previews and intermediates. */
export async function encodePngFast(r: Raster): Promise<Uint8Array> {
  await png();
  return pngEncode(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), r.width, r.height, 8).slice();
}
