import { expect, test } from "bun:test";
import { encode } from "../codecs.ts";
import { raster } from "../raster.ts";
import { resize } from "../resize.ts";
import { noisy } from "../test/setup.ts";
import { type Base64Report, type DuplicatesReport, type HistogramReport, type PaletteReport, runs } from "./analyze.ts";
import type { Ctx } from "./types.ts";

const ctx: Ctx = { progress() {}, check() {} };

test("palette finds both colours of a two-colour image", async () => {
  const r = raster(40, 20, [220, 30, 30, 255]);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 15; x++) r.data.set([20, 60, 200, 255], (y * 40 + x) * 4);
  const out = await runs.palette!([{ name: "a.png", bytes: await encode(r, "png") }], { count: 2 }, ctx);
  const colors = (out.report as PaletteReport[])[0]!.colors;
  expect(colors.map((c) => c.hex)).toEqual(["#dc1e1e", "#143cc8"]);
  expect(colors[0]!.share).toBeCloseTo(25 / 40, 5);
});

test("histogram counts every pixel", async () => {
  const img = noisy(50, 40);
  const out = await runs.histogram!([{ name: "n.png", bytes: await encode(img, "png") }], {}, ctx);
  const h = (out.report as HistogramReport[])[0]!;
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  expect(h.pixels).toBe(2000);
  expect(sum(h.r)).toBe(2000);
  expect(sum(h.luma)).toBe(2000);
  expect(h.mean).toBeGreaterThan(0);
  const black = await runs.histogram!([{ name: "b.png", bytes: await encode(raster(10, 10, [0, 0, 0, 255]), "png") }], {}, ctx);
  expect((black.report as HistogramReport[])[0]!.hint).toBe("under");
});

test("duplicates: a resized copy is found, an unrelated photo is not", async () => {
  const a = noisy(128, 96);
  const copy = await resize(a, 64, 48);
  const other = noisy(128, 96);
  for (let i = 0; i < other.data.length; i += 4) for (let c = 0; c < 3; c++) other.data[i + c] = 255 - other.data[i + c]!;
  const inputs = [
    { name: "a.png", bytes: await encode(a, "png") },
    { name: "other.png", bytes: await encode(other, "png") },
    { name: "a-small.jpg", bytes: await encode(copy, "jpeg", { quality: 70 }) },
  ];
  const out = await runs.duplicates!(inputs, { threshold: 90 }, ctx);
  const rep = out.report as DuplicatesReport;
  expect(rep.groups.map((g) => g.indices)).toEqual([[0, 2]]);
  expect(rep.photos).toHaveLength(3);
});

test("base64 data URI", async () => {
  const bytes = await encode(raster(4, 4, [1, 2, 3, 255]), "png");
  const out = await runs.base64!([{ name: "t.png", bytes }], {}, ctx);
  const rep = (out.report as Base64Report[])[0]!;
  expect(rep.dataUri.startsWith("data:image/png;base64,")).toBe(true);
  expect(Buffer.from(rep.dataUri.split(",")[1]!, "base64")).toEqual(Buffer.from(bytes));
  expect(rep.large).toBe(false);
});
