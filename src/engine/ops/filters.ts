// Looks: black and white, sepia, film, duotone… Each is a per-pixel colour
// mapping, blended with the original by strength.

import { clone, parseColor, type Raster } from "../raster.ts";

export type FilterName = "bw" | "noir" | "sepia" | "vintage" | "fade" | "warm" | "cool" | "vivid" | "matte" | "duotone" | "invert" | "posterize";

export interface FilterOptions {
  dark?: string;
  light?: string;
  levels?: number;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sCurve = (v: number, k: number) => {
  const x = v / 255;
  const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
  return (x + k * (s - x)) * 255;
};

type Map3 = (r: number, g: number, b: number, out: Float32Array) => void;

function mapper(name: FilterName, o: FilterOptions): Map3 {
  switch (name) {
    case "bw":
      return (r, g, b, out) => out.fill(lum(r, g, b));
    case "noir":
      return (r, g, b, out) => out.fill(sCurve(sCurve(lum(r, g, b), 1), 0.6));
    case "sepia":
      return (r, g, b, out) => {
        out[0] = 0.393 * r + 0.769 * g + 0.189 * b;
        out[1] = 0.349 * r + 0.686 * g + 0.168 * b;
        out[2] = 0.272 * r + 0.534 * g + 0.131 * b;
      };
    case "vintage":
      return (r, g, b, out) => {
        const y = lum(r, g, b);
        // Desaturated, warm, lifted blacks and softened highlights.
        out[0] = 28 + 0.8 * (y + (r - y) * 0.55) * 1.04;
        out[1] = 22 + 0.8 * (y + (g - y) * 0.55);
        out[2] = 30 + 0.8 * (y + (b - y) * 0.55) * 0.86;
      };
    case "fade":
      return (r, g, b, out) => {
        const y = lum(r, g, b);
        out[0] = 26 + 0.86 * (y + (r - y) * 0.75);
        out[1] = 26 + 0.86 * (y + (g - y) * 0.75);
        out[2] = 30 + 0.86 * (y + (b - y) * 0.75);
      };
    case "warm":
      return (r, g, b, out) => {
        out[0] = r * 1.08 + 6;
        out[1] = g * 1.02;
        out[2] = b * 0.88;
      };
    case "cool":
      return (r, g, b, out) => {
        out[0] = r * 0.9;
        out[1] = g * 1.0;
        out[2] = b * 1.1 + 6;
      };
    case "vivid":
      return (r, g, b, out) => {
        const y = lum(r, g, b);
        out[0] = sCurve(y + (r - y) * 1.35, 0.3);
        out[1] = sCurve(y + (g - y) * 1.35, 0.3);
        out[2] = sCurve(y + (b - y) * 1.35, 0.3);
      };
    case "matte":
      return (r, g, b, out) => {
        const y = lum(r, g, b);
        out[0] = 30 + 0.8 * (y + (r - y) * 0.85);
        out[1] = 30 + 0.8 * (y + (g - y) * 0.85);
        out[2] = 30 + 0.8 * (y + (b - y) * 0.85);
      };
    case "duotone": {
      const d = parseColor(o.dark, [27, 31, 59, 255]);
      const l = parseColor(o.light, [255, 207, 138, 255]);
      return (r, g, b, out) => {
        const t = lum(r, g, b) / 255;
        out[0] = d[0] + (l[0] - d[0]) * t;
        out[1] = d[1] + (l[1] - d[1]) * t;
        out[2] = d[2] + (l[2] - d[2]) * t;
      };
    }
    case "invert":
      return (r, g, b, out) => {
        out[0] = 255 - r;
        out[1] = 255 - g;
        out[2] = 255 - b;
      };
    case "posterize": {
      const n = Math.max(2, Math.min(16, Math.round(o.levels ?? 4)));
      const q = (v: number) => (Math.round((v / 255) * (n - 1)) * 255) / (n - 1);
      return (r, g, b, out) => {
        out[0] = q(r);
        out[1] = q(g);
        out[2] = q(b);
      };
    }
  }
}

export const FILTER_NAMES: FilterName[] = ["bw", "noir", "sepia", "vintage", "fade", "warm", "cool", "vivid", "matte", "duotone", "invert", "posterize"];

/** The filter applied, mixed with the original by strength (0–1). Unknown names leave the photo as it is. */
export function applyFilter(r: Raster, name: string, strength: number, o: FilterOptions = {}): Raster {
  if (strength <= 0 || !FILTER_NAMES.includes(name as FilterName)) return r;
  const f = mapper(name as FilterName, o);
  const out = clone(r);
  const d = out.data;
  const tmp = new Float32Array(3);
  const s = Math.min(1, strength);
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i]!;
    const g0 = d[i + 1]!;
    const b0 = d[i + 2]!;
    f(r0, g0, b0, tmp);
    d[i] = r0 + (tmp[0]! - r0) * s;
    d[i + 1] = g0 + (tmp[1]! - g0) * s;
    d[i + 2] = b0 + (tmp[2]! - b0) * s;
  }
  return out;
}
