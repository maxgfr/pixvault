// ONNX Runtime for the on-device models, in the worker: WebGPU when the
// browser has it, WebAssembly otherwise (one thread: GitHub Pages cannot
// make the page cross-origin isolated). The runtime's wasm is served from
// ./ort/, never a CDN; model files come from the Cache Storage the page
// filled after the user agreed to download them.

import type * as Ort from "onnxruntime-web";
import { cacheKey, MODEL_CACHE, MODELS, type ModelId } from "../../ai/catalog.ts";
import { DecodeError } from "../errors.ts";

export type OrtModule = typeof Ort;

/** The adapter's own limits, not WebGPU's defaults: BiRefNet needs 11 storage buffers per shader where the default is 10. */
const LIMITS: (keyof GPUSupportedLimits)[] = ["maxStorageBuffersPerShaderStage", "maxBufferSize", "maxStorageBufferBindingSize", "maxComputeWorkgroupStorageSize", "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeX", "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ"];

let ortLoader: () => Promise<OrtModule> = async () => {
  const ort = (await import("onnxruntime-web/webgpu")) as unknown as OrtModule;
  const base = new URL("./ort/", globalThis.location.href).href;
  ort.env.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm` };
  ort.env.wasm.numThreads = 1;
  try {
    const adapter = await globalThis.navigator?.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (adapter) {
      const requiredLimits: Record<string, number> = {};
      for (const k of LIMITS) if (typeof adapter.limits[k] === "number") requiredLimits[k] = adapter.limits[k] as number;
      const requiredFeatures = (["shader-f16", "subgroups"] as GPUFeatureName[]).filter((f) => adapter.features.has(f));
      const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
      const webgpu = ort.env.webgpu as unknown as { adapter: unknown; device: unknown };
      webgpu.adapter = adapter;
      webgpu.device = device;
    }
  } catch {
    // No usable device: models fall back to WebAssembly.
  }
  return ort;
};

/** Files of a model, in catalog order. */
let fileLoader = async (id: ModelId): Promise<Uint8Array[]> => {
  const m = MODELS[id];
  const cache = await caches.open(MODEL_CACHE);
  return Promise.all(
    m.files.map(async (f) => {
      const res = await cache.match(cacheKey(m, f, globalThis.location.href));
      if (!res) throw new DecodeError(`${id} is not downloaded`, "model");
      return new Uint8Array(await res.arrayBuffer());
    }),
  );
};

/** For the tests: another runtime build and model files from disk. */
export function setAiLoaders(o: { ort?: () => Promise<OrtModule>; files?: (id: ModelId) => Promise<Uint8Array[]> }) {
  if (o.ort) ortLoader = o.ort;
  if (o.files) fileLoader = o.files;
  ortPromise = undefined;
  sessions.clear();
}

let ortPromise: Promise<OrtModule> | undefined;
export const ort = () => (ortPromise ??= ortLoader());

let gpu: Promise<{ ok: boolean; f16: boolean; storage: number }> | undefined;
function probe() {
  gpu ??= (async () => {
    try {
      const adapter = await globalThis.navigator?.gpu?.requestAdapter({ powerPreference: "high-performance" });
      return { ok: Boolean(adapter), f16: Boolean(adapter?.features.has("shader-f16")), storage: adapter?.limits.maxStorageBuffersPerShaderStage ?? 0 };
    } catch {
      return { ok: false, f16: false, storage: 0 };
    }
  })();
  return gpu;
}

/** What the page sees too (src/ai/download.ts), so both pick the same model. */
export const gpuSupport = async () => {
  const p = await probe();
  return { f16: p.f16, storage: p.storage };
};

/** Whether WebGPU can run here (an adapter exists). */
export const hasWebGPU = async () => (await probe()).ok;
/** Whether it can also run half-precision models (BiRefNet ships in fp16): the bar for using the graphics card at all. */
export const hasWebGPUf16 = async () => (await probe()).f16;

export const modelFiles = (id: ModelId) => fileLoader(id);

const sessions = new Map<ModelId, Promise<Ort.InferenceSession>>();

/** One inference session per model and worker. */
export function session(id: ModelId): Promise<Ort.InferenceSession> {
  let s = sessions.get(id);
  if (!s) {
    s = (async () => {
      const o = await ort();
      const [bytes] = await fileLoader(id);
      const providers = MODELS[id].gpu && (await hasWebGPUf16()) ? ["webgpu", "wasm"] : ["wasm"];
      try {
        return await o.InferenceSession.create(bytes!, { executionProviders: providers, graphOptimizationLevel: "all" });
      } catch (e) {
        if (providers[0] !== "webgpu") throw e;
        return o.InferenceSession.create(bytes!, { executionProviders: ["wasm"] });
      }
    })();
    s.catch(() => sessions.delete(id));
    sessions.set(id, s);
  }
  return s;
}

/** Interleaved RGBA to planar float CHW, with per-channel (v/255 - mean) / std. */
export function toCHW(data: Uint8ClampedArray | Uint8Array, width: number, height: number, mean = [0, 0, 0], std = [1, 1, 1], scale = 1 / 255, bgr = false): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const src = data[i * 4 + (bgr ? 2 - c : c)]!;
      out[c * plane + i] = (src * scale - mean[c]!) / std[c]!;
    }
  }
  return out;
}
