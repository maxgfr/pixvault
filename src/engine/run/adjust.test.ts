import { expect, test } from "bun:test";
import { diff, noisy, sample } from "../test/setup.ts";
import { adjustments, steps } from "./adjust.ts";
import type { StepCtx } from "./types.ts";

const ctx: StepCtx = { progress() {}, check() {}, name: "photo.jpg", format: "jpeg", meta: {} };

test("adjust with every slider at 0 returns the input untouched", async () => {
  const img = sample();
  const o = Object.fromEntries(["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "sharpness", "blur", "vignette", "grain"].map((k) => [k, 0]));
  expect(await steps.adjust!(img, o, ctx)).toBe(img);
  expect(adjustments({ sharpness: -50, exposure: 300 })).toEqual({ exposure: 100 });
});

test("filter, auto enhance and LUT steps", async () => {
  const img = noisy(32, 24);
  expect(diff(await steps.filter!(img, { filter: "sepia", strength: 100 }, ctx), img)).toBeGreaterThan(1);
  expect(await steps.filter!(img, { filter: "sepia", strength: 0 }, ctx)).toBe(img);
  expect((await steps["auto-enhance"]!(img, { strength: 70, whiteBalance: true }, ctx)).width).toBe(32);
  const cube = new TextEncoder().encode("LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n");
  expect(diff(await steps.lut!(img, { cube, strength: 100 }, ctx), img)).toBe(0);
  const invert = new TextEncoder().encode("LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n");
  const inv = await steps.lut!(img, { cube: invert, strength: 100 }, ctx);
  expect(inv.data[0]).toBe(255 - img.data[0]!);
  expect(() => steps.lut!(img, {}, ctx)).toThrow(/cube/);
});
