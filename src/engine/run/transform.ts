// Resize, crop, rotate, canvas, border and split: geometry tools.

import { PRESETS } from "../../tools/transform.ts";
import type { Options } from "../../tools/types.ts";
import { decode } from "../codecs.ts";
import { rename, sniff } from "../formats.ts";
import { crop as cropRect, flip, rotate90 } from "../geometry.ts";
import { readMeta } from "../meta/read.ts";
import { type Anchor, attentionRect, parseRatio, percentRect, ratioRect, type Rect } from "../ops/crop.ts";
import { draw } from "../ops/canvas.ts";
import { blurredBackdrop, canvasLayout, frame } from "../ops/frame.ts";
import { type CornerFill, rotateFree } from "../ops/rotate.ts";
import { writeOutput } from "../output.ts";
import { parseColor, raster, type Raster } from "../raster.ts";
import { fitSize, type Method, resize } from "../resize.ts";
import { bool, num, type RunFn, type StepFn, str } from "./types.ts";

export type ResizePlan =
  /** Scale to exactly this size. */
  | { kind: "scale"; width: number; height: number }
  /** Scale to width×height, then crop the centre to boxW×boxH. */
  | { kind: "cover"; width: number; height: number; boxW: number; boxH: number }
  /** Scale to width×height and centre it on a boxW×boxH background. */
  | { kind: "contain"; width: number; height: number; boxW: number; boxH: number };

/** What "Resize" does to a w×h photo with these options (pure: the editor and the tests use it too). */
export function resizePlan(w: number, h: number, o: Options): ResizePlan {
  const by = str(o.by, "long");
  const enlarge = bool(o.enlarge);
  const cap = (s: number) => (enlarge ? s : Math.min(1, s));
  const scaled = (s: number): ResizePlan => ({ kind: "scale", width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) });
  const size = Math.max(1, num(o.size, 2048));
  switch (by) {
    case "width":
      return scaled(cap(size / w));
    case "height":
      return scaled(cap(size / h));
    case "percent":
      // An explicit percentage above 100 is a request to enlarge.
      return scaled(Math.max(0.01, num(o.percent, 50) / 100));
    case "box":
    case "preset": {
      const preset = PRESETS.find((p) => p.value === str(o.preset, "ig-square")) ?? PRESETS[0]!;
      const boxW = Math.max(1, Math.round(by === "box" ? num(o.width, 1920) : preset.w));
      const boxH = Math.max(1, Math.round(by === "box" ? num(o.height, 1080) : preset.h));
      const fit = str(o.fit, "cover");
      if (fit === "fill") return { kind: "scale", width: boxW, height: boxH };
      if (fit === "inside") return { kind: "scale", ...fitSize(w, h, boxW, boxH, "inside", enlarge) };
      if (fit === "contain") return { kind: "contain", ...fitSize(w, h, boxW, boxH, "inside", enlarge), boxW, boxH };
      const s = Math.max(boxW / w, boxH / h);
      if (s > 1 && !enlarge) {
        // Too small to fill the box without enlarging: keep the size, crop to the box's shape.
        const r = ratioRect(w, h, boxW / boxH);
        return { kind: "cover", width: w, height: h, boxW: r.width, boxH: r.height };
      }
      return { kind: "cover", width: Math.max(boxW, Math.round(w * s)), height: Math.max(boxH, Math.round(h * s)), boxW, boxH };
    }
    default:
      return scaled(cap(size / Math.max(w, h)));
  }
}

const METHODS = new Set(["lanczos3", "mitchell", "catrom", "triangle"]);

const resizeStep: StepFn = async (r, o) => {
  const plan = resizePlan(r.width, r.height, o);
  const method = (METHODS.has(str(o.method)) ? str(o.method) : "lanczos3") as Method;
  const scaled = await resize(r, plan.width, plan.height, method);
  if (plan.kind === "scale") return scaled;
  if (plan.kind === "cover") {
    const rect = ratioRect(scaled.width, scaled.height, plan.boxW / plan.boxH);
    return cropRect(scaled, rect.x, rect.y, Math.min(rect.width, plan.boxW), Math.min(rect.height, plan.boxH));
  }
  const out = raster(plan.boxW, plan.boxH, parseColor(str(o.background, "#ffffff")));
  draw(out, scaled, Math.floor((plan.boxW - scaled.width) / 2), Math.floor((plan.boxH - scaled.height) / 2));
  return out;
};

const ANCHORS = new Set(["center", "top", "bottom", "left", "right", "attention"]);

/** The rectangle "Crop" keeps: the editor's percentages when given, else the ratio placed by its anchor. */
export function cropPlan(r: Raster, o: Options): Rect {
  const has = ["x", "y", "w", "h"].every((k) => o[k] !== undefined && o[k] !== "" && Number.isFinite(num(o[k], Number.NaN)));
  if (has) return percentRect(r.width, r.height, num(o.x, 0), num(o.y, 0), num(o.w, 100), num(o.h, 100));
  const ratio = parseRatio(str(o.ratio, "1:1"));
  if (!ratio) return { x: 0, y: 0, width: r.width, height: r.height };
  const anchor = (ANCHORS.has(str(o.anchor)) ? str(o.anchor) : "center") as Anchor;
  return anchor === "attention" ? attentionRect(r, ratio) : ratioRect(r.width, r.height, ratio, anchor);
}

const cropStep: StepFn = (r, o) => {
  const rect = cropPlan(r, o);
  return cropRect(r, rect.x, rect.y, rect.width, rect.height);
};

const rotateStep: StepFn = (r, o) => {
  let out = rotate90(r, Math.round(num(o.turn, 0) / 90));
  const angle = num(o.angle, 0);
  if (Math.abs(angle) >= 0.01) {
    const fill = (["crop", "color", "transparent"].includes(str(o.fill)) ? str(o.fill) : "crop") as CornerFill;
    out = rotateFree(out, angle, fill, parseColor(str(o.background, "#ffffff")));
  }
  return flip(out, bool(o.flipH), bool(o.flipV));
};

const canvasStep: StepFn = async (r, o) => {
  const ratio = str(o.ratio, "1:1") === "margin" ? null : parseRatio(str(o.ratio, "1:1"));
  const layout = canvasLayout(r.width, r.height, ratio, num(o.margin, 5));
  if (layout.width === r.width && layout.height === r.height) return r;
  const fill = str(o.fill, "blur");
  const out = fill === "blur" ? await blurredBackdrop(r, layout.width, layout.height) : raster(layout.width, layout.height, fill === "color" ? parseColor(str(o.color, "#ffffff")) : [0, 0, 0, 0]);
  draw(out, r, layout.x, layout.y);
  return out;
};

const borderStep: StepFn = (r, o) =>
  frame(r, {
    width: num(o.width, 3),
    color: parseColor(str(o.color, "#ffffff")),
    bottom: num(o.bottom, 0),
    radius: num(o.radius, 0),
    shadow: bool(o.shadow),
  });

/** Tile rectangles for a cols×rows split; square tiles use the largest square that fits, centred. */
export function splitRects(w: number, h: number, cols: number, rows: number, square: boolean): Rect[] {
  cols = Math.max(1, Math.min(20, Math.round(cols)));
  rows = Math.max(1, Math.min(20, Math.round(rows)));
  let tw = w / cols;
  let th = h / rows;
  let ox = 0;
  let oy = 0;
  if (square) {
    tw = th = Math.min(tw, th);
    ox = (w - tw * cols) / 2;
    oy = (h - th * rows) / 2;
  }
  const out: Rect[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const x0 = Math.round(ox + x * tw);
      const y0 = Math.round(oy + y * th);
      out.push({ x: x0, y: y0, width: Math.round(ox + (x + 1) * tw) - x0, height: Math.round(oy + (y + 1) * th) - y0 });
    }
  }
  return out;
}

const split: RunFn = async (inputs, o, ctx) => {
  const files = [];
  for (const input of inputs) {
    const format = sniff(input.bytes, input.name);
    if (!format) continue;
    const meta = await readMeta(input.bytes);
    const r = await decode(input.bytes, input.name);
    const rects = splitRects(r.width, r.height, num(o.cols, 3), num(o.rows, 1), bool(o.square));
    for (const [i, rect] of rects.entries()) {
      ctx.check();
      ctx.progress(i, rects.length, input.name);
      const tile = cropRect(r, rect.x, rect.y, rect.width, rect.height);
      // Numbered in reading order: photo-1, photo-2… (the carousel order).
      const name = rename(input.name, input.name.split(".").pop() ?? "jpg", String(i + 1));
      files.push(await writeOutput(tile, o, { name, bytes: input.bytes, format, meta }));
    }
  }
  return { files };
};

export const steps: Record<string, StepFn> = { resize: resizeStep, crop: cropStep, rotate: rotateStep, canvas: canvasStep, border: borderStep };
export const runs: Record<string, RunFn> = { split };
