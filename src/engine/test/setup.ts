// Tests read the wasm modules straight from node_modules.
import { registerFonts } from "../ops/vector.ts";
import { setWasmLoader, WASM } from "../wasm.ts";
import { raster, type Raster } from "../raster.ts";

const root = new URL("../../../node_modules/", import.meta.url).pathname;
setWasmLoader(async (name) => WebAssembly.compile(await Bun.file(root + WASM[name]).arrayBuffer()));

// No canvas here: text is drawn from the fonts the command line ships.
const fonts = new URL("../../../assets/fonts/", import.meta.url).pathname;
registerFonts({
  sans: new Uint8Array(await Bun.file(`${fonts}LiberationSans-Bold.ttf`).arrayBuffer()),
  serif: new Uint8Array(await Bun.file(`${fonts}LiberationSerif-Bold.ttf`).arrayBuffer()),
  mono: new Uint8Array(await Bun.file(`${fonts}LiberationMono-Bold.ttf`).arrayBuffer()),
});

/** A colourful test image: gradients plus a few hard edges, optionally with alpha. */
export function sample(width = 64, height = 48, alpha = false): Raster {
  const r = raster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      r.data[i] = (x * 255) / (width - 1);
      r.data[i + 1] = (y * 255) / (height - 1);
      r.data[i + 2] = (x + y) % 16 < 8 ? 40 : 200;
      r.data[i + 3] = alpha ? Math.round((x * 255) / (width - 1)) : 255;
    }
  }
  return r;
}

/** Mean absolute difference per channel, 0–255. */
export function diff(a: Raster, b: Raster): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  // The colour of a fully transparent pixel is invisible: encoders may change it.
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const hidden = a.data[i + 3] === 0 && b.data[i + 3] === 0;
    for (let c = 0; c < 4; c++) if (!hidden || c === 3) sum += Math.abs(a.data[i + c]! - b.data[i + c]!);
  }
  return sum / a.data.length;
}

/** Photo-like noise: what palette and lossy encoders are for. */
export function noisy(width = 128, height = 96): Raster {
  const r = sample(width, height);
  let seed = 7;
  for (let i = 0; i < r.data.length; i++) {
    if (i % 4 === 3) continue;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    r.data[i] = r.data[i]! + ((seed >> 16) % 40) - 20;
  }
  return r;
}
