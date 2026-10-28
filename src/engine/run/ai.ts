// The on-device AI tools. Each pixel tool is a step like any other (so it
// previews and chains into recipes); "describe" writes text, not pixels.

import { describe as florence } from "../ai/caption.ts";
import { cutOut, matte } from "../ai/background.ts";
import { detectFaces } from "../ai/faces.ts";
import { erase, maskFor } from "../ai/inpaint.ts";
import { upscale } from "../ai/upscale.ts";
import { decode } from "../codecs.ts";
import { slug } from "../compose/draw.ts";
import { DecodeError } from "../errors.ts";
import { sniff } from "../formats.ts";
import { crop as cropTo } from "../geometry.ts";
import { setMeta } from "../meta/containers.ts";
import { buildXmp } from "../meta/exif-write.ts";
import { attentionRect, parseRatio, type Rect } from "../ops/crop.ts";
import { redactRect, type RedactStyle } from "../ops/redact.ts";
import type { Raster } from "../raster.ts";
import { fitSize, resize } from "../resize.ts";
import { bool, bytesOf, num, type Output, type RunFn, type StepFn, str } from "./types.ts";

const removeBg: StepFn = async (r, o) => cutOut(r, await matte(r), { fill: str(o.fill, "transparent") as "transparent" | "color" | "blur", color: str(o.color, "#ffffff"), trim: bool(o.trim) });

const upscaleStep: StepFn = (r, o, ctx) => upscale(r, str(o.scale, "2") === "4" ? 4 : 2, ctx);

const blurFaces: StepFn = async (r, o) => {
  const faces = await detectFaces(r, num(o.confidence, 60) / 100);
  if (!faces.length) return r;
  const out: Raster = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
  const grow = num(o.grow, 25) / 100;
  for (const f of faces) {
    const gx = f.width * grow;
    const gy = f.height * grow;
    const rect: Rect = { x: Math.max(0, Math.round(f.x - gx)), y: Math.max(0, Math.round(f.y - gy * 1.2)), width: 0, height: 0 };
    rect.width = Math.min(r.width - rect.x, Math.round(f.width + 2 * gx));
    rect.height = Math.min(r.height - rect.y, Math.round(f.height + 2.2 * gy));
    redactRect(out, rect, str(o.style, "blur") as RedactStyle, num(o.strength, 70), "#000000", true);
  }
  return out;
};

/** The crop at `ratio` that keeps every face it can, centred on them; the busiest area when there is none. */
export function faceCrop(w: number, h: number, ratio: number, faces: Rect[]): Rect {
  const cw = Math.min(w, Math.round(h * ratio));
  const ch = Math.min(h, Math.round(w / ratio));
  const area = (f: Rect) => f.width * f.height;
  const total = faces.reduce((n, f) => n + area(f), 0);
  const cx = faces.reduce((n, f) => n + (f.x + f.width / 2) * area(f), 0) / total;
  // Faces sit in the upper third of a good portrait crop.
  const cy = faces.reduce((n, f) => n + (f.y + f.height / 2) * area(f), 0) / total + ch / 6;
  return { x: Math.round(Math.max(0, Math.min(w - cw, cx - cw / 2))), y: Math.round(Math.max(0, Math.min(h - ch, cy - ch / 2))), width: cw, height: ch };
}

const smartCrop: StepFn = async (r, o) => {
  const ratio = parseRatio(str(o.ratio, "1:1")) ?? 1;
  const faces = await detectFaces(r, 0.6);
  const rect = faces.length ? faceCrop(r.width, r.height, ratio, faces) : attentionRect(r, ratio);
  return cropTo(r, rect.x, rect.y, rect.width, rect.height);
};

const eraseStep: StepFn = async (r, o) => {
  const mask = bytesOf(o.mask);
  if (!mask) throw new DecodeError("paint over what to erase first", "bad-options");
  return erase(r, await maskFor(r, mask));
};

export interface DescribeReport {
  name: string;
  caption: string;
  keywords: string[];
}

/** Captions come from Florence-2 here, or from the user's AI provider (computed by the page, passed as `captions`). */
const describe: RunFn = async (inputs, o, ctx) => {
  const given = (() => {
    try {
      return JSON.parse(str(o.captions, "null")) as { caption: string; keywords: string[] }[] | null;
    } catch {
      return null;
    }
  })();
  const report: DescribeReport[] = [];
  const files: Output[] = [];
  const write = str(o.write, "report");
  for (const [i, input] of inputs.entries()) {
    ctx.progress(i, inputs.length, input.name);
    let d = given?.[i];
    if (!d) {
      const full = await decode(input.bytes, input.name);
      const { width, height } = fitSize(full.width, full.height, 768, 768, "inside", false);
      d = await florence(await resize(full, width, height, "triangle"), str(o.detail, "short") === "long" ? "long" : "short");
    }
    report.push({ name: input.name, ...d });
    const ext = input.name.includes(".") ? input.name.split(".").pop()! : "jpg";
    if (write === "txt") files.push({ name: input.name.replace(/\.[^.]+$/, "") + ".txt", bytes: new TextEncoder().encode(`${d.caption}\n${d.keywords.length ? `\n${d.keywords.join(", ")}\n` : ""}`), mime: "text/plain" });
    else if (write === "rename") files.push({ name: `${slug(d.caption).slice(0, 60) || "photo"}.${ext}`, bytes: input.bytes, mime: "image/" + (sniff(input.bytes) ?? "jpeg") });
    else if (write === "embed") {
      const out = setMeta(input.bytes, { xmp: buildXmp({ description: d.caption, keywords: d.keywords }) });
      if (out !== input.bytes) files.push({ name: input.name, bytes: out, mime: "image/" + sniff(out) });
    }
  }
  return { files, report };
};

export const steps: Record<string, StepFn> = { "remove-bg": removeBg, upscale: upscaleStep, "blur-faces": blurFaces, "smart-crop": smartCrop, erase: eraseStep };
export const runs: Record<string, RunFn> = { describe };
