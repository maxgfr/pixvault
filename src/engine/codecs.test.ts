import { expect, test } from "bun:test";
import { decode, encode } from "./codecs.ts";
import { type OutFormat, sniff } from "./formats.ts";
import { diff, noisy, sample } from "./test/setup.ts";

const lossless: OutFormat[] = ["png", "qoi", "bmp", "tiff"];
const lossy: OutFormat[] = ["jpeg", "webp", "avif", "jxl"];

for (const f of lossless) {
  test(`${f} round-trips exactly`, async () => {
    const img = sample();
    const bytes = await encode(img, f);
    expect(sniff(bytes, `x.${f}`)).toBe(f);
    const back = await decode(bytes, `x.${f}`);
    expect(back.width).toBe(img.width);
    expect(diff(back, img)).toBe(0);
  });
}

for (const f of lossy) {
  test(`${f} round-trips closely`, async () => {
    const img = sample();
    const bytes = await encode(img, f, { quality: 90 });
    expect(sniff(bytes)).toBe(f);
    const back = await decode(bytes);
    expect(back.height).toBe(img.height);
    expect(diff(back, img)).toBeLessThan(12);
  });
}

test("webp and png keep alpha; lossless webp is exact", async () => {
  const img = sample(32, 32, true);
  expect(diff(await decode(await encode(img, "webp", { lossless: true })), img)).toBe(0);
  expect(diff(await decode(await encode(img, "png")), img)).toBe(0);
});

test("palette png is smaller and still close", async () => {
  const img = noisy();
  const full = await encode(img, "png");
  const pal = await encode(img, "png", { colors: 64 });
  expect(pal.length).toBeLessThan(full.length);
  expect(diff(await decode(pal), img)).toBeLessThan(16);
});

test("gif and ico decode back", async () => {
  const img = sample(40, 40);
  const gif = await decode(await encode(img, "gif"));
  expect(gif.width).toBe(40);
  expect(diff(gif, img)).toBeLessThan(16);
  const ico = await encode(img, "ico", { icoSizes: [32, 16] });
  expect(sniff(ico)).toBe("ico");
  expect((await decode(ico)).width).toBe(32);
});
