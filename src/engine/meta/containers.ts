// Where metadata lives in each container, and how to change it without
// touching the compressed image: JPEG segments, PNG chunks, WebP RIFF
// chunks are rebuilt; anywhere else (HEIC, AVIF, TIFF, RAW) EXIF is
// scrubbed in place, byte for byte, so every offset in the file stays valid.

import { type Format, sniff } from "../formats.ts";
import { reader, TAG, tiffOrder, TYPE_SIZE } from "./exif-write.ts";
import { appSegment, isJpeg, kindOf, rebuild, segments } from "./jpeg.ts";

const enc = new TextEncoder();
const latin1 = new TextDecoder("latin1");
const EXIF_HEADER = enc.encode("Exif\0\0");
const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

// ── PNG ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < b.length; i++) crc = CRC_TABLE[(crc ^ b[i]!) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface Chunk {
  type: string;
  /** Offset of the length field. */
  at: number;
  /** Data length. */
  len: number;
}

export function pngChunks(b: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  while (p + 12 <= b.length) {
    const len = v.getUint32(p);
    if (p + 12 + len > b.length) break;
    out.push({ type: latin1.decode(b.subarray(p + 4, p + 8)), at: p, len });
    p += 12 + len;
  }
  return out;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(enc.encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const pngText = (b: Uint8Array, c: Chunk) => latin1.decode(b.subarray(c.at + 8, c.at + 8 + Math.min(c.len, 80)));
const isPngXmp = (b: Uint8Array, c: Chunk) => c.type === "iTXt" && pngText(b, c).startsWith("XML:com.adobe.xmp\0");
const isPngRawExif = (b: Uint8Array, c: Chunk) => (c.type === "tEXt" || c.type === "zTXt" || c.type === "iTXt") && /^Raw profile type (exif|APP1|xmp|iptc)\0/i.test(pngText(b, c));

/** Rebuild a PNG keeping the chunks `keep` accepts, inserting `add` right after IHDR. */
function pngRebuild(b: Uint8Array, keep: (c: Chunk) => boolean, add: Uint8Array[] = []): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  for (const c of pngChunks(b)) {
    if (c.type === "IHDR") {
      parts.push(b.subarray(c.at, c.at + 12 + c.len), ...add);
      continue;
    }
    if (keep(c)) parts.push(b.subarray(c.at, c.at + 12 + c.len));
  }
  return concat(parts);
}

const pngXmpChunk = (xml: string) => pngChunk("iTXt", concat([enc.encode("XML:com.adobe.xmp\0\0\0\0\0"), enc.encode(xml)]));

// ── WebP ─────────────────────────────────────────────────────────────────

export function webpChunks(b: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12;
  while (p + 8 <= b.length) {
    const len = v.getUint32(p + 4, true);
    if (p + 8 + len > b.length) break;
    out.push({ type: latin1.decode(b.subarray(p, p + 4)), at: p, len });
    p += 8 + len + (len & 1);
  }
  return out;
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1));
  out.set(enc.encode(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/** Canvas size and alpha of a WebP, from its image chunk. */
function webpInfo(b: Uint8Array, chunks: Chunk[]): { w: number; h: number; alpha: boolean } | null {
  for (const c of chunks) {
    const d = c.at + 8;
    if (c.type === "VP8X") return { w: 1 + (b[d + 4]! | (b[d + 5]! << 8) | (b[d + 6]! << 16)), h: 1 + (b[d + 7]! | (b[d + 8]! << 8) | (b[d + 9]! << 16)), alpha: Boolean(b[d]! & 0x10) };
    if (c.type === "VP8 " && b[d + 3] === 0x9d && b[d + 4] === 0x01 && b[d + 5] === 0x2a) {
      return { w: (b[d + 6]! | (b[d + 7]! << 8)) & 0x3fff, h: (b[d + 8]! | (b[d + 9]! << 8)) & 0x3fff, alpha: false };
    }
    if (c.type === "VP8L" && b[d] === 0x2f) {
      const bits = b[d + 1]! | (b[d + 2]! << 8) | (b[d + 3]! << 16) | (b[d + 4]! << 24);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean((bits >>> 28) & 1) };
    }
  }
  return null;
}

/** Rebuild a WebP: chunks `keep` accepts, plus EXIF/XMP at the end, with VP8X flags that match. */
function webpRebuild(b: Uint8Array, keep: (c: Chunk) => boolean, exif?: Uint8Array, xmp?: string): Uint8Array {
  const chunks = webpChunks(b);
  const info = webpInfo(b, chunks);
  const kept = chunks.filter((c) => c.type !== "VP8X" && keep(c));
  const body = kept.map((c) => b.subarray(c.at, c.at + 8 + c.len + (c.len & 1)));
  if (exif) body.push(webpChunk("EXIF", exif));
  if (xmp) body.push(webpChunk("XMP ", enc.encode(xmp)));
  const types = new Set(kept.map((c) => c.type));
  if (exif) types.add("EXIF");
  if (xmp) types.add("XMP ");
  const needsX = types.has("EXIF") || types.has("XMP ") || types.has("ICCP") || types.has("ANIM") || types.has("ALPH");
  const parts: Uint8Array[] = [];
  if (needsX && info) {
    const x = new Uint8Array(10);
    x[0] = (types.has("ICCP") ? 0x20 : 0) | (info.alpha || types.has("ALPH") ? 0x10 : 0) | (types.has("EXIF") ? 0x08 : 0) | (types.has("XMP ") ? 0x04 : 0) | (types.has("ANIM") ? 0x02 : 0);
    const w = info.w - 1;
    const h = info.h - 1;
    x.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 4);
    parts.push(webpChunk("VP8X", x));
  }
  parts.push(...body);
  const payload = concat(parts);
  const out = new Uint8Array(12 + payload.length);
  out.set(enc.encode("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, payload.length + 4, true);
  out.set(enc.encode("WEBP"), 8);
  out.set(payload, 12);
  return out;
}

// ── Writing EXIF and XMP ─────────────────────────────────────────────────

/** Formats whose EXIF and XMP pixvault can rewrite losslessly. */
export const REWRITABLE = new Set<Format>(["jpeg", "png", "webp"]);

/** Largest EXIF payload a JPEG APP1 segment holds. */
export const MAX_JPEG_EXIF = 65533 - EXIF_HEADER.length;

/**
 * Replace the EXIF (when `exif` is given; null removes it) and the XMP
 * (when `xmp` is given; null removes it) of a JPEG, PNG or WebP. Anything
 * else is returned as is.
 */
export function setMeta(b: Uint8Array, change: { exif?: Uint8Array | null; xmp?: string | null }): Uint8Array {
  const format = sniff(b);
  const { exif, xmp } = change;
  if (format === "jpeg") {
    const insert: Uint8Array[] = [];
    if (exif && exif.length <= MAX_JPEG_EXIF) insert.push(appSegment(0xe1, concat([EXIF_HEADER, exif])));
    if (xmp) {
      const payload = concat([enc.encode(XMP_NS), enc.encode(xmp)]);
      if (payload.length <= 65533) insert.push(appSegment(0xe1, payload));
    }
    return rebuild(b, (kind) => !(kind === "exif" && exif !== undefined) && !(kind === "xmp" && xmp !== undefined), insert);
  }
  if (format === "png") {
    const add: Uint8Array[] = [];
    if (exif) add.push(pngChunk("eXIf", exif));
    if (xmp) add.push(pngXmpChunk(xmp));
    return pngRebuild(b, (c) => !(c.type === "eXIf" && exif !== undefined) && !(isPngXmp(b, c) && xmp !== undefined), add);
  }
  if (format === "webp") {
    const chunks = webpChunks(b);
    const keepExif = exif === undefined ? chunks.find((c) => c.type === "EXIF") : undefined;
    const keepXmp = xmp === undefined ? chunks.find((c) => c.type === "XMP ") : undefined;
    return webpRebuild(
      b,
      (c) => c.type !== "EXIF" && c.type !== "XMP ",
      exif ?? (keepExif ? b.slice(keepExif.at + 8, keepExif.at + 8 + keepExif.len) : undefined),
      xmp ?? (keepXmp ? latin1.decode(b.subarray(keepXmp.at + 8, keepXmp.at + 8 + keepXmp.len)) : undefined),
    );
  }
  return b;
}

// ── Finding EXIF and XMP ─────────────────────────────────────────────────

/** Where the EXIF TIFF payload of a file is (offset and length), whatever the container. */
export function locateExif(b: Uint8Array, format: Format | null = sniff(b)): { at: number; len: number } | null {
  if (format === "jpeg") {
    const s = segments(b).list.find((x) => kindOf(b, x) === "exif");
    return s ? { at: s.at + 10, len: s.len - 10 } : null;
  }
  if (format === "png") {
    const c = pngChunks(b).find((x) => x.type === "eXIf");
    if (!c) return null;
    const skip = ascii(b, c.at + 8, "Exif\0\0") ? 6 : 0;
    return { at: c.at + 8 + skip, len: c.len - skip };
  }
  if (format === "webp") {
    const c = webpChunks(b).find((x) => x.type === "EXIF");
    if (!c) return null;
    const skip = ascii(b, c.at + 8, "Exif\0\0") ? 6 : 0;
    return { at: c.at + 8 + skip, len: c.len - skip };
  }
  if (format === "tiff" || format === "raw") return tiffOrder(b) !== null ? { at: 0, len: b.length } : scanExif(b);
  return scanExif(b);
}

/** "Exif\0\0" followed by a TIFF header (HEIF/AVIF Exif items, JXL Exif boxes, CR3…). */
function scanExif(b: Uint8Array): { at: number; len: number } | null {
  for (let i = 0; i + 14 <= b.length; i++) {
    if (b[i] !== 0x45 || !ascii(b, i, "Exif\0\0")) continue;
    if (tiffOrder(b.subarray(i + 6)) !== null) return { at: i + 6, len: b.length - i - 6 };
  }
  return null;
}

/** Byte ranges of XMP packets anywhere in the file. */
export function locateXmp(b: Uint8Array): { at: number; len: number }[] {
  const out: { at: number; len: number }[] = [];
  const text = latin1.decode(b);
  let from = 0;
  for (;;) {
    let start = text.indexOf("<?xpacket begin", from);
    let end: number;
    if (start >= 0) {
      const close = text.indexOf("<?xpacket end", start);
      if (close < 0) break;
      end = text.indexOf("?>", close);
      if (end < 0) break;
      end += 2;
    } else {
      start = text.indexOf("<x:xmpmeta", from);
      if (start < 0) break;
      end = text.indexOf("</x:xmpmeta>", start);
      if (end < 0) break;
      end += 12;
    }
    out.push({ at: start, len: end - start });
    from = end;
  }
  return out;
}

const XMP_GPS = /exif:GPS|GPSLatitude|GPSLongitude|photoshop:City|Iptc4xmpCore:Location|LocationShown|LocationCreated/i;
export const xmpHasGps = (xml: string) => XMP_GPS.test(xml);

// ── In-place EXIF scrubbing ──────────────────────────────────────────────

export type ScrubMode = "gps" | "private" | "all";

const PRIVATE_TAGS = new Set<number>([TAG.BodySerialNumber, TAG.LensSerialNumber, TAG.CameraOwnerName, TAG.ImageUniqueID, TAG.MakerNote, TAG.CameraSerialNumber]);
/** What "all" blanks in a TIFF/RAW IFD0, whose other tags describe the image itself. */
const IFD0_DETAILS = new Set<number>([TAG.ImageDescription, TAG.Make, TAG.Model, TAG.Software, TAG.DateTime, TAG.Artist, TAG.HostComputer, TAG.Copyright, TAG.XMP, TAG.IPTC, TAG.Photoshop, TAG.CameraSerialNumber]);

export interface ScrubResult {
  /** What was found and blanked: "gps", "serial", "owner", "maker-note", "exif", "thumbnail", "details". */
  removed: string[];
}

/**
 * Blank EXIF in place inside `tiff` (a view into the file, mutated). Lengths
 * never change. `standalone` is true when the whole file is this TIFF (TIFF,
 * RAW): its IFD0 then describes the image and only detail tags are blanked.
 */
export function scrubTiff(tiff: Uint8Array, mode: ScrubMode, standalone = false): ScrubResult {
  const removed = new Set<string>();
  const le = tiffOrder(tiff);
  if (le === null) return { removed: [] };
  const { u16, u32 } = reader(tiff, le);
  const seen = new Set<number>();
  const valid = (at: number) => at >= 8 && at + 2 <= tiff.length && !seen.has(at) && at + 2 + u16(at) * 12 + 4 <= tiff.length;
  const entryData = (e: number): [number, number] | null => {
    const size = (TYPE_SIZE[u16(e + 2)] ?? 0) * u32(e + 4);
    if (!size) return null;
    if (size <= 4) return [e + 8, 4];
    const at = u32(e + 8);
    return at + size <= tiff.length ? [at, size] : null;
  };
  const zero = (range: [number, number] | null, fill = 0) => {
    if (range) tiff.fill(fill, range[0], range[0] + range[1]);
  };
  /** Blank one entry's value; the entry stays (an empty string, zeroed numbers). */
  const blankValue = (e: number) => {
    const tag = u16(e);
    zero(entryData(e), tag === TAG.XMP ? 0x20 : 0);
  };
  /** Blank a whole directory: values, entries, count. */
  const emptyIfd = (at: number) => {
    if (!valid(at)) return;
    seen.add(at);
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const tag = u16(e);
      if (tag === TAG.InteropIFD) emptyIfd(u32(e + 8));
      if (tag === TAG.MakerNote) removed.add("maker-note");
      blankValue(e);
    }
    tiff.fill(0, at, at + 2 + n * 12 + 4);
  };

  const ifd0 = u32(4);
  if (!valid(ifd0)) return { removed: [] };
  seen.add(ifd0);
  const n0 = u16(ifd0);
  let exifAt = 0;
  let gpsAt = 0;
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = u16(e);
    if (tag === TAG.ExifIFD) exifAt = u32(e + 8);
    if (tag === TAG.GPSIFD) gpsAt = u32(e + 8);
  }
  const next = ifd0 + 2 + n0 * 12;
  const ifd1 = u32(next);

  if (gpsAt && valid(gpsAt) && u16(gpsAt) > 0) {
    removed.add("gps");
    emptyIfd(gpsAt);
  }
  if (mode === "private" && exifAt && valid(exifAt)) {
    const n = u16(exifAt);
    for (let i = 0; i < n; i++) {
      const e = exifAt + 2 + i * 12;
      const tag = u16(e);
      if (!PRIVATE_TAGS.has(tag)) continue;
      removed.add(tag === TAG.MakerNote ? "maker-note" : tag === TAG.CameraOwnerName ? "owner" : "serial");
      blankValue(e);
    }
  }
  if (mode !== "gps") {
    for (let i = 0; i < n0; i++) {
      const e = ifd0 + 2 + i * 12;
      const tag = u16(e);
      if (tag === TAG.CameraSerialNumber) {
        removed.add("serial");
        blankValue(e);
      } else if (mode === "all" && (standalone ? IFD0_DETAILS.has(tag) : tag !== TAG.ExifIFD && tag !== TAG.GPSIFD)) {
        removed.add("details");
        blankValue(e);
      }
    }
  }
  if (mode === "all") {
    if (exifAt && valid(exifAt) && u16(exifAt) > 0) {
      removed.add("exif");
      emptyIfd(exifAt);
    }
    if (!standalone) {
      // The thumbnail can show the photo before it was cropped.
      if (ifd1 && valid(ifd1)) {
        const n = u16(ifd1);
        let thumbAt = 0;
        let thumbLen = 0;
        for (let i = 0; i < n; i++) {
          const e = ifd1 + 2 + i * 12;
          if (u16(e) === TAG.JPEGInterchangeFormat) thumbAt = u32(e + 8);
          if (u16(e) === TAG.JPEGInterchangeFormatLength) thumbLen = u32(e + 8);
        }
        if (thumbAt && thumbLen && thumbAt + thumbLen <= tiff.length) {
          tiff.fill(0, thumbAt, thumbAt + thumbLen);
          removed.add("thumbnail");
        }
        emptyIfd(ifd1);
      }
      // An empty IFD0, still a valid TIFF header.
      tiff.fill(0, ifd0, ifd0 + 2 + n0 * 12 + 4);
    }
  }
  return { removed: [...removed] };
}

/** Blank an XMP packet in place with spaces (still a valid, empty packet area). */
function blankRange(b: Uint8Array, r: { at: number; len: number }) {
  b.fill(0x20, r.at, r.at + r.len);
}

// ── Strip ────────────────────────────────────────────────────────────────

export type StripMode = "all" | "gps" | "private";

export interface StripResult {
  bytes: Uint8Array;
  removed: string[];
}

/** A minimal EXIF holding only an orientation, so an un-rotated JPEG stays upright. */
function orientationOnly(o: number): Uint8Array {
  const t = new Uint8Array(8 + 2 + 12 + 4);
  t.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o & 255, 0, 0, 0]);
  return t;
}

/** Remove metadata without re-encoding: the image data is untouched. */
export function strip(b: Uint8Array, mode: StripMode, orientation = 1): StripResult {
  const format = sniff(b);
  const removed = new Set<string>();
  if (mode === "all" && format === "jpeg") {
    const { list } = segments(b);
    for (const s of list) {
      const k = kindOf(b, s);
      if (k === "exif" || k === "xmp" || k === "iptc" || k === "comment" || k === "other-app" || k === "mpf") removed.add(k === "other-app" || k === "mpf" ? "app" : k);
    }
    const keep = (k: string) => k === "jfif" || k === "icc" || k === "adobe" || k === "image";
    return { bytes: rebuild(b, (k) => keep(k), orientation !== 1 ? [appSegment(0xe1, concat([EXIF_HEADER, orientationOnly(orientation)]))] : []), removed: [...removed] };
  }
  if (mode === "all" && format === "png") {
    const drop = (c: Chunk) => c.type === "eXIf" || c.type === "tEXt" || c.type === "zTXt" || c.type === "iTXt" || c.type === "tIME";
    for (const c of pngChunks(b)) if (drop(c)) removed.add(c.type === "eXIf" ? "exif" : isPngXmp(b, c) ? "xmp" : c.type === "tIME" ? "time" : "text");
    return { bytes: pngRebuild(b, (c) => !drop(c)), removed: [...removed] };
  }
  if (mode === "all" && format === "webp") {
    for (const c of webpChunks(b)) if (c.type === "EXIF" || c.type === "XMP ") removed.add(c.type === "EXIF" ? "exif" : "xmp");
    return { bytes: webpRebuild(b, (c) => c.type !== "EXIF" && c.type !== "XMP "), removed: [...removed] };
  }

  // Everything else is scrubbed in place on a copy.
  let out: Uint8Array = b.slice();
  const loc = locateExif(out, format);
  if (loc) {
    const standalone = (format === "tiff" || format === "raw") && loc.at === 0;
    for (const r of scrubTiff(out.subarray(loc.at, loc.at + loc.len), mode, standalone).removed) removed.add(r);
  }
  const textOf = (r: { at: number; len: number }) => latin1.decode(out.subarray(r.at, r.at + r.len));
  if (format === "jpeg" || format === "png" || format === "webp") {
    // XMP that gives the place away goes entirely (it cannot be edited in place reliably).
    const xmp = locateXmp(out).map(textOf).join("");
    if (xmp && xmpHasGps(xmp)) {
      out = setMeta(out, { xmp: null });
      removed.add("xmp");
    }
    if (format === "png") {
      // In-place edits changed eXIf's bytes: fix its CRC. Old "Raw profile" text chunks carry EXIF too.
      const raw = pngChunks(out).filter((c) => isPngRawExif(out, c));
      if (raw.length) removed.add("exif");
      out = pngRebuild(out, (c) => !isPngRawExif(out, c));
      for (const c of pngChunks(out)) {
        if (c.type !== "eXIf") continue;
        new DataView(out.buffer, out.byteOffset).setUint32(c.at + 8 + c.len, crc32(out.subarray(c.at + 4, c.at + 8 + c.len)));
      }
    }
  } else {
    for (const r of locateXmp(out)) {
      if (mode === "all" || xmpHasGps(textOf(r))) {
        blankRange(out, r);
        removed.add("xmp");
      }
    }
  }
  return { bytes: out, removed: [...removed] };
}

// ── Structure and size ───────────────────────────────────────────────────

export interface Block {
  /** "exif", "xmp", "icc", "iptc", "comment", "thumbnail", "image", "other"… */
  kind: string;
  /** Marker or chunk name as stored ("APP1", "eXIf", "EXIF"…). */
  name: string;
  size: number;
}

const JPEG_NAMES: Record<number, string> = { 0xdb: "DQT", 0xc4: "DHT", 0xdd: "DRI", 0xc0: "SOF0", 0xc1: "SOF1", 0xc2: "SOF2" };

/** The metadata-relevant blocks of a file, with their sizes. */
export function blocks(b: Uint8Array): Block[] {
  const format = sniff(b);
  if (format === "jpeg") {
    const { list, scanAt } = segments(b);
    const out = list.map((s): Block => {
      const k = kindOf(b, s);
      const name = s.marker >= 0xe0 && s.marker <= 0xef ? `APP${s.marker - 0xe0}` : s.marker === 0xfe ? "COM" : (JPEG_NAMES[s.marker] ?? `0x${s.marker.toString(16)}`);
      return { kind: k === "image" || k === "jfif" || k === "adobe" ? "image" : k === "other-app" ? "other" : k, name, size: s.len };
    });
    out.push({ kind: "image", name: "SOS", size: b.length - scanAt });
    return out;
  }
  if (format === "png") {
    return pngChunks(b).map((c) => ({
      kind: c.type === "eXIf" ? "exif" : isPngXmp(b, c) ? "xmp" : c.type === "iCCP" ? "icc" : c.type === "tEXt" || c.type === "zTXt" || c.type === "iTXt" ? "comment" : c.type === "tIME" ? "other" : "image",
      name: c.type,
      size: c.len + 12,
    }));
  }
  if (format === "webp") {
    return webpChunks(b).map((c) => ({ kind: c.type === "EXIF" ? "exif" : c.type === "XMP " ? "xmp" : c.type === "ICCP" ? "icc" : "image", name: c.type.trim(), size: c.len + 8 }));
  }
  const out: Block[] = [];
  const exif = locateExif(b, format);
  if (exif && exif.at > 0) out.push({ kind: "exif", name: "Exif", size: exif.len });
  for (const x of locateXmp(b)) out.push({ kind: "xmp", name: "XMP", size: x.len });
  return out;
}

/** Whether the file carries an ICC colour profile. */
export function hasIcc(b: Uint8Array): boolean {
  return blocks(b).some((x) => x.kind === "icc") || (sniff(b) === "heic" || sniff(b) === "avif" ? latin1.decode(b.subarray(0, Math.min(b.length, 65536))).includes("colrprof") : false);
}

/** Pixel size from the header, without decoding. */
export function dimensions(b: Uint8Array, format: Format | null = sniff(b)): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    switch (format) {
      case "jpeg": {
        if (!isJpeg(b)) return null;
        for (const s of segments(b).list) {
          if (s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc) {
            return { height: v.getUint16(s.at + 5), width: v.getUint16(s.at + 7) };
          }
        }
        return null;
      }
      case "png":
        return { width: v.getUint32(16), height: v.getUint32(20) };
      case "webp": {
        const i = webpInfo(b, webpChunks(b));
        return i ? { width: i.w, height: i.h } : null;
      }
      case "gif":
        return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
      case "bmp":
        return { width: Math.abs(v.getInt32(18, true)), height: Math.abs(v.getInt32(22, true)) };
      case "qoi":
        return { width: v.getUint32(4), height: v.getUint32(8) };
      case "heic":
      case "avif": {
        // The largest "ispe" (image spatial extents) property is the primary image.
        let best: { width: number; height: number } | null = null;
        const limit = Math.min(b.length - 20, 1 << 20);
        for (let i = 4; i < limit; i++) {
          if (b[i] === 0x69 && ascii(b, i, "ispe")) {
            const w = v.getUint32(i + 8);
            const h = v.getUint32(i + 12);
            if (w && h && (!best || w * h > best.width * best.height)) best = { width: w, height: h };
          }
        }
        return best;
      }
      case "tiff":
      case "raw": {
        const le = tiffOrder(b);
        if (le === null) return null;
        const { u16, u32 } = reader(b, le);
        const at = u32(4);
        const n = u16(at);
        let width = 0;
        let height = 0;
        for (let i = 0; i < n; i++) {
          const e = at + 2 + i * 12;
          const tag = u16(e);
          const type = u16(e + 2);
          const val = type === 3 ? u16(e + 8) : u32(e + 8);
          if (tag === 256) width = val;
          if (tag === 257) height = val;
        }
        return width && height ? { width, height } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
