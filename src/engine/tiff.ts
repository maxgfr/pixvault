// TIFF in and out (UTIF): the first page, as RGBA.

import * as UTIF from "utif2";
import { DecodeError } from "./errors.ts";
import { MAX_PIXELS, type Raster } from "./raster.ts";

export function decodeTiff(bytes: Uint8Array): Raster {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let ifds: UTIF.IFD[];
  try {
    ifds = UTIF.decode(buf);
  } catch {
    throw new DecodeError("this TIFF is damaged");
  }
  // The largest page that carries an image (some TIFFs lead with a thumbnail).
  const page = ifds
    .filter((i) => i.t256 && i.t257)
    .sort((a, b) => Number((b.t256 as number[])[0]) * Number((b.t257 as number[])[0]) - Number((a.t256 as number[])[0]) * Number((a.t257 as number[])[0]))[0];
  if (!page) throw new DecodeError("this TIFF has no image");
  const w = Number((page.t256 as number[])[0]);
  const h = Number((page.t257 as number[])[0]);
  if (w * h > MAX_PIXELS) throw new DecodeError(`${w}×${h} is too large to process here`, "too-large");
  UTIF.decodeImage(buf, page);
  const rgba = UTIF.toRGBA8(page);
  return { width: page.width as number, height: page.height as number, data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength) };
}

export function encodeTiff(r: Raster): Uint8Array {
  return new Uint8Array(UTIF.encodeImage(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), r.width, r.height));
}
