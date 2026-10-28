// The AI models pixvault can run on the device: what each one is, where its
// files come from, pinned by revision and SHA-256. Small ones are served by
// this site (scripts/fetch-models.ts puts them in models/); big ones come from
// Hugging Face, only after the user agrees to the download.
// Shared by the page (consent, download) and the worker (inference).

import type { L } from "../tools/types.ts";

export interface ModelFile {
  /** Path under the model's repository. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface ModelDef {
  id: ModelId;
  /** Run on the graphics card when WebGPU can (fp16/fp32 graphs); quantised graphs are faster on the processor. */
  gpu?: boolean;
  label: L;
  licence: string;
  credit: string;
  /** "site": served from ./models/; "hub": downloaded from Hugging Face. */
  host: "site" | "hub";
  repo: string;
  revision: string;
  files: ModelFile[];
}

export type ModelId = "background" | "background-lite" | "upscale-2" | "upscale-4" | "upscale-2-gpu" | "upscale-4-gpu" | "faces" | "inpaint" | "caption";

const q = (en: string, fr: string): L => ({ en, fr });

export const MODELS: Record<ModelId, ModelDef> = {
  background: {
    id: "background",
    gpu: true,
    label: q("BiRefNet lite, background removal", "BiRefNet lite, détourage"),
    licence: "MIT",
    credit: "ZhengPeng7 (BiRefNet), ONNX by onnx-community",
    host: "hub",
    repo: "onnx-community/BiRefNet_lite-ONNX",
    revision: "de15b22ba131738a16dff04aab8bdf8dc32e3ac1",
    files: [{ path: "onnx/model_fp16.onnx", bytes: 114_538_221, sha256: "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402" }],
  },
  // Without WebGPU, BiRefNet does not fit in WebAssembly's memory: MODNet is the fallback (best on people).
  "background-lite": {
    id: "background-lite",
    label: q("MODNet, portrait background removal", "MODNet, détourage de portraits"),
    licence: "Apache-2.0",
    credit: "Ke et al. (MODNet), ONNX by Xenova",
    host: "site",
    repo: "Xenova/modnet",
    revision: "fa2fa546052fba4c08921230a26cc69a333fca12",
    // Full precision: the 8-bit build loses whole bodies (checked on group portraits).
    files: [{ path: "onnx/model.onnx", bytes: 25_888_640, sha256: "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9" }],
  },
  "upscale-2": {
    id: "upscale-2",
    label: q("Swin2SR ×2, super-resolution", "Swin2SR ×2, super-résolution"),
    licence: "Apache-2.0",
    credit: "Conde et al. (Swin2SR), ONNX by Xenova",
    host: "site",
    repo: "Xenova/swin2SR-classical-sr-x2-64",
    revision: "93dfc9089abda257351d3a58d5771e2c1ff69442",
    files: [{ path: "onnx/model_uint8.onnx", bytes: 19_032_145, sha256: "f27454f3d33deadccef00a0edc75858c2da6deed4f7516ada11237dd10bce2df" }],
  },
  "upscale-4": {
    id: "upscale-4",
    label: q("Swin2SR ×4 real-world, super-resolution", "Swin2SR ×4 photos réelles, super-résolution"),
    licence: "Apache-2.0",
    credit: "Conde et al. (Swin2SR), ONNX by Xenova",
    host: "site",
    repo: "Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr",
    revision: "d0e9926970c93e472ce2392373d72597fc849027",
    files: [{ path: "onnx/model_uint8.onnx", bytes: 18_999_633, sha256: "a60f3781f8e3a48babc94cfe7bfb02a61102f3cccff59574ae55673f5a70f931" }],
  },
  // Full-precision builds for graphics cards: the 8-bit ones gain nothing on WebGPU, and the published
  // fp16 export is broken (its output reuses the input's dimension names, so every run fails).
  "upscale-2-gpu": {
    id: "upscale-2-gpu",
    gpu: true,
    label: q("Swin2SR ×2, super-resolution (graphics card)", "Swin2SR ×2, super-résolution (carte graphique)"),
    licence: "Apache-2.0",
    credit: "Conde et al. (Swin2SR), ONNX by Xenova",
    host: "site",
    repo: "Xenova/swin2SR-classical-sr-x2-64",
    revision: "93dfc9089abda257351d3a58d5771e2c1ff69442",
    files: [{ path: "onnx/model.onnx", bytes: 54_428_699, sha256: "6dde3fe2440543ccae7c40d175609f83c18aeaa3d8456745c4329ef97ae744bd" }],
  },
  "upscale-4-gpu": {
    id: "upscale-4-gpu",
    gpu: true,
    label: q("Swin2SR ×4 real-world, super-resolution (graphics card)", "Swin2SR ×4 photos réelles, super-résolution (carte graphique)"),
    licence: "Apache-2.0",
    credit: "Conde et al. (Swin2SR), ONNX by Xenova",
    host: "site",
    repo: "Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr",
    revision: "d0e9926970c93e472ce2392373d72597fc849027",
    files: [{ path: "onnx/model.onnx", bytes: 52_772_645, sha256: "f496dc73dcc01d778b1a12eb4c4038d6b27cd1c0b5bcd4258455ed6d7816c835" }],
  },
  faces: {
    id: "faces",
    label: q("YuNet, face detection", "YuNet, détection de visages"),
    licence: "MIT",
    credit: "Shiqi Yu et al. (YuNet), OpenCV Zoo",
    host: "site",
    repo: "opencv/face_detection_yunet",
    revision: "3cc26e7f1014a5ee5d74a42acee58bafc9d0a310",
    files: [{ path: "face_detection_yunet_2023mar.onnx", bytes: 232_589, sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4" }],
  },
  inpaint: {
    id: "inpaint",
    label: q("MI-GAN, object eraser", "MI-GAN, gomme à objets"),
    licence: "MIT",
    credit: "Picsart AI Research (MI-GAN)",
    host: "site",
    repo: "andraniksargsyan/migan",
    revision: "406830d0fa60666da0071c342ad2fbc8f30c5c64",
    files: [{ path: "migan_pipeline_v2.onnx", bytes: 28_079_181, sha256: "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b" }],
  },
  caption: {
    id: "caption",
    gpu: true,
    label: q("Florence-2 base, captions", "Florence-2 base, légendes"),
    licence: "MIT",
    credit: "Microsoft (Florence-2), ONNX by onnx-community",
    host: "hub",
    repo: "onnx-community/Florence-2-base-ft",
    revision: "e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f",
    // Downloaded and verified like the others; Transformers.js then reads them from the cache only.
    files: [
      { path: "config.json", bytes: 5432, sha256: "d90c22ed72eb55291f183fcd9b98ebd3bd3d92bfcffb6c7f6e1606085e793525" },
      { path: "generation_config.json", bytes: 292, sha256: "7b8eb17bbd6cf8a07f619ad83ae03881eff05b6b9237bab89005b40e77783c29" },
      { path: "preprocessor_config.json", bytes: 2673, sha256: "c892857e34a7082284983a7717717d39c9bf7e574f1f41d80d4c918c97502efa" },
      { path: "tokenizer.json", bytes: 2_297_961, sha256: "d69dcdb2323e124ac4f800cb9863ddccea0d7bb11e16125e8df3bd60f2f8aeac" },
      { path: "tokenizer_config.json", bytes: 197_658, sha256: "d8e64607233cb53b619fb46664f6cad08176c26e0e8735b2d30d888364f19600" },
      { path: "onnx/vision_encoder_q4.onnx", bytes: 81_236_858, sha256: "8f211dfc176996d14e24d551f8e02530de781dd8b30d9e7d35b69b7c2d0340ce" },
      { path: "onnx/embed_tokens_int8.onnx", bytes: 39_390_433, sha256: "6b2258db1c8ee9b160576ccde3cd3814d83a2edaed0dd1c6ca9ff3c38fa62214" },
      { path: "onnx/encoder_model_q4.onnx", bytes: 30_058_778, sha256: "34b17bcf191dacb79bd482b94bad5cf1ba39bc770f6a4c9ae26f28b89c235e4b" },
      { path: "onnx/decoder_model_merged_q4.onnx", bytes: 64_393_474, sha256: "be7a2f33e65f8d65538024772fda4d1c5a7752d60a7159aadf53f9f4798b90fa" },
    ],
  },
};

/** Which model each AI tool needs on this device (upscale depends on the chosen factor). */
export interface GpuSupport {
  /** WebGPU with fp16 shaders. */
  f16: boolean;
  /** Storage buffers a shader may bind: BiRefNet needs 11 (Chrome on Apple GPUs allows 10). */
  storage: number;
}

export const BIREFNET_STORAGE_BUFFERS = 11;

/** BiRefNet runs only where WebGPU has fp16 and enough storage buffers; MODNet everywhere else. */
export const backgroundModel = (gpu: GpuSupport): ModelId => (gpu.f16 && gpu.storage >= BIREFNET_STORAGE_BUFFERS ? "background" : "background-lite");

export function modelFor(tool: string, options: Record<string, unknown>, gpu: GpuSupport): ModelId | null {
  const webgpu = gpu.f16;
  switch (tool) {
    case "remove-bg":
      return backgroundModel(gpu);
    case "upscale":
      return `upscale-${String(options.scale ?? "2") === "4" ? "4" : "2"}${webgpu ? "-gpu" : ""}` as ModelId;
    case "blur-faces":
    case "smart-crop":
      return "faces";
    case "erase":
      return "inpaint";
    case "describe":
      return options.engine === "api" ? null : "caption";
    default:
      return null;
  }
}

export const modelBytes = (m: ModelDef) => m.files.reduce((n, f) => n + f.bytes, 0);

/** Where the browser fetches a file from. */
export function fileURL(m: ModelDef, f: ModelFile, base: string): string {
  return m.host === "site" ? new URL(`./models/${m.id}/${f.path.split("/").pop()}`, base).href : `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`;
}

/** Downloaded files live here, until the user removes them. */
export const MODEL_CACHE = "pixvault-models";
/** The cache key of a file: a same-origin URL that is never fetched, the same whatever the file's origin. */
export const cacheKey = (m: ModelDef, f: ModelFile, base: string) => new URL(`./__models/${m.id}/${f.sha256}`, base).href;
