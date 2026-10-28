// Runs the self-hosted models for real (bun scripts/fetch-models.ts first).
// BiRefNet and Florence-2 need WebGPU-sized memory and are checked in the browser.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { MODELS, type ModelId } from "../../ai/catalog.ts";
import { faceCrop } from "../run/ai.ts";
import { raster } from "../raster.ts";
import { sample } from "../test/setup.ts";
import { cutOut, matte } from "./background.ts";
import { decodeYunet, detectFaces, nms } from "./faces.ts";
import { erase, windowFor } from "./inpaint.ts";
import { setAiLoaders } from "./runtime.ts";
import { tileStarts, upscale } from "./upscale.ts";

const models = new URL("../../../models/", import.meta.url).pathname;
const ready = existsSync(`${models}faces`);

beforeAll(() => {
  setAiLoaders({
    ort: async () => {
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = new URL("../../../node_modules/onnxruntime-web/dist/", import.meta.url).href;
      return ort as never;
    },
    files: async (id: ModelId) => Promise.all(MODELS[id].files.map(async (f) => new Uint8Array(await Bun.file(`${models}${id}/${f.path.split("/").pop()}`).arrayBuffer()))),
  });
});

test("tiles cover the whole side and end flush", () => {
  expect(tileStarts(50, 64)).toEqual([0]);
  expect(tileStarts(120, 64)).toEqual([0, 56]);
  expect(tileStarts(200, 64)).toEqual([0, 56, 112, 136]);
});

test("YuNet decoding and non-maximum suppression", () => {
  const zero = (n: number) => ({ data: new Float32Array(n) });
  const out: Record<string, { data: Float32Array }> = {};
  for (const s of [8, 16, 32]) {
    const n = (640 / s) ** 2;
    out[`cls_${s}`] = zero(n);
    out[`obj_${s}`] = zero(n);
    out[`bbox_${s}`] = zero(n * 4);
  }
  // One confident face at cell (10, 5) of stride 16: centre (5*16, 10*16), size 2^0*16.
  const i = 10 * 40 + 5;
  out.cls_16!.data[i] = 0.9;
  out.obj_16!.data[i] = 0.9;
  const faces = decodeYunet(out, 0.5);
  expect(faces).toHaveLength(1);
  expect(faces[0]).toMatchObject({ x: 72, y: 152, width: 16, height: 16 });
  expect(nms([...faces, { ...faces[0]!, x: 73, score: 0.5 }])).toHaveLength(1);
});

test("a face crop keeps the face inside", () => {
  const r = faceCrop(4000, 3000, 1, [{ x: 3000, y: 500, width: 400, height: 400 }]);
  expect(r.width).toBe(3000);
  expect(r.x).toBeLessThanOrEqual(3000);
  expect(r.x + r.width).toBeGreaterThanOrEqual(3400);
});

test("the eraser window wraps the strokes with context", () => {
  const mask = new Uint8Array(1000 * 800);
  for (let y = 400; y < 420; y++) for (let x = 500; x < 560; x++) mask[y * 1000 + x] = 1;
  const w = windowFor(1000, 800, mask)!;
  expect(w.width).toBe(256);
  expect(w.x).toBeLessThanOrEqual(500);
  expect(w.x + w.width).toBeGreaterThanOrEqual(560);
});

describe.if(ready)("with the models", () => {
  test("MODNet returns a matte, cutOut makes transparency", async () => {
    const r = sample(96, 64);
    const alpha = await matte(r, "background-lite");
    expect(alpha.length).toBe(96 * 64);
    const out = cutOut(r, alpha, { fill: "transparent" });
    expect(out.width).toBe(96);
  }, 60_000);

  test("YuNet finds no face in a gradient", async () => {
    expect(await detectFaces(sample(320, 240))).toEqual([]);
  }, 60_000);

  test("MI-GAN fills only the painted pixels", async () => {
    const r = sample(300, 200);
    const mask = new Uint8Array(300 * 200);
    for (let y = 90; y < 110; y++) for (let x = 140; x < 160; x++) mask[y * 300 + x] = 1;
    const out = await erase(r, mask);
    expect(out.data[0]).toBe(r.data[0]!);
    let changed = 0;
    for (let i = 0; i < mask.length; i++) if (!mask[i] && out.data[i * 4] !== r.data[i * 4]) changed++;
    expect(changed).toBe(0);
  }, 60_000);

  test("Swin2SR doubles the size", async () => {
    const out = await upscale(raster(20, 12, [120, 60, 30, 255]), 2);
    expect([out.width, out.height]).toEqual([40, 24]);
    expect(Math.abs(out.data[0]! - 120)).toBeLessThan(25);
  }, 120_000);
});
