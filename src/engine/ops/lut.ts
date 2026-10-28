// 3D LUTs in the .cube format (Adobe/Resolve): parsed once, applied with
// trilinear interpolation.

import { DecodeError } from "../errors.ts";
import { clone, type Raster } from "../raster.ts";

export interface Cube {
  size: number;
  /** size³ RGB triples, red varying fastest. */
  table: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
}

export function parseCube(text: string): Cube {
  let size = 0;
  let min: [number, number, number] = [0, 0, 0];
  let max: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(/\s+/);
    const upper = key!.toUpperCase();
    if (upper === "LUT_3D_SIZE") size = Number(rest[0]);
    else if (upper === "LUT_1D_SIZE") throw new DecodeError("this .cube file is a 1D LUT; pixvault applies 3D LUTs", "bad-options");
    else if (upper === "DOMAIN_MIN") min = rest.map(Number) as [number, number, number];
    else if (upper === "DOMAIN_MAX") max = rest.map(Number) as [number, number, number];
    else if (upper === "TITLE" || upper.startsWith("LUT_") || upper === "LUT_3D_INPUT_RANGE") continue;
    else if (/^[-+.\d]/.test(key!)) {
      const nums = [key, ...rest].map(Number);
      if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) throw new DecodeError("this .cube file has a malformed line", "bad-options");
      values.push(...nums);
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new DecodeError("this .cube file has no valid LUT_3D_SIZE", "bad-options");
  if (values.length !== size ** 3 * 3) throw new DecodeError(`this .cube file should list ${size ** 3} colours, it has ${values.length / 3}`, "bad-options");
  if ([0, 1, 2].some((c) => !(max[c]! > min[c]!))) throw new DecodeError("this .cube file has an invalid domain", "bad-options");
  return { size, table: Float32Array.from(values), min, max };
}

/** The LUT applied, mixed with the original by strength (0–1). */
export function applyCube(r: Raster, cube: Cube, strength = 1): Raster {
  if (strength <= 0) return r;
  const { size: n, table: t, min, max } = cube;
  const out = clone(r);
  const d = out.data;
  const s = Math.min(1, strength);
  const at = (ri: number, gi: number, bi: number, c: number) => t[((bi * n + gi) * n + ri) * 3 + c]!;
  // Input byte → lattice coordinate, per channel.
  const coord = [0, 1, 2].map((c) => Float32Array.from({ length: 256 }, (_, v) => Math.min(n - 1, Math.max(0, ((v / 255 - min[c]!) / (max[c]! - min[c]!)) * (n - 1)))));
  for (let i = 0; i < d.length; i += 4) {
    const fr = coord[0]![d[i]!]!;
    const fg = coord[1]![d[i + 1]!]!;
    const fb = coord[2]![d[i + 2]!]!;
    const r0 = Math.floor(fr);
    const g0 = Math.floor(fg);
    const b0 = Math.floor(fb);
    const r1 = Math.min(n - 1, r0 + 1);
    const g1 = Math.min(n - 1, g0 + 1);
    const b1 = Math.min(n - 1, b0 + 1);
    const dr = fr - r0;
    const dg = fg - g0;
    const db = fb - b0;
    for (let c = 0; c < 3; c++) {
      const c00 = at(r0, g0, b0, c) * (1 - dr) + at(r1, g0, b0, c) * dr;
      const c10 = at(r0, g1, b0, c) * (1 - dr) + at(r1, g1, b0, c) * dr;
      const c01 = at(r0, g0, b1, c) * (1 - dr) + at(r1, g0, b1, c) * dr;
      const c11 = at(r0, g1, b1, c) * (1 - dr) + at(r1, g1, b1, c) * dr;
      const v = ((c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db) * 255;
      d[i + c] = d[i + c]! + (v - d[i + c]!) * s;
    }
  }
  return out;
}
