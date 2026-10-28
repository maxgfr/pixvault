import { expect, test } from "bun:test";
import exifr from "exifr";
import { decode } from "../codecs.ts";
import { diff } from "../test/setup.ts";
import { blocks, crc32, dimensions, locateExif, pngChunks, scrubTiff, setMeta, strip, webpChunks } from "./containers.ts";
import { buildExif } from "./exif-write.ts";
import { PHONE, photo } from "./fixtures.ts";
import { segments } from "./jpeg.ts";
import { readMeta } from "./read.ts";

const scan = (b: Uint8Array) => b.subarray(segments(b).scanAt);

for (const format of ["jpeg", "png", "webp"] as const) {
  test(`${format}: EXIF and XMP are written and read back`, async () => {
    const b = await photo(format, PHONE, { description: "A harbour at dawn", keywords: ["sea", "boat"] });
    const m = await readMeta(b);
    expect(m.make).toBe("Apple");
    expect(m.taken).toBe("2025-08-02T09:41:12");
    expect(m.gps?.lat).toBeCloseTo(43.296482, 5);
    expect(m.keywords).toEqual(["sea", "boat"]);
    expect(m.width).toBe(64);
    expect(dimensions(b)).toEqual({ width: 64, height: 48 });
    expect((await decode(b)).width).toBe(64);
  });

  test(`${format}: strip all removes everything, pixels identical`, async () => {
    const b = await photo(format, PHONE, { description: "x" });
    const r = strip(b, "all");
    expect(r.removed).toContain("exif");
    expect(r.removed).toContain("xmp");
    const m = await readMeta(r.bytes);
    expect(m.gps).toBeUndefined();
    expect(m.make).toBeUndefined();
    expect(m.description).toBeUndefined();
    expect(diff(await decode(r.bytes), await decode(b))).toBe(0);
    expect(r.bytes.length).toBeLessThan(b.length);
  });

  test(`${format}: strip gps keeps the rest, pixels identical`, async () => {
    const b = await photo(format, { ...PHONE, serial: "C39XYZ" });
    const r = strip(b, "gps");
    expect(r.removed).toEqual(["gps"]);
    expect(r.bytes.length).toBe(b.length);
    const m = await readMeta(r.bytes);
    expect(m.gps).toBeUndefined();
    expect(m.model).toBe("iPhone 15 Pro");
    expect(m.taken).toBe(PHONE.taken!);
    expect(diff(await decode(r.bytes), await decode(b))).toBe(0);
  });
}

test("jpeg: compressed data after SOS is byte-identical after any strip", async () => {
  const b = await photo("jpeg");
  for (const mode of ["all", "gps", "private"] as const) expect(scan(strip(b, mode).bytes)).toEqual(scan(b));
});

test("jpeg: strip all keeps a rotated photo upright with a minimal EXIF", async () => {
  const b = await photo("jpeg", { ...PHONE, orientation: 6 });
  const r = strip(b, "all", 6);
  const m = await readMeta(r.bytes);
  expect(m.orientation).toBe(6);
  expect(m.make).toBeUndefined();
  expect(m.gps).toBeUndefined();
});

test("private also blanks serial numbers and the owner", async () => {
  const exif = buildExif({ ...PHONE });
  // Add serial and owner by hand in the Exif IFD.
  const { parseTiff, serializeTiff, ascii, put, TAG } = await import("./exif-write.ts");
  const doc = parseTiff(exif)!;
  put(doc.exif, ascii(TAG.BodySerialNumber, "SN-123456"));
  put(doc.exif, ascii(TAG.CameraOwnerName, "Jean Dupont"));
  const b = setMeta(await photo("jpeg", {}), { exif: serializeTiff(doc) });
  const r = strip(b, "private");
  expect(r.removed.sort()).toEqual(["gps", "owner", "serial"]);
  const raw = await exifr.parse(r.bytes, { tiff: true, exif: true, gps: true, reviveValues: false });
  expect(raw.BodySerialNumber ?? "").toBe("");
  expect(raw.CameraOwnerName ?? "").toBe("");
  expect(raw.latitude).toBeUndefined();
  expect(raw.Model).toBe("iPhone 15 Pro");
});

test("png: chunk CRCs stay valid after in-place scrubbing", async () => {
  const b = strip(await photo("png"), "gps").bytes;
  for (const c of pngChunks(b)) {
    const stored = new DataView(b.buffer, b.byteOffset).getUint32(c.at + 8 + c.len);
    expect(crc32(b.subarray(c.at + 4, c.at + 8 + c.len))).toBe(stored);
  }
});

test("webp: a simple VP8 file gains a VP8X header with the right flags and size", async () => {
  const b = await photo("webp", PHONE, { description: "x" });
  const chunks = webpChunks(b);
  expect(chunks[0]!.type).toBe("VP8X");
  const flags = b[chunks[0]!.at + 8]!;
  expect(flags & 0x08).toBe(0x08);
  expect(flags & 0x04).toBe(0x04);
  expect(new DataView(b.buffer, b.byteOffset).getUint32(4, true)).toBe(b.length - 8);
  const stripped = strip(b, "all").bytes;
  expect(webpChunks(stripped).some((c) => c.type === "EXIF" || c.type === "XMP ")).toBe(false);
  expect(new DataView(stripped.buffer, stripped.byteOffset).getUint32(4, true)).toBe(stripped.length - 8);
});

test("xmp with a location goes away with strip gps", async () => {
  const b = await photo("jpeg", PHONE, { description: "x" }, "<exif:GPSLatitude>43,17.79N</exif:GPSLatitude>");
  const r = strip(b, "gps");
  expect(r.removed).toContain("xmp");
  expect(blocks(r.bytes).some((x) => x.kind === "xmp")).toBe(false);
});

/** A HEIC-looking file: a real ftyp box, then an Exif item and an XMP packet somewhere inside. */
async function fakeHeic() {
  const head = new Uint8Array(await Bun.file(new URL("../../../fixtures/sample.heic", import.meta.url)).arrayBuffer()).slice(0, 36);
  const exif = buildExif({ ...PHONE, artist: "Me" });
  const xmp = new TextEncoder().encode('<?xpacket begin=""?><x:xmpmeta><exif:GPSLatitude>1</exif:GPSLatitude></x:xmpmeta><?xpacket end="w"?>');
  const filler = new Uint8Array(200).fill(7);
  const parts = [head, filler, new Uint8Array([0, 0, 0, 6]), new TextEncoder().encode("Exif\0\0"), exif, filler, xmp, filler];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

test("heic: EXIF is found and scrubbed in place, length unchanged", async () => {
  const b = await fakeHeic();
  expect((await readMeta(b)).gps?.lat).toBeCloseTo(43.296482, 5);
  const gps = strip(b, "gps");
  expect(gps.bytes.length).toBe(b.length);
  expect(gps.removed).toContain("gps");
  expect(gps.removed).toContain("xmp");
  const m = await readMeta(gps.bytes);
  expect(m.gps).toBeUndefined();
  expect(m.make).toBe("Apple");
  const all = strip(b, "all");
  expect(all.bytes.length).toBe(b.length);
  const after = await readMeta(all.bytes);
  expect(after.make).toBeUndefined();
  expect(after.artist).toBeUndefined();
  // Bytes outside the EXIF and XMP blocks are untouched.
  expect(all.bytes.subarray(0, 236)).toEqual(b.subarray(0, 236));
});

test("tiff: strip all blanks details but keeps the image readable", async () => {
  const { encode } = await import("../codecs.ts");
  const { sample } = await import("../test/setup.ts");
  const t = await encode(sample(16, 8), "tiff");
  const loc = locateExif(t, "tiff");
  expect(loc?.at).toBe(0);
  const r = strip(t, "all");
  expect(r.bytes.length).toBe(t.length);
  expect(diff(await decode(r.bytes, "x.tif"), await decode(t, "x.tif"))).toBe(0);
});

test("scrubbing something that is not a TIFF does nothing", () => {
  const b = new Uint8Array(32).fill(1);
  expect(scrubTiff(b, "all").removed).toEqual([]);
  expect(b.every((x) => x === 1)).toBe(true);
});
