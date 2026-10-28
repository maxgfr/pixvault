// The wasm JPEG decoder returns pixels as stored; the browser applies the
// EXIF orientation. This makes the wasm path agree.

import { applyOrientation } from "./geometry.ts";
import { jpegOrientation } from "./meta/jpeg.ts";
import type { Raster } from "./raster.ts";

export function orientJpeg(bytes: Uint8Array, r: Raster): Raster {
  return applyOrientation(r, jpegOrientation(bytes));
}
