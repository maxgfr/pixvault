// Turn pixels back into a file the way the user asked: format ("keep" picks
// a sensible one), quality, and which photo details travel with it.

import type { Options } from "../tools/types.ts";
import { encode, type EncodeOptions } from "./codecs.ts";
import { type Format, FORMATS, type OutFormat, rename } from "./formats.ts";
import { carryMeta, type MetaMode } from "./meta/carry.ts";
import type { PhotoMeta } from "./meta/types.ts";
import { opaque, parseColor, type Raster } from "./raster.ts";
import { num, type Output, str } from "./run/types.ts";

const ENCODABLE = new Set<string>(["jpeg", "png", "webp", "avif", "jxl", "gif", "bmp", "tiff", "qoi", "ico"]);

/** The format to write for "keep": the source's when we can write it, else JPEG (photos) or PNG (transparency, graphics). */
export function keepFormat(source: Format, r: Raster): OutFormat {
  if (ENCODABLE.has(source)) {
    if (source === "jpeg" || source === "bmp") return opaque(r) ? source : "png";
    return source as OutFormat;
  }
  if (source === "svg") return "png";
  return opaque(r) ? "jpeg" : "png";
}

export interface OutputSource {
  name: string;
  bytes: Uint8Array;
  format: Format;
  meta: PhotoMeta;
}

export async function writeOutput(r: Raster, o: Options, src: OutputSource, extra: EncodeOptions = {}): Promise<Output> {
  const asked = str(o.format, "keep");
  const format: OutFormat = asked === "keep" || !ENCODABLE.has(asked) ? keepFormat(src.format, r) : (asked as OutFormat);
  const bytes = await encode(r, format, { quality: num(o.quality, 85), background: parseColor(str(o.background, "#ffffff")).slice(0, 3) as [number, number, number], ...extra });
  const mode = (str(o.metadata, "no-gps") as MetaMode) || "no-gps";
  const withMeta = await carryMeta(bytes, format, src.bytes, src.format, src.meta, mode);
  return { name: rename(src.name, FORMATS[format].ext), bytes: withMeta, mime: FORMATS[format].mime };
}
