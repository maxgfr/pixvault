// Camera RAW files carry a full-size JPEG preview, rendered by the camera
// with its own colour science. pixvault uses that preview rather than
// demosaicing the sensor data: it is what the camera showed, and it decodes
// in milliseconds. Found by walking TIFF IFDs (DNG, CR2, NEF, ARW, PEF, ORF,
// RW2…) and, failing that, by scanning for the largest embedded JPEG (CR3, RAF).

const u16 = (b: Uint8Array, at: number, le: boolean) => (le ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!);
const u32 = (b: Uint8Array, at: number, le: boolean) => (le ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 0x1000000 : b[at]! * 0x1000000 + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!));

interface Candidate {
  at: number;
  len: number;
}

/** A JPEG we can decode: starts with SOI and is not lossless (SOF3, DNG raw data). */
function decodable(b: Uint8Array, c: Candidate): boolean {
  if (c.len < 1024 || c.at + c.len > b.length || b[c.at] !== 0xff || b[c.at + 1] !== 0xd8) return false;
  let p = c.at + 2;
  while (p + 4 < c.at + c.len) {
    if (b[p] !== 0xff) return false;
    const m = b[p + 1]!;
    if (m === 0xc3 || m === 0xc7 || m === 0xcb || m === 0xcf) return false;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return true;
    p += 2 + ((b[p + 2]! << 8) | b[p + 3]!);
  }
  return false;
}

function fromTiff(b: Uint8Array): Candidate[] {
  const le = b[0] === 0x49;
  const out: Candidate[] = [];
  const seen = new Set<number>();
  const walk = (ifd: number, depth: number) => {
    while (ifd > 0 && ifd + 2 < b.length && !seen.has(ifd) && depth < 6) {
      seen.add(ifd);
      const n = u16(b, ifd, le);
      const tags = new Map<number, { type: number; count: number; value: number; at: number }>();
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) return;
        const type = u16(b, e + 2, le);
        const count = u32(b, e + 4, le);
        const value = type === 3 && count === 1 ? u16(b, e + 8, le) : u32(b, e + 8, le);
        tags.set(u16(b, e, le), { type, count, value, at: e + 8 });
      }
      const jif = tags.get(513);
      const jifLen = tags.get(514);
      if (jif && jifLen) out.push({ at: jif.value, len: jifLen.value });
      const compression = tags.get(259)?.value;
      const strips = tags.get(273);
      const stripLens = tags.get(279);
      if ((compression === 6 || compression === 7 || compression === 99) && strips && stripLens && strips.count === 1) {
        out.push({ at: strips.value, len: stripLens.value });
      }
      const sub = tags.get(330);
      if (sub) {
        const list = sub.count === 1 ? [sub.value] : Array.from({ length: Math.min(sub.count, 16) }, (_, i) => u32(b, sub.value + i * 4, le));
        for (const s of list) walk(s, depth + 1);
      }
      const exif = tags.get(34665);
      if (exif) walk(exif.value, depth + 1);
      const makerNote = tags.get(37500);
      if (makerNote && makerNote.count > 16) out.push(...scan(b.subarray(makerNote.value, makerNote.value + makerNote.count)).map((c) => ({ at: c.at + makerNote.value, len: c.len })));
      const next = ifd + 2 + n * 12;
      ifd = next + 4 <= b.length ? u32(b, next, le) : 0;
    }
  };
  walk(u32(b, 4, le), 0);
  return out;
}

/** Every SOI…EOI span long enough to be a preview. */
function scan(b: Uint8Array): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    // Walk segments to the scan, then look for EOI.
    let p = i + 2;
    while (p + 4 < b.length && b[p] === 0xff && b[p + 1] !== 0xda) p += 2 + ((b[p + 2]! << 8) | b[p + 3]!);
    if (b[p] !== 0xff || b[p + 1] !== 0xda) continue;
    let e = p + 2;
    while (e + 1 < b.length && !(b[e] === 0xff && b[e + 1] === 0xd9)) e++;
    if (e + 1 >= b.length) break;
    out.push({ at: i, len: e + 2 - i });
    i = e + 1;
  }
  return out;
}

/** The largest decodable embedded JPEG, or null. */
export function rawPreview(b: Uint8Array): Uint8Array | null {
  const tiff = (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d);
  // IFDs often only point at a thumbnail; the full preview may sit in a maker note or a CR3/RAF box.
  const candidates = [...(tiff ? fromTiff(b) : []), ...scan(b)];
  const best = candidates.filter((c) => decodable(b, c)).sort((x, y) => y.len - x.len)[0];
  return best ? b.slice(best.at, best.at + best.len) : null;
}
