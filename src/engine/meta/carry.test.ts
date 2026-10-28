import { expect, test } from "bun:test";
import { decode, encode } from "../codecs.ts";
import { sample } from "../test/setup.ts";
import { carryMeta } from "./carry.ts";
import { PHONE, photo } from "./fixtures.ts";
import { readMeta } from "./read.ts";

test("re-encoded photos keep their details, upright and without location by default", async () => {
  const src = await photo("jpeg", { ...PHONE, orientation: 6 });
  const meta = await readMeta(src);
  const pixels = await decode(src);
  for (const format of ["jpeg", "png", "webp"] as const) {
    const out = await encode(pixels, format);
    const m = await readMeta(await carryMeta(out, format, src, "jpeg", meta, "no-gps"));
    expect(m.model).toBe("iPhone 15 Pro");
    expect(m.taken).toBe(PHONE.taken!);
    expect(m.orientation).toBe(1);
    expect(m.gps).toBeUndefined();
    const kept = await readMeta(await carryMeta(out, format, src, "jpeg", meta, "keep"));
    expect(kept.gps?.lat).toBeCloseTo(43.296482, 5);
  }
});

test("strip mode and formats without EXIF support return the file untouched", async () => {
  const src = await photo("jpeg");
  const meta = await readMeta(src);
  const out = await encode(sample(), "avif");
  expect(await carryMeta(out, "avif", src, "jpeg", meta, "keep")).toBe(out);
  const jpg = await encode(sample(), "jpeg");
  expect(await carryMeta(jpg, "jpeg", src, "jpeg", meta, "strip")).toBe(jpg);
});

test("details parsed from a container without reusable EXIF are rebuilt", async () => {
  const out = await encode(sample(), "jpeg");
  const m = await readMeta(await carryMeta(out, "jpeg", new Uint8Array(16), "tiff", { make: "Nikon", taken: "2020-01-02T03:04:05", gps: { lat: 1, lon: 2 } }, "no-gps"));
  expect(m.make).toBe("Nikon");
  expect(m.taken).toBe("2020-01-02T03:04:05");
  expect(m.gps).toBeUndefined();
  // Nothing to write: nothing added.
  expect(await carryMeta(out, "jpeg", new Uint8Array(16), "tiff", { width: 4, height: 4 }, "keep")).toBe(out);
});
