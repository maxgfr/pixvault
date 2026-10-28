import { expect, test } from "bun:test";
import { decode, encode } from "../codecs.ts";
import { sniff } from "../formats.ts";
import { noisy, sample } from "../test/setup.ts";
import { runs, type CompressReport, type ConvertReport } from "./optimize.ts";
import type { Ctx } from "./types.ts";

const ctx: Ctx = { progress() {}, check() {} };

test("never returns a bigger file: a small JPEG comes back byte for byte", async () => {
  const small = await encode(sample(64, 48), "jpeg", { quality: 20 });
  const r = await runs.compress!([{ name: "small.jpg", bytes: small }], { mode: "quality", quality: 95, format: "keep" }, ctx);
  expect(r.files[0]!.bytes).toEqual(small);
  const rep = (r.report as CompressReport[])[0]!;
  expect(rep.kept).toBe(true);
  expect(rep.note).toBe("kept-original");
});

test("size mode reaches the target on a noisy photo", async () => {
  const big = await encode(noisy(256, 192), "png");
  const target = 12;
  const r = await runs.compress!([{ name: "noisy.png", bytes: big }], { mode: "size", targetKb: target, format: "jpeg" }, ctx);
  const out = r.files[0]!;
  expect(sniff(out.bytes)).toBe("jpeg");
  expect(out.bytes.length).toBeLessThanOrEqual(target * 1024);
  expect(out.name).toBe("noisy.jpg");
});

test("size mode shrinks the photo when even the lowest quality is too big", async () => {
  const big = await encode(noisy(1024, 768), "png");
  const r = await runs.compress!([{ name: "n.png", bytes: big }], { mode: "size", targetKb: 4, format: "jpeg" }, ctx);
  const rep = (r.report as CompressReport[])[0]!;
  expect(r.files[0]!.bytes.length).toBeLessThanOrEqual(4 * 1024);
  expect(rep.note).toBe("downscaled");
  expect(rep.width).toBeLessThan(1024);
});

test("auto keeps the smallest of the candidates", async () => {
  const img = noisy(160, 120);
  const png = await encode(img, "png");
  const r = await runs.compress!([{ name: "p.png", bytes: png }], { mode: "quality", quality: 70, format: "auto" }, ctx);
  const out = r.files[0]!;
  const sizes = await Promise.all(
    (["webp", "jpeg"] as const).map(async (f) => (await encode(await decode(png), f, { quality: 70 })).length),
  );
  expect(["webp", "avif", "jpeg"]).toContain(sniff(out.bytes)!);
  expect(out.bytes.length).toBeLessThanOrEqual(Math.min(...sizes));
});

test("lossless mode keeps JPEGs untouched and makes PNG pixel-identical", async () => {
  const jpg = await encode(sample(), "jpeg", { quality: 90 });
  const r = await runs.compress!([{ name: "a.jpg", bytes: jpg }], { mode: "lossless", format: "keep" }, ctx);
  expect((r.report as CompressReport[])[0]!.note).toBe("lossless-jpeg");
  const img = sample(80, 60);
  const fat = await (await import("../codecs.ts")).encodePngFast(img);
  const p = await runs.compress!([{ name: "b.png", bytes: fat }], { mode: "lossless", format: "keep" }, ctx);
  const back = await decode(p.files[0]!.bytes);
  expect(back.data).toEqual(img.data);
});

test("maxSide shrinks the photo", async () => {
  const png = await encode(noisy(300, 200), "png");
  const r = await runs.compress!([{ name: "x.png", bytes: png }], { mode: "quality", quality: 80, format: "webp", maxSide: 150 }, ctx);
  const back = await decode(r.files[0]!.bytes);
  expect([back.width, back.height]).toEqual([150, 100]);
});

test("convert writes every format", async () => {
  const src = await encode(sample(48, 32), "png");
  for (const to of ["jpeg", "png", "webp", "avif", "jxl", "gif", "tiff", "bmp", "ico", "qoi"] as const) {
    const r = await runs.convert!([{ name: "s.png", bytes: src }], { to }, ctx);
    expect(sniff(r.files[0]!.bytes, r.files[0]!.name)).toBe(to);
    expect((r.report as ConvertReport[])[0]!.to).toBe(to);
  }
  const pdf = await runs.convert!([{ name: "s.png", bytes: src }], { to: "pdf" }, ctx);
  expect(new TextDecoder().decode(pdf.files[0]!.bytes.subarray(0, 5))).toBe("%PDF-");
  expect(pdf.files[0]!.name).toBe("s.pdf");
});
