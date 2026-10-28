// Light, colour, looks and LUTs.

import type { Options } from "../../tools/types.ts";
import { DecodeError } from "../errors.ts";
import { applyCube, type Cube, parseCube } from "../ops/lut.ts";
import { applyFilter } from "../ops/filters.ts";
import { type Adjustments, adjust, autoEnhance } from "../ops/tone.ts";
import { bool, bytesOf, num, type RunFn, type StepFn, str } from "./types.ts";

const SLIDERS = ["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "sharpness", "blur", "vignette", "grain"] as const;

/** The adjust tool's options as numbers, clamped to their declared ranges. */
export function adjustments(o: Options): Adjustments {
  const a: Adjustments = {};
  for (const k of SLIDERS) {
    const lo = k === "sharpness" || k === "blur" || k === "grain" ? 0 : -100;
    const v = Math.max(lo, Math.min(100, num(o[k], 0)));
    if (v) a[k] = v;
  }
  return a;
}

const adjustStep: StepFn = (r, o) => adjust(r, adjustments(o));

const autoStep: StepFn = (r, o) => autoEnhance(r, Math.max(0, Math.min(100, num(o.strength, 70))) / 100, bool(o.whiteBalance, true));

const filterStep: StepFn = (r, o) =>
  applyFilter(r, str(o.filter, "bw"), Math.max(0, Math.min(100, num(o.strength, 100))) / 100, { dark: str(o.dark), light: str(o.light), levels: num(o.levels, 4) });

// A batch applies the same LUT to every photo: parse it once.
let lastCube: { bytes: Uint8Array; cube: Cube } | null = null;

const lutStep: StepFn = (r, o) => {
  const bytes = bytesOf(o.cube);
  if (!bytes?.length) throw new DecodeError("choose a .cube file first", "bad-options");
  if (lastCube?.bytes !== bytes) lastCube = { bytes, cube: parseCube(new TextDecoder().decode(bytes)) };
  return applyCube(r, lastCube.cube, Math.max(0, Math.min(100, num(o.strength, 100))) / 100);
};

export const steps: Record<string, StepFn> = { adjust: adjustStep, "auto-enhance": autoStep, filter: filterStep, lut: lutStep };
export const runs: Record<string, RunFn> = {};
