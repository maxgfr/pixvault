import { expect, test } from "bun:test";
import { decode, encode } from "./codecs.ts";
import { sniff } from "./formats.ts";
import { rawPreview } from "./raw.ts";
import { sample } from "./test/setup.ts";

/** A minimal TIFF-based RAW: IFD0 points at an embedded JPEG preview, then junk "sensor data". */
function fakeRaw(jpeg: Uint8Array, thumb: Uint8Array): Uint8Array {
  const head = 8 + 2 + 3 * 12 + 4;
  const sensor = new Uint8Array(4096).fill(0x55);
  const out = new Uint8Array(head + thumb.length + jpeg.length + sensor.length);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 3, true);
  const entry = (i: number, tag: number, value: number) => {
    const e = 10 + i * 12;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, 4, true);
    v.setUint32(e + 4, 1, true);
    v.setUint32(e + 8, value, true);
  };
  // A small thumbnail through 513/514, and the full preview as a JPEG strip (Compression 6).
  entry(0, 513, head);
  entry(1, 514, thumb.length);
  entry(2, 259, 6);
  out.set(thumb, head);
  out.set(jpeg, head + thumb.length);
  out.set(sensor, head + thumb.length + jpeg.length);
  return out;
}

test("finds the largest embedded JPEG preview", async () => {
  const big = await encode(sample(120, 80), "jpeg", { quality: 95 });
  const small = await encode(sample(24, 16), "jpeg", { quality: 50 });
  const raw = fakeRaw(big, small);
  expect(sniff(raw, "IMG_0001.CR2")).toBe("raw");
  expect(sniff(raw, "scan.tif")).toBe("tiff");
  const preview = rawPreview(raw)!;
  expect(preview.length).toBe(big.length);
  const r = await decode(raw, "IMG_0001.CR2");
  expect([r.width, r.height]).toEqual([120, 80]);
});
