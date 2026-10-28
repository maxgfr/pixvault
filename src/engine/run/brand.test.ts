import { expect, test } from "bun:test";
import { canDrawText } from "../ops/text.ts";
import { diff, noisy } from "../test/setup.ts";
import { logoSize, steps } from "./brand.ts";
import type { StepCtx } from "./types.ts";

const ctx: StepCtx = { progress() {}, check() {}, name: "photo.jpg", format: "jpeg", meta: { taken: "2024-07-14T18:30:00", model: "X100V", make: "FUJIFILM" } };

test("logo size follows the size setting", () => {
  expect(logoSize(400, 200, 1000, 4)).toEqual({ width: 160, height: 80 });
  expect(logoSize(100, 300, 1000, 50).height).toBe(1000);
});

test("redact hides drawn areas and does nothing without any", async () => {
  const img = noisy(64, 48);
  expect(await steps.redact!(img, { regions: "" }, ctx)).toBe(img);
  const out = await steps.redact!(img, { regions: "0,0,50,50", style: "pixelate", strength: 60 }, ctx);
  expect(diff(out, img)).toBeGreaterThan(1);
});

test("watermark needs a logo when set to image", async () => {
  await expect(Promise.resolve().then(() => steps.watermark!(noisy(), { kind: "image" }, ctx))).rejects.toThrow(/logo/);
});

test.skipIf(!canDrawText())("text watermark and caption draw on the photo", async () => {
  const img = noisy(200, 150);
  expect(diff(await steps.watermark!(img, { kind: "text", text: "© {year}", size: 10 }, ctx), img)).toBeGreaterThan(0);
  const cap = await steps.caption!(img, { text: "{date}", place: "below", size: 5 }, ctx);
  expect(cap.height).toBeGreaterThan(150);
});
