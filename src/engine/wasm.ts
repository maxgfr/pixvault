// Every WebAssembly module the engine uses, where it comes from in
// node_modules, and how the running environment fetches it. The build copies
// each one to dist/wasm/<name>.wasm; the browser compiles it from there (never
// from a CDN), and the tests read it straight from node_modules.

export const WASM = {
  "jpeg-enc": "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
  "jpeg-dec": "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm",
  "webp-enc": "@jsquash/webp/codec/enc/webp_enc_simd.wasm",
  "webp-dec": "@jsquash/webp/codec/dec/webp_dec.wasm",
  "avif-enc": "@jsquash/avif/codec/enc/avif_enc.wasm",
  "avif-dec": "@jsquash/avif/codec/dec/avif_dec.wasm",
  "jxl-enc": "@jsquash/jxl/codec/enc/jxl_enc.wasm",
  "jxl-dec": "@jsquash/jxl/codec/dec/jxl_dec.wasm",
  png: "@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
  oxipng: "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
  "qoi-enc": "@jsquash/qoi/codec/enc/qoi_enc.wasm",
  "qoi-dec": "@jsquash/qoi/codec/dec/qoi_dec.wasm",
  resize: "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm",
  heif: "libheif-js/libheif-wasm/libheif.wasm",
} as const;

export type WasmName = keyof typeof WASM;

export type WasmLoader = (name: WasmName) => Promise<WebAssembly.Module>;

let loader: WasmLoader = (name) => WebAssembly.compileStreaming(fetch(new URL(`./wasm/${name}.wasm`, globalThis.location.href)));

/** Point the engine at another source of wasm modules (the tests do). */
export function setWasmLoader(fn: WasmLoader) {
  loader = fn;
  cache.clear();
}

const cache = new Map<WasmName, Promise<WebAssembly.Module>>();

export function wasm(name: WasmName): Promise<WebAssembly.Module> {
  let p = cache.get(name);
  if (!p) {
    p = loader(name);
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}

/** Memoise an async initialiser: the codec instance is built once per worker. */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => {
    p ??= fn();
    p.catch(() => (p = undefined));
    return p;
  };
}
