// When a photo is re-encoded, its details are lost with the old file. This
// writes them into the new one: the original EXIF when there is one (minus
// what no longer applies), or a fresh EXIF from the parsed details.

import type { Format, OutFormat } from "../formats.ts";
import { dimensions, locateExif, MAX_JPEG_EXIF, setMeta } from "./containers.ts";
import { applyMeta, drop, emptyDoc, long, parseTiff, put, serializeTiff, short, TAG, type TiffDoc } from "./exif-write.ts";
import type { PhotoMeta } from "./types.ts";

export type MetaMode = "keep" | "no-gps" | "strip";

/** Tags of IFD0 that describe the old file's pixels, not the photo. */
const LAYOUT = [0x0100, 0x0101, 0x0102, 0x0103, 0x0106, 0x0111, 0x0115, 0x0116, 0x0117, 0x011c, 0x0211, 0x0212, 0x0213, 0x014a, TAG.XMP, TAG.IPTC, TAG.Photoshop, 0xc612, 0xc614];

/** The EXIF to write for the output: source EXIF when it exists and is safe to reuse, else built from `meta`. */
export function exifFor(source: Uint8Array, sourceFormat: Format, meta: PhotoMeta, mode: "keep" | "no-gps", size?: { width: number; height: number }): Uint8Array | null {
  let doc: TiffDoc | null = null;
  // TIFF and RAW files are themselves TIFF: their IFD0 is image layout, so rebuild from the details instead.
  if (sourceFormat !== "tiff" && sourceFormat !== "raw") {
    const loc = locateExif(source, sourceFormat);
    if (loc) doc = parseTiff(source.subarray(loc.at, loc.at + loc.len));
  }
  if (doc) {
    doc.ifd0 = drop(doc.ifd0, ...LAYOUT);
    // The maker note's offsets point into the old file, and it holds serial numbers: it does not travel.
    doc.exif = drop(doc.exif, TAG.MakerNote, TAG.PixelXDimension, TAG.PixelYDimension);
    // The old thumbnail shows the old picture (possibly before a crop).
    doc.ifd1 = [];
    doc.thumbnail = undefined;
  } else {
    const { width: _w, height: _h, gps, ...rest } = meta;
    if (!Object.values(rest).some((v) => v !== undefined) && !gps) return null;
    doc = applyMeta(emptyDoc(true), { ...rest, gps });
  }
  // The new pixels are upright.
  put(doc.ifd0, short(TAG.Orientation, 1, doc.le));
  if (size && doc.exif.length) {
    put(doc.exif, long(TAG.PixelXDimension, size.width, doc.le));
    put(doc.exif, long(TAG.PixelYDimension, size.height, doc.le));
  }
  if (mode === "no-gps") doc.gps = [];
  let out = serializeTiff(doc);
  if (out.length > MAX_JPEG_EXIF) {
    doc.exif = drop(doc.exif, TAG.UserComment);
    out = serializeTiff(doc);
    if (out.length > MAX_JPEG_EXIF) return null;
  }
  return out;
}

export async function carryMeta(out: Uint8Array, format: OutFormat, source: Uint8Array, sourceFormat: Format, meta: PhotoMeta, mode: MetaMode): Promise<Uint8Array> {
  if (mode === "strip" || (format !== "jpeg" && format !== "png" && format !== "webp")) return out;
  const exif = exifFor(source, sourceFormat, meta, mode === "keep" ? "keep" : "no-gps", dimensions(out, format) ?? undefined);
  return exif ? setMeta(out, { exif }) : out;
}
