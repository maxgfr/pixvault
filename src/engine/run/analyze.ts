// Report tools: they read photos and describe them; no file comes out.

import { palette, type Swatch } from "../analyze/palette.ts";
import { histogram, type HistogramReport } from "../analyze/histogram.ts";
import { groupSimilar, photoHash } from "../analyze/hash.ts";
import { decode } from "../codecs.ts";
import { DecodeError } from "../errors.ts";
import { FORMATS, sniff } from "../formats.ts";
import { fitSize, resize } from "../resize.ts";
import { num, type RunFn, type StepFn } from "./types.ts";

export type { HistogramReport, Swatch };

export const steps: Record<string, StepFn> = {};

export interface PaletteReport {
  name: string;
  colors: Swatch[];
}

export interface DuplicatesReport {
  groups: { indices: number[]; similarity: number }[];
  photos: { name: string; width: number; height: number; bytes: number; hash: string }[];
}

export interface Base64Report {
  name: string;
  mime: string;
  bytes: number;
  base64Length: number;
  dataUri: string;
  /** Over 1 MB: too big to inline sensibly. */
  large: boolean;
}

function base64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const paletteRun: RunFn = async (inputs, o, ctx) => {
  const report: PaletteReport[] = [];
  for (const [i, input] of inputs.entries()) {
    ctx.progress(i, inputs.length, input.name);
    const r = await decode(input.bytes, input.name);
    const s = fitSize(r.width, r.height, 128, 128, "inside", false);
    const small = s.width === r.width ? r : await resize(r, s.width, s.height, "triangle");
    report.push({ name: input.name, colors: palette(small, num(o.count, 6)) });
  }
  return { files: [], report };
};

const histogramRun: RunFn = async (inputs, _o, ctx) => {
  const report: (HistogramReport & { name: string })[] = [];
  for (const [i, input] of inputs.entries()) {
    ctx.progress(i, inputs.length, input.name);
    report.push({ name: input.name, ...histogram(await decode(input.bytes, input.name)) });
  }
  return { files: [], report };
};

const duplicates: RunFn = async (inputs, o, ctx) => {
  const hashes = [];
  const photos: DuplicatesReport["photos"] = [];
  for (const [i, input] of inputs.entries()) {
    ctx.check();
    ctx.progress(i, inputs.length, input.name);
    const r = await decode(input.bytes, input.name);
    const h = await photoHash(r);
    hashes.push(h);
    photos.push({ name: input.name, width: r.width, height: r.height, bytes: input.bytes.length, hash: h.p.toString(16).padStart(16, "0") + h.d.toString(16).padStart(16, "0") });
  }
  const threshold = Math.max(0.5, Math.min(1, num(o.threshold, 90) / 100));
  const report: DuplicatesReport = { groups: groupSimilar(hashes, threshold), photos };
  return { files: [], report };
};

const base64Run: RunFn = async (inputs) => {
  const report: Base64Report[] = inputs.map((input) => {
    const format = sniff(input.bytes, input.name);
    if (!format) throw new DecodeError("this is not an image format pixvault reads", "unsupported");
    const mime = FORMATS[format].mime;
    const b64 = base64(input.bytes);
    return { name: input.name, mime, bytes: input.bytes.length, base64Length: b64.length, dataUri: `data:${mime};base64,${b64}`, large: input.bytes.length > 1024 * 1024 };
  });
  return { files: [], report };
};

export const runs: Record<string, RunFn> = { palette: paletteRun, histogram: histogramRun, duplicates, base64: base64Run };
