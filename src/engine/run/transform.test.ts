import { expect, test } from "bun:test";
import { PRESETS } from "../../tools/transform.ts";
import { decode, encode } from "../codecs.ts";
import { sample } from "../test/setup.ts";
import { cropPlan, resizePlan, runs, splitRects, steps } from "./transform.ts";
import type { StepCtx } from "./types.ts";

const ctx: StepCtx = { progress() {}, check() {}, name: "photo.jpg", format: "jpeg", meta: {} };

test("resize plans for every mode", () => {
  expect(resizePlan(4000, 3000, { by: "long", size: 2048 })).toEqual({ kind: "scale", width: 2048, height: 1536 });
  expect(resizePlan(1000, 500, { by: "long", size: 2048 })).toEqual({ kind: "scale", width: 1000, height: 500 });
  expect(resizePlan(1000, 500, { by: "long", size: 2000, enlarge: true })).toEqual({ kind: "scale", width: 2000, height: 1000 });
  expect(resizePlan(4000, 3000, { by: "width", size: 800 })).toEqual({ kind: "scale", width: 800, height: 600 });
  expect(resizePlan(4000, 3000, { by: "height", size: 300 })).toEqual({ kind: "scale", width: 400, height: 300 });
  expect(resizePlan(4000, 3000, { by: "percent", percent: 25 })).toEqual({ kind: "scale", width: 1000, height: 750 });
  expect(resizePlan(400, 300, { by: "percent", percent: 200 })).toEqual({ kind: "scale", width: 800, height: 600 });
  expect(resizePlan(4000, 3000, { by: "box", width: 1920, height: 1080, fit: "fill" })).toEqual({ kind: "scale", width: 1920, height: 1080 });
  expect(resizePlan(4000, 3000, { by: "box", width: 1920, height: 1080, fit: "inside" })).toEqual({ kind: "scale", width: 1440, height: 1080 });
  expect(resizePlan(4000, 3000, { by: "box", width: 1920, height: 1080, fit: "contain" })).toEqual({ kind: "contain", width: 1440, height: 1080, boxW: 1920, boxH: 1080 });
  expect(resizePlan(4000, 3000, { by: "box", width: 1920, height: 1080, fit: "cover" })).toEqual({ kind: "cover", width: 1920, height: 1440, boxW: 1920, boxH: 1080 });
  // Too small to cover without enlarging: same size, cropped to the box's shape.
  expect(resizePlan(800, 600, { by: "box", width: 1920, height: 1080, fit: "cover" })).toEqual({ kind: "cover", width: 800, height: 600, boxW: 800, boxH: 450 });
});

test("every social preset gives exactly its size with cover", async () => {
  for (const p of PRESETS) {
    const plan = resizePlan(6000, 4000, { by: "preset", preset: p.value, fit: "cover" });
    expect(plan.kind === "cover" && [plan.boxW, plan.boxH]).toEqual([p.w, p.h]);
  }
  const out = await steps.resize!(sample(300, 200), { by: "preset", preset: "ig-portrait", fit: "cover", enlarge: true }, ctx);
  expect([out.width, out.height]).toEqual([1080, 1350]);
  const boxed = await steps.resize!(sample(300, 200), { by: "box", width: 400, height: 400, fit: "contain", background: "#ff0000" }, ctx);
  expect([boxed.width, boxed.height]).toEqual([400, 400]);
  expect(Array.from(boxed.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
});

test("crop plans: ratio and anchors, the editor's rectangle wins", () => {
  const img = sample(400, 300);
  expect(cropPlan(img, { ratio: "1:1", anchor: "center" })).toEqual({ x: 50, y: 0, width: 300, height: 300 });
  expect(cropPlan(img, { ratio: "16:9", anchor: "top" })).toEqual({ x: 0, y: 0, width: 400, height: 225 });
  expect(cropPlan(img, { ratio: "1:1", anchor: "right" }).x).toBe(100);
  expect(cropPlan(img, { ratio: "free" })).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  expect(cropPlan(img, { ratio: "free", x: 25, y: 0, w: 50, h: 100 })).toEqual({ x: 100, y: 0, width: 200, height: 300 });
  expect(cropPlan(img, { ratio: "1:1", x: 0, y: 0, w: 10, h: 10 })).toEqual({ x: 0, y: 0, width: 40, height: 30 });
});

test("rotate, canvas and border steps produce the right sizes", async () => {
  const img = sample(40, 30);
  const turned = await steps.rotate!(img, { turn: "90" }, ctx);
  expect([turned.width, turned.height]).toEqual([30, 40]);
  const back = await steps.rotate!(turned, { turn: "270" }, ctx);
  expect(back.data).toEqual(img.data);
  const sq = await steps.canvas!(img, { ratio: "1:1", margin: 0, fill: "color", color: "#000000" }, ctx);
  expect([sq.width, sq.height]).toEqual([40, 40]);
  const blur = await steps.canvas!(img, { ratio: "9:16", margin: 5, fill: "blur" }, ctx);
  expect(blur.width / blur.height).toBeCloseTo(9 / 16, 1);
  const bordered = await steps.border!(img, { width: 10, color: "#ffffff", bottom: 20, radius: 0 }, ctx);
  expect([bordered.width, bordered.height]).toEqual([46, 42]);
});

test("split cuts tiles in reading order with numbered names", () => {
  const rects = splitRects(300, 100, 3, 1, false);
  expect(rects.map((r) => r.x)).toEqual([0, 100, 200]);
  expect(splitRects(310, 100, 3, 1, true).map((r) => [r.x, r.width])).toEqual([
    [5, 100],
    [105, 100],
    [205, 100],
  ]);
  expect(splitRects(1000, 1000, 3, 3, false).reduce((n, r) => n + r.width * r.height, 0)).toBe(1_000_000);
});

test("split writes one file per tile", async () => {
  const bytes = await encode(sample(90, 60), "png");
  const r = await runs.split!([{ name: "pano.png", bytes }], { cols: 3, rows: 2, format: "keep", metadata: "strip" }, ctx);
  expect(r.files.map((f) => f.name)).toEqual(["pano-1.png", "pano-2.png", "pano-3.png", "pano-4.png", "pano-5.png", "pano-6.png"]);
  const first = await decode(r.files[0]!.bytes);
  expect([first.width, first.height]).toEqual([30, 30]);
});
