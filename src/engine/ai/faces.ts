// Face detection with YuNet (OpenCV Zoo): a 640×640 pass over the whole
// photo, plus overlapping quarters on big photos so small faces are found.

import type { Rect } from "../ops/crop.ts";
import type { Raster } from "../raster.ts";
import { resize } from "../resize.ts";
import { ort, session } from "./runtime.ts";

export interface Face extends Rect {
  score: number;
}

const SIZE = 640;
const STRIDES = [8, 16, 32];

/** Decode YuNet's per-stride outputs (already sigmoid-activated) into boxes in the 640 frame. */
export function decodeYunet(out: Record<string, { data: ArrayLike<number> }>, threshold: number): Face[] {
  const faces: Face[] = [];
  for (const s of STRIDES) {
    const cols = SIZE / s;
    const cls = out[`cls_${s}`]!.data;
    const obj = out[`obj_${s}`]!.data;
    const box = out[`bbox_${s}`]!.data;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i]!)) * Math.min(1, Math.max(0, obj[i]!)));
      if (score < threshold) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cx = (c + box[i * 4]!) * s;
      const cy = (r + box[i * 4 + 1]!) * s;
      const w = Math.exp(box[i * 4 + 2]!) * s;
      const h = Math.exp(box[i * 4 + 3]!) * s;
      faces.push({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, score });
    }
  }
  return faces;
}

const iou = (a: Rect, b: Rect) => {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
};

export function nms(faces: Face[], threshold = 0.3): Face[] {
  const kept: Face[] = [];
  for (const f of [...faces].sort((a, b) => b.score - a.score)) if (kept.every((k) => iou(k, f) < threshold)) kept.push(f);
  return kept;
}

async function pass(r: Raster, region: Rect, threshold: number): Promise<Face[]> {
  const o = await ort();
  const s = await session("faces");
  const k = SIZE / Math.max(region.width, region.height);
  const w = Math.max(1, Math.round(region.width * k));
  const h = Math.max(1, Math.round(region.height * k));
  const cropped = region.x || region.y || region.width !== r.width || region.height !== r.height ? (await import("../geometry.ts")).crop(r, region.x, region.y, region.width, region.height) : r;
  const small = await resize(cropped, w, h, "triangle");
  // Letterboxed at the top left, BGR, 0–255.
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      input[y * SIZE + x] = small.data[p + 2]!;
      input[plane + y * SIZE + x] = small.data[p + 1]!;
      input[2 * plane + y * SIZE + x] = small.data[p]!;
    }
  }
  const out = await s.run({ input: new o.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  return decodeYunet(out as never, threshold).map((f) => ({ ...f, x: region.x + f.x / k, y: region.y + f.y / k, width: f.width / k, height: f.height / k }));
}

export async function detectFaces(r: Raster, confidence = 0.6): Promise<Face[]> {
  const found = await pass(r, { x: 0, y: 0, width: r.width, height: r.height }, confidence);
  if (Math.max(r.width, r.height) > 1280) {
    const w = Math.round(r.width * 0.55);
    const h = Math.round(r.height * 0.55);
    for (const [x, y] of [[0, 0], [r.width - w, 0], [0, r.height - h], [r.width - w, r.height - h]] as const) found.push(...(await pass(r, { x, y, width: w, height: h }, confidence)));
  }
  return nms(found).filter((f) => f.width > 4 && f.height > 4);
}
