import { expect, test } from "bun:test";
import { rotate90 } from "../geometry.ts";
import { raster } from "../raster.ts";
import { diff, noisy, sample } from "../test/setup.ts";
import { boxesForGauss, gaussianBlur } from "./blur.ts";
import { attentionRect, parseRatio, percentRect, ratioRect } from "./crop.ts";
import { FILTER_NAMES, applyFilter } from "./filters.ts";
import { borderSize, canvasLayout, frame, roundCorners } from "./frame.ts";
import { applyCube, parseCube } from "./lut.ts";
import { formatRegions, parseRegions, redactRect, toPixels } from "./redact.ts";
import { inscribedSize, rotateFree, rotatedBounds } from "./rotate.ts";
import { fillTokens, placeAt, tilePositions } from "./stamp.ts";
import { adjust, autoEnhance } from "./tone.ts";

test("adjust at neutral settings returns the very same pixels", () => {
  const img = sample();
  expect(adjust(img, {})).toBe(img);
  expect(adjust(img, { exposure: 0, contrast: 0 })).toBe(img);
});

test("every adjustment changes the photo and stays in range", () => {
  const img = noisy(48, 32);
  for (const k of ["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "vignette"] as const) {
    for (const v of [-100, 60]) expect(diff(adjust(img, { [k]: v }), img)).toBeGreaterThan(0.1);
  }
  for (const k of ["sharpness", "blur", "grain"] as const) expect(diff(adjust(img, { [k]: 80 }), img)).toBeGreaterThan(0.1);
  const brighter = adjust(img, { exposure: 50 });
  expect(brighter.data.reduce((a, b) => a + b, 0)).toBeGreaterThan(img.data.reduce((a, b) => a + b, 0));
});

test("gaussian blur keeps a flat image flat and smooths an edge", () => {
  expect(boxesForGauss(3)).toHaveLength(3);
  const flat = raster(20, 20, [100, 150, 200, 255]);
  expect(diff(gaussianBlur(flat, 4), flat)).toBe(0);
  const edge = raster(20, 1, [0, 0, 0, 255]);
  for (let x = 10; x < 20; x++) edge.data.fill(255, x * 4, x * 4 + 3);
  const b = gaussianBlur(edge, 2);
  expect(b.data[9 * 4]!).toBeGreaterThan(40);
  expect(b.data[9 * 4]!).toBeLessThan(200);
});

test("auto enhance stretches a dull photo; strength 0 is identity", () => {
  const dull = sample();
  for (let i = 0; i < dull.data.length; i += 4) for (let c = 0; c < 3; c++) dull.data[i + c] = 80 + dull.data[i + c]! * 0.3;
  expect(autoEnhance(dull, 0, true)).toBe(dull);
  const out = autoEnhance(dull, 1, false);
  expect(Math.max(...out.data.filter((_, i) => i % 4 === 0))).toBeGreaterThan(240);
});

test("filters stay in range and blend by strength", () => {
  const img = noisy(32, 24);
  for (const f of FILTER_NAMES) {
    const out = applyFilter(img, f, 1);
    expect(out.data.length).toBe(img.data.length);
    expect(out.data.every((v) => v >= 0 && v <= 255)).toBe(true);
    expect(applyFilter(img, f, 0)).toBe(img);
  }
  const bw = applyFilter(img, "bw", 1);
  expect(bw.data[0]).toBe(bw.data[1]!);
  expect(diff(applyFilter(img, "bw", 0.5), img)).toBeLessThan(diff(bw, img));
});

test("an identity .cube is the identity", () => {
  const cube = parseCube(["# identity", 'TITLE "id"', "LUT_3D_SIZE 2", "0 0 0", "1 0 0", "0 1 0", "1 1 0", "0 0 1", "1 0 1", "0 1 1", "1 1 1"].join("\n"));
  const img = sample();
  expect(diff(applyCube(img, cube), img)).toBe(0);
  expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0")).toThrow(/should list 8/);
  expect(() => parseCube("hello")).toThrow();
});

test("four quarter turns and a free 360° come back to the start", () => {
  const img = sample(30, 20);
  expect(diff(rotate90(rotate90(rotate90(rotate90(img, 1), 1), 1), 1), img)).toBe(0);
  expect(rotateFree(img, 0)).toBe(img);
});

test("free rotation sizes: bounds, and the largest inscribed rectangle", () => {
  const rad = (10 * Math.PI) / 180;
  const b = rotatedBounds(400, 300, rad);
  expect(b.width).toBe(Math.ceil(400 * Math.cos(rad) + 300 * Math.sin(rad)));
  const ins = inscribedSize(400, 300, rad);
  expect(ins.width).toBeLessThan(400);
  expect(ins.height).toBeLessThan(300);
  // Known result for a square: side / (cos + sin).
  expect(inscribedSize(100, 100, Math.PI / 4).width).toBe(70);
  const out = rotateFree(sample(80, 60), 10, "crop");
  expect([out.width, out.height]).toEqual([inscribedSize(80, 60, rad).width, inscribedSize(80, 60, rad).height]);
  // Cropped: no transparent corner left.
  expect(out.data.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
  const transparent = rotateFree(sample(80, 60), 10, "transparent");
  expect(transparent.data[3]).toBe(0);
});

test("crop rectangles by ratio and anchor", () => {
  expect(parseRatio("4:5")).toBeCloseTo(0.8);
  expect(parseRatio("free")).toBeNull();
  expect(ratioRect(4000, 3000, 1)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  expect(ratioRect(4000, 3000, 1, "left").x).toBe(0);
  expect(ratioRect(4000, 3000, 1, "right").x).toBe(1000);
  expect(ratioRect(3000, 4000, 16 / 9, "top")).toEqual({ x: 0, y: 0, width: 3000, height: 1688 });
  expect(ratioRect(3000, 4000, 16 / 9, "bottom").y).toBe(4000 - 1688);
  expect(percentRect(1000, 500, 10, 20, 50, 50)).toEqual({ x: 100, y: 100, width: 500, height: 250 });
  expect(percentRect(1000, 500, 90, 0, 50, 200)).toEqual({ x: 900, y: 0, width: 100, height: 500 });
});

test("attention crop picks the detailed half of a half-flat photo", () => {
  const img = raster(200, 100, [128, 128, 128, 255]);
  const detail = noisy(100, 100);
  for (let y = 0; y < 100; y++) img.data.set(detail.data.subarray(y * 400, y * 400 + 400), (y * 200 + 100) * 4);
  const r = attentionRect(img, 1);
  expect(r.width).toBe(100);
  expect(r.x).toBeGreaterThan(80);
  // A flat photo stays centred.
  expect(attentionRect(raster(200, 100, [9, 9, 9, 255]), 1).x).toBe(50);
});

test("canvas, border and rounded corners", () => {
  expect(canvasLayout(400, 300, 1, 0)).toEqual({ width: 400, height: 400, x: 0, y: 50 });
  expect(canvasLayout(400, 300, null, 10)).toEqual({ width: 480, height: 380, x: 40, y: 40 });
  expect(canvasLayout(300, 400, 16 / 9, 0).width).toBe(711);
  expect(borderSize(400, 300, { width: 10, bottom: 20 })).toEqual({ width: 460, height: 420, inset: 30, extra: 60 });
  const img = sample(40, 30);
  const framed = frame(img, { width: 10, color: [255, 0, 0, 255], bottom: 0, radius: 0, shadow: false });
  expect([framed.width, framed.height]).toEqual([46, 36]);
  expect(Array.from(framed.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  const round = sample(40, 40);
  roundCorners(round, 10);
  expect(round.data[3]).toBe(0);
  expect(round.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  const shadowed = frame(img, { width: 0, color: [0, 0, 0, 0], bottom: 0, radius: 0, shadow: true });
  expect(shadowed.width).toBeGreaterThan(img.width);
});

test("regions: parse, format, pixels, and hiding them", () => {
  const regions = parseRegions("10,10,20,20; bad ;50,50,0,10;0,0,100,100");
  expect(regions).toHaveLength(2);
  expect(formatRegions(regions)).toBe("10,10,20,20;0,0,100,100");
  expect(toPixels(200, 100, regions[0]!)).toEqual({ x: 20, y: 10, width: 40, height: 20 });
  const img = noisy(64, 64);
  for (const style of ["pixelate", "blur", "fill"] as const) {
    const out = { ...img, data: new Uint8ClampedArray(img.data) };
    redactRect(out, { x: 16, y: 16, width: 32, height: 32 }, style, 80);
    expect(diff(out, img)).toBeGreaterThan(1);
    // Outside the rectangle nothing changes.
    expect(Array.from(out.data.subarray(0, 16))).toEqual(Array.from(img.data.subarray(0, 16)));
  }
});

test("caption tokens, tidy separators, stamp placement", () => {
  const meta = { make: "Canon", model: "Canon EOS R6", taken: "2024-07-14T18:30:05", fnumber: 2.8, exposure: 1 / 250, iso: 400 };
  expect(fillTokens("{date} · {camera}", meta, "IMG_1.jpg")).toBe("2024-07-14 · Canon EOS R6");
  expect(fillTokens("{date} {time} {settings}", meta, "x.jpg")).toBe("2024-07-14 18:30 f/2.8 · 1/250 s · ISO 400");
  expect(fillTokens("{date} · {camera} · {name}", {}, "beach.heic")).toBe("beach");
  expect(fillTokens("© {year} {name}", {}, "a.jpg", new Date("2026-01-02"))).toBe("© 2026 a");
  expect(placeAt(1000, 800, 100, 50, "br", 10)).toEqual({ x: 890, y: 740 });
  expect(placeAt(1000, 800, 100, 50, "tl", 10)).toEqual({ x: 10, y: 10 });
  expect(placeAt(1000, 800, 100, 50, "c", 10)).toEqual({ x: 450, y: 375 });
  expect(tilePositions(1000, 800, 100, 50).length).toBeGreaterThan(20);
});
