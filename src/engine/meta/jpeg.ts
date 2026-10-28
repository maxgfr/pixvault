// JPEG segment surgery: list, drop and insert APPn segments without touching
// the compressed image data, so metadata changes are lossless.

export interface Segment {
  marker: number;
  /** Offset of the 0xFF marker byte. */
  at: number;
  /** Whole segment length, marker included. */
  len: number;
}

export const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/** Segments from SOI up to (not including) the start of scan. */
export function segments(b: Uint8Array): { list: Segment[]; scanAt: number } {
  const list: Segment[] = [];
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) break;
    const marker = b[p + 1]!;
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return { list, scanAt: p };
    const len = 2 + ((b[p + 2]! << 8) | b[p + 3]!);
    list.push({ marker, at: p, len });
    p += len;
  }
  return { list, scanAt: p };
}

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

export type SegmentKind = "exif" | "xmp" | "icc" | "iptc" | "comment" | "jfif" | "adobe" | "mpf" | "other-app" | "image";

export function kindOf(b: Uint8Array, s: Segment): SegmentKind {
  const d = s.at + 4;
  if (s.marker === 0xe1 && ascii(b, d, "Exif\0")) return "exif";
  if (s.marker === 0xe1 && ascii(b, d, "http://ns.adobe.com/")) return "xmp";
  if (s.marker === 0xe2 && ascii(b, d, "ICC_PROFILE\0")) return "icc";
  if (s.marker === 0xe2 && ascii(b, d, "MPF\0")) return "mpf";
  if (s.marker === 0xed) return "iptc";
  if (s.marker === 0xfe) return "comment";
  if (s.marker === 0xe0 && ascii(b, d, "JFIF\0")) return "jfif";
  if (s.marker === 0xee && ascii(b, d, "Adobe")) return "adobe";
  if (s.marker >= 0xe0 && s.marker <= 0xef) return "other-app";
  return "image";
}

/** Rebuild the file keeping only the segments `keep` accepts, plus `insert` right after SOI. */
export function rebuild(b: Uint8Array, keep: (kind: SegmentKind, s: Segment) => boolean, insert: Uint8Array[] = []): Uint8Array {
  const { list, scanAt } = segments(b);
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  // JFIF must stay first when present.
  const jfif = list.find((s) => kindOf(b, s) === "jfif");
  if (jfif) parts.push(b.subarray(jfif.at, jfif.at + jfif.len));
  parts.push(...insert);
  for (const s of list) {
    if (s === jfif) continue;
    if (keep(kindOf(b, s), s)) parts.push(b.subarray(s.at, s.at + s.len));
  }
  parts.push(b.subarray(scanAt));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** An APPn segment from its payload. */
export function appSegment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 4);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (payload.length + 2) >> 8;
  out[3] = (payload.length + 2) & 255;
  out.set(payload, 4);
  return out;
}

/** The TIFF payload of the EXIF segment (after "Exif\0\0"), or null. */
export function exifTiff(b: Uint8Array): Uint8Array | null {
  if (!isJpeg(b)) return null;
  const s = segments(b).list.find((x) => kindOf(b, x) === "exif");
  return s ? b.subarray(s.at + 10, s.at + s.len) : null;
}

/** EXIF orientation (1–8) of a JPEG, 1 when absent. */
export function jpegOrientation(b: Uint8Array): number {
  const t = exifTiff(b);
  if (!t || t.length < 8) return 1;
  const le = t[0] === 0x49;
  const u16 = (at: number) => (le ? t[at]! | (t[at + 1]! << 8) : (t[at]! << 8) | t[at + 1]!);
  const u32 = (at: number) => (le ? t[at]! | (t[at + 1]! << 8) | (t[at + 2]! << 16) | (t[at + 3]! << 24) : (t[at]! << 24) | (t[at + 1]! << 16) | (t[at + 2]! << 8) | t[at + 3]!) >>> 0;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}
