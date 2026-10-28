import { expect, test } from "bun:test";
import { decode } from "./codecs.ts";
import { sniff } from "./formats.ts";

test("decodes an iPhone-style HEIC with libheif", async () => {
  const bytes = new Uint8Array(await Bun.file(new URL("../../fixtures/sample.heic", import.meta.url)).arrayBuffer());
  expect(sniff(bytes)).toBe("heic");
  const r = await decode(bytes);
  expect([r.width, r.height]).toEqual([96, 64]);
  // Top-left of the sample is dark red-ish, top-right bright red.
  expect(r.data[0]!).toBeLessThan(40);
  expect(r.data[(95) * 4]!).toBeGreaterThan(200);
});
