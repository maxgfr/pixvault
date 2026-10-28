// A small EXIF (TIFF) model: parse the directories of an EXIF payload into
// entries, change them, and write them back, in the source byte order. Used
// to write fresh EXIF from photo details, to carry details over to a
// re-encoded file, and to edit dates and credits without touching pixels.

import type { PhotoMeta } from "./types.ts";

/** TIFF field types and their byte sizes. */
export const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
export const ASCII = 2;
export const SHORT = 3;
export const LONG = 4;
export const RATIONAL = 5;
export const BYTE = 1;
export const UNDEFINED = 7;

export const TAG = {
  ImageDescription: 0x010e,
  Make: 0x010f,
  Model: 0x0110,
  Orientation: 0x0112,
  Software: 0x0131,
  DateTime: 0x0132,
  Artist: 0x013b,
  HostComputer: 0x013c,
  Copyright: 0x8298,
  ExifIFD: 0x8769,
  GPSIFD: 0x8825,
  InteropIFD: 0xa005,
  SubIFDs: 0x014a,
  ExposureTime: 0x829a,
  FNumber: 0x829d,
  ISO: 0x8827,
  ExifVersion: 0x9000,
  DateTimeOriginal: 0x9003,
  DateTimeDigitized: 0x9004,
  OffsetTime: 0x9010,
  OffsetTimeOriginal: 0x9011,
  OffsetTimeDigitized: 0x9012,
  FocalLength: 0x920a,
  MakerNote: 0x927c,
  UserComment: 0x9286,
  PixelXDimension: 0xa002,
  PixelYDimension: 0xa003,
  ImageUniqueID: 0xa420,
  CameraOwnerName: 0xa430,
  BodySerialNumber: 0xa431,
  LensMake: 0xa433,
  LensModel: 0xa434,
  LensSerialNumber: 0xa435,
  FocalLengthIn35mmFilm: 0xa405,
  JPEGInterchangeFormat: 0x0201,
  JPEGInterchangeFormatLength: 0x0202,
  CameraSerialNumber: 0xc62f,
  XMP: 0x02bc,
  IPTC: 0x83bb,
  Photoshop: 0x8649,
} as const;

export interface Entry {
  tag: number;
  type: number;
  count: number;
  /** The value's bytes, in the document's byte order, unpadded. */
  value: Uint8Array;
}

export interface TiffDoc {
  le: boolean;
  ifd0: Entry[];
  exif: Entry[];
  gps: Entry[];
  interop: Entry[];
  ifd1: Entry[];
  /** The JPEG thumbnail IFD1 points at. */
  thumbnail?: Uint8Array;
}

export const emptyDoc = (le = true): TiffDoc => ({ le, ifd0: [], exif: [], gps: [], interop: [], ifd1: [] });

const POINTERS = new Set<number>([TAG.ExifIFD, TAG.GPSIFD, TAG.InteropIFD, TAG.JPEGInterchangeFormat, TAG.SubIFDs]);

export function reader(b: Uint8Array, le: boolean) {
  return {
    u16: (at: number) => (le ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!),
    u32: (at: number) => (le ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 0x1000000 : b[at]! * 0x1000000 + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!)),
  };
}

/** Byte order of a TIFF header at the start of `b`, or null when it is not one. */
export function tiffOrder(b: Uint8Array): boolean | null {
  if (b.length < 8) return null;
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) return true;
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a) return false;
  return null;
}

/** Parse an EXIF TIFF payload; null when it is not one. Unknown offsets are dropped, never followed blindly. */
export function parseTiff(b: Uint8Array): TiffDoc | null {
  const le = tiffOrder(b);
  if (le === null) return null;
  const { u16, u32 } = reader(b, le);
  const seen = new Set<number>();
  const readIfd = (at: number): { entries: Entry[]; next: number; raw: Map<number, number> } | null => {
    if (at < 8 || at + 2 > b.length || seen.has(at)) return null;
    seen.add(at);
    const n = u16(at);
    if (n > 1000 || at + 2 + n * 12 > b.length) return null;
    const entries: Entry[] = [];
    const raw = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 0) * count;
      raw.set(tag, u32(e + 8));
      if (!size || size > b.length) continue;
      const start = size <= 4 ? e + 8 : u32(e + 8);
      if (start + size > b.length) continue;
      entries.push({ tag, type, count, value: b.slice(start, start + size) });
    }
    return { entries, next: u32(at + 2 + n * 12), raw };
  };
  const doc = emptyDoc(le);
  const ifd0 = readIfd(u32(4));
  if (!ifd0) return doc;
  doc.ifd0 = ifd0.entries.filter((e) => !POINTERS.has(e.tag));
  const exifAt = ifd0.raw.get(TAG.ExifIFD);
  if (exifAt !== undefined) {
    const exif = readIfd(exifAt);
    if (exif) {
      doc.exif = exif.entries.filter((e) => !POINTERS.has(e.tag));
      const interopAt = exif.raw.get(TAG.InteropIFD);
      if (interopAt !== undefined) doc.interop = readIfd(interopAt)?.entries ?? [];
    }
  }
  const gpsAt = ifd0.raw.get(TAG.GPSIFD);
  if (gpsAt !== undefined) doc.gps = readIfd(gpsAt)?.entries ?? [];
  const ifd1 = readIfd(ifd0.next);
  if (ifd1) {
    doc.ifd1 = ifd1.entries.filter((e) => !POINTERS.has(e.tag) && e.tag !== TAG.JPEGInterchangeFormatLength);
    const at = ifd1.raw.get(TAG.JPEGInterchangeFormat);
    const len = ifd1.raw.get(TAG.JPEGInterchangeFormatLength);
    if (at !== undefined && len && at + len <= b.length) doc.thumbnail = b.slice(at, at + len);
  }
  return doc;
}

function writer(le: boolean) {
  const bytes: number[] = [];
  const u16 = (v: number) => (le ? bytes.push(v & 255, (v >> 8) & 255) : bytes.push((v >> 8) & 255, v & 255));
  const u32 = (v: number) => (le ? bytes.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255) : bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255));
  return { bytes, u16, u32 };
}

const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4 + entries.reduce((n, e) => n + (e.value.length > 4 ? e.value.length + (e.value.length & 1) : 0), 0);

/** Write the document back to an EXIF TIFF payload. */
export function serializeTiff(doc: TiffDoc): Uint8Array {
  const le = doc.le;
  const pointer = (tag: number, value: number): Entry => {
    const w = writer(le);
    w.u32(value);
    return { tag, type: LONG, count: 1, value: new Uint8Array(w.bytes) };
  };
  const sort = (list: Entry[]) => [...list].sort((a, b) => a.tag - b.tag);
  // Sizes first (pointer entries hold placeholder values of the same size), then offsets.
  const hasExif = doc.exif.length > 0 || doc.interop.length > 0;
  const hasGps = doc.gps.length > 0;
  const hasIfd1 = doc.thumbnail !== undefined;
  const ifd0 = sort([...doc.ifd0, ...(hasExif ? [pointer(TAG.ExifIFD, 0)] : []), ...(hasGps ? [pointer(TAG.GPSIFD, 0)] : [])]);
  const exif = sort([...doc.exif, ...(doc.interop.length ? [pointer(TAG.InteropIFD, 0)] : [])]);
  const interop = sort(doc.interop);
  const gps = sort(doc.gps);
  const ifd1 = hasIfd1 ? sort([...doc.ifd1, pointer(TAG.JPEGInterchangeFormat, 0), pointer(TAG.JPEGInterchangeFormatLength, doc.thumbnail!.length)]) : [];
  const at0 = 8;
  const atExif = at0 + ifdSize(ifd0);
  const atInterop = atExif + (hasExif ? ifdSize(exif) : 0);
  const atGps = atInterop + (doc.interop.length ? ifdSize(interop) : 0);
  const atIfd1 = atGps + (hasGps ? ifdSize(gps) : 0);
  const atThumb = atIfd1 + (hasIfd1 ? ifdSize(ifd1) : 0);
  const set = (list: Entry[], tag: number, v: number) => {
    const i = list.findIndex((e) => e.tag === tag);
    if (i >= 0) list[i] = pointer(tag, v);
  };
  set(ifd0, TAG.ExifIFD, atExif);
  set(ifd0, TAG.GPSIFD, atGps);
  set(exif, TAG.InteropIFD, atInterop);
  set(ifd1, TAG.JPEGInterchangeFormat, atThumb);

  const w = writer(le);
  if (le) w.bytes.push(0x49, 0x49, 0x2a, 0);
  else w.bytes.push(0x4d, 0x4d, 0, 0x2a);
  w.u32(8);
  const writeIfd = (entries: Entry[], start: number, next: number) => {
    let data = start + 2 + entries.length * 12 + 4;
    const blobs: Uint8Array[] = [];
    w.u16(entries.length);
    for (const e of entries) {
      w.u16(e.tag);
      w.u16(e.type);
      w.u32(e.count);
      if (e.value.length <= 4) {
        for (let i = 0; i < 4; i++) w.bytes.push(e.value[i] ?? 0);
      } else {
        w.u32(data);
        blobs.push(e.value);
        data += e.value.length + (e.value.length & 1);
      }
    }
    w.u32(next);
    for (const v of blobs) {
      for (const x of v) w.bytes.push(x);
      if (v.length & 1) w.bytes.push(0);
    }
  };
  writeIfd(ifd0, at0, hasIfd1 ? atIfd1 : 0);
  if (hasExif) writeIfd(exif, atExif, 0);
  if (doc.interop.length) writeIfd(interop, atInterop, 0);
  if (hasGps) writeIfd(gps, atGps, 0);
  if (hasIfd1) {
    writeIfd(ifd1, atIfd1, 0);
    for (const x of doc.thumbnail!) w.bytes.push(x);
  }
  return new Uint8Array(w.bytes);
}

// Value encoders, in a document's byte order.

const enc = new TextEncoder();

export function ascii(tag: number, s: string): Entry {
  const value = new Uint8Array([...enc.encode(s), 0]);
  return { tag, type: ASCII, count: value.length, value };
}

export function short(tag: number, v: number[] | number, le: boolean): Entry {
  const list = Array.isArray(v) ? v : [v];
  const w = writer(le);
  for (const x of list) w.u16(x);
  return { tag, type: SHORT, count: list.length, value: new Uint8Array(w.bytes) };
}

export function long(tag: number, v: number, le: boolean): Entry {
  const w = writer(le);
  w.u32(v);
  return { tag, type: LONG, count: 1, value: new Uint8Array(w.bytes) };
}

export function bytes(tag: number, v: number[], type = BYTE): Entry {
  return { tag, type, count: v.length, value: new Uint8Array(v) };
}

/** A float as a rational: exact for 1/n shutter speeds and short decimals. */
export function toRational(x: number): [number, number] {
  if (!Number.isFinite(x) || x <= 0) return [0, 1];
  if (x < 1) {
    const inv = 1 / x;
    if (Math.abs(inv - Math.round(inv)) < 1e-6 * inv) return [1, Math.round(inv)];
  }
  for (const den of [1, 10, 100, 1000, 10000, 100000]) {
    if (Math.abs(x * den - Math.round(x * den)) < 1e-6 && x * den < 0xffffffff) return [Math.round(x * den), den];
  }
  const den = Math.max(1, Math.min(1000000, Math.floor(0xffffffff / Math.max(1, x))));
  return [Math.round(x * den), den];
}

export function rational(tag: number, v: number[] | number, le: boolean): Entry {
  const list = Array.isArray(v) ? v : [v];
  const w = writer(le);
  for (const x of list) {
    const [n, d] = toRational(x);
    w.u32(n);
    w.u32(d);
  }
  return { tag, type: RATIONAL, count: list.length, value: new Uint8Array(w.bytes) };
}

/** Put an entry in a directory, replacing one with the same tag. */
export function put(list: Entry[], e: Entry): void {
  const i = list.findIndex((x) => x.tag === e.tag);
  if (i >= 0) list[i] = e;
  else list.push(e);
}

export function drop(list: Entry[], ...tags: number[]): Entry[] {
  return list.filter((e) => !tags.includes(e.tag));
}

export const find = (list: Entry[], tag: number) => list.find((e) => e.tag === tag);

const dec = new TextDecoder();
export const readAscii = (e: Entry | undefined) => (e ? dec.decode(e.value).replace(/\0+$/, "").replace(/\0/g, "") : undefined);
export function readShort(e: Entry | undefined, le: boolean): number | undefined {
  if (!e || e.value.length < 2) return undefined;
  return reader(e.value, le).u16(0);
}

/** "2024-07-14T18:30:05" → "2024:07:14 18:30:05" (EXIF's own layout). */
export function exifDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] ?? "00"}` : iso;
}

/** "2024:07:14 18:30:05" → "2024-07-14T18:30:05". */
export function isoDate(exif: string | undefined): string | undefined {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(exif?.trim() ?? "");
  if (!m || m[1] === "0000") return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
}

/** Set every field of `meta` that is defined on the document (others untouched). */
export function applyMeta(doc: TiffDoc, meta: PhotoMeta): TiffDoc {
  const le = doc.le;
  const text = (list: Entry[], tag: number, v: string | undefined) => {
    if (v === undefined) return;
    if (v === "") {
      const i = list.findIndex((e) => e.tag === tag);
      if (i >= 0) list.splice(i, 1);
    } else put(list, ascii(tag, v));
  };
  text(doc.ifd0, TAG.Make, meta.make);
  text(doc.ifd0, TAG.Model, meta.model);
  text(doc.ifd0, TAG.Software, meta.software);
  text(doc.ifd0, TAG.Artist, meta.artist);
  text(doc.ifd0, TAG.Copyright, meta.copyright);
  text(doc.ifd0, TAG.ImageDescription, meta.description);
  if (meta.orientation !== undefined) put(doc.ifd0, short(TAG.Orientation, meta.orientation, le));
  if (meta.taken) {
    const d = exifDate(meta.taken);
    put(doc.ifd0, ascii(TAG.DateTime, d));
    put(doc.exif, ascii(TAG.DateTimeOriginal, d));
    put(doc.exif, ascii(TAG.DateTimeDigitized, d));
  }
  if (meta.offset) {
    put(doc.exif, ascii(TAG.OffsetTimeOriginal, meta.offset));
    put(doc.exif, ascii(TAG.OffsetTime, meta.offset));
  }
  if (meta.exposure) put(doc.exif, rational(TAG.ExposureTime, meta.exposure, le));
  if (meta.fnumber) put(doc.exif, rational(TAG.FNumber, meta.fnumber, le));
  if (meta.iso) put(doc.exif, short(TAG.ISO, Math.min(65535, Math.round(meta.iso)), le));
  if (meta.focal) put(doc.exif, rational(TAG.FocalLength, meta.focal, le));
  if (meta.focal35) put(doc.exif, short(TAG.FocalLengthIn35mmFilm, Math.min(65535, Math.round(meta.focal35)), le));
  text(doc.exif, TAG.LensModel, meta.lens);
  if (doc.exif.length && !find(doc.exif, TAG.ExifVersion)) put(doc.exif, bytes(TAG.ExifVersion, [0x30, 0x32, 0x33, 0x32], UNDEFINED));
  if (meta.gps) {
    const dms = (v: number) => {
      const a = Math.abs(v);
      const deg = Math.floor(a);
      const min = Math.floor((a - deg) * 60);
      const sec = Math.round(((a - deg) * 60 - min) * 60 * 10000) / 10000;
      return [deg, min, sec];
    };
    doc.gps = [
      bytes(0x0000, [2, 3, 0, 0]),
      ascii(0x0001, meta.gps.lat < 0 ? "S" : "N"),
      rational(0x0002, dms(meta.gps.lat), le),
      ascii(0x0003, meta.gps.lon < 0 ? "W" : "E"),
      rational(0x0004, dms(meta.gps.lon), le),
    ];
    if (meta.gps.alt !== undefined && Number.isFinite(meta.gps.alt)) {
      doc.gps.push(bytes(0x0005, [meta.gps.alt < 0 ? 1 : 0]), rational(0x0006, Math.abs(meta.gps.alt), le));
    }
  }
  return doc;
}

/** A fresh EXIF payload holding these details. */
export function buildExif(meta: PhotoMeta): Uint8Array {
  return serializeTiff(applyMeta(emptyDoc(true), meta));
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A minimal XMP packet: description (alt text), title, keywords, creator, rights. */
export function buildXmp(m: { description?: string; title?: string; keywords?: string[]; creator?: string; rights?: string }): string {
  const alt = (tag: string, v?: string) => (v ? `<dc:${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(v)}</rdf:li></rdf:Alt></dc:${tag}>` : "");
  const subject = m.keywords?.length ? `<dc:subject><rdf:Bag>${m.keywords.map((k) => `<rdf:li>${xmlEscape(k)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>` : "";
  const creator = m.creator ? `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(m.creator)}</rdf:li></rdf:Seq></dc:creator>` : "";
  return (
    `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">${alt("description", m.description)}${alt("title", m.title)}${subject}${creator}${alt("rights", m.rights)}</rdf:Description>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}
