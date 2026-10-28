// Captions and keywords on the device with Florence-2 (Microsoft, MIT),
// through Transformers.js. Its files were downloaded and verified by the
// page; Transformers.js reads them from that cache and is never allowed to
// fetch anything itself.

import { MODELS } from "../../ai/catalog.ts";
import type { Raster } from "../raster.ts";
import { resize } from "../resize.ts";
import { hasWebGPUf16, modelFiles, ort } from "./runtime.ts";

// biome-ignore lint: Transformers.js types are heavy; this module only needs a few calls.
type Any = any;

let loaded: Promise<{ model: Any; processor: Any; tf: Any }> | undefined;

// The command line runs under Bun, where the package resolves to its Node build (native addons): it loads the web build instead.
let transformers: () => Promise<Any> = () => import("@huggingface/transformers");
export function setTransformersLoader(fn: () => Promise<Any>) {
  transformers = fn;
  loaded = undefined;
}

function load() {
  loaded ??= (async () => {
    // ONNX Runtime first: its wasm path must point at ./ort/ before Transformers.js looks (it would pick a CDN).
    await ort();
    const tf: Any = await transformers();
    const m = MODELS.caption;
    const bytes = await modelFiles("caption");
    const byPath = new Map(m.files.map((f, i) => [f.path, bytes[i]!]));
    const env = tf.env;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = true;
    // Any key ending with one of our files gets that file; everything else is a miss.
    env.customCache = {
      match: async (key: string | Request) => {
        const k = typeof key === "string" ? key : key.url;
        for (const [path, b] of byPath) if (k.endsWith(`/${path}`)) return new Response(b as BlobPart);
        return undefined;
      },
      put: async () => {},
    };
    // In the browser, only the site's own ONNX Runtime files may be fetched (Transformers.js preloads them);
    // elsewhere ONNX Runtime already has its wasm in memory (runtime.ts loader), and nothing is fetched at all.
    // Bun defines a `location` with no address: only a real page origin counts.
    const href = globalThis.location?.href;
    const base = typeof href === "string" && /^https?:/.test(href) ? new URL("./ort/", href).href : null;
    env.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      return base && href.startsWith(base) ? fetch(href, init) : new Response(null, { status: 404 });
    };
    // Without a page, the CDN default Transformers.js sets on load goes: the bundled glue and the wasm in memory serve.
    if (base) env.backends.onnx.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm` };
    else delete env.backends.onnx.wasm.wasmPaths;
    env.backends.onnx.wasm.numThreads = 1;
    const device = (await hasWebGPUf16()) ? "webgpu" : "wasm";
    const dtype = { vision_encoder: "q4", embed_tokens: "int8", encoder_model: "q4", decoder_model_merged: "q4" };
    const [model, processor] = await Promise.all([tf.Florence2ForConditionalGeneration.from_pretrained(m.repo, { dtype, device, local_files_only: true }), tf.AutoProcessor.from_pretrained(m.repo, { local_files_only: true })]);
    return { model, processor, tf };
  })();
  loaded.catch(() => (loaded = undefined));
  return loaded;
}

async function ask(r: Raster, task: string): Promise<unknown> {
  const { model, processor, tf } = await load();
  // Resized here to the model's input size: Transformers.js resizes with a canvas (or sharp, on Node), which the command line has neither of.
  const size = processor.image_processor?.size;
  const input = size?.width && size?.height ? await resize(r, size.width, size.height, "catrom") : r;
  const image = new tf.RawImage(input.data, input.width, input.height, 4);
  const prompts = processor.construct_prompts(task);
  const inputs = await processor(image, prompts);
  const ids = await model.generate({ ...inputs, max_new_tokens: 128 });
  const text = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  return processor.post_process_generation(text, task, [r.width, r.height])[task];
}

const STOP = new Set("a an the of in on at to and or with without from by for is are was were be been being this that these those it its there here into onto over under above below near next up down out as some many few several one two three image photo picture shown showing view of".split(" "));

/** Keywords from the caption itself: its content words, in order (one generation instead of two). */
export function keywordsOf(caption: string): string[] {
  const words = caption.toLowerCase().match(/[a-z][a-z-]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 10);
}

export async function describe(r: Raster, detail: "short" | "long"): Promise<{ caption: string; keywords: string[] }> {
  const caption = String(await ask(r, detail === "long" ? "<MORE_DETAILED_CAPTION>" : "<CAPTION>")).trim();
  return { caption, keywords: keywordsOf(caption) };
}
