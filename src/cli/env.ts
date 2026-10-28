// Everything the engine gets from a browser, provided on the command line:
// codecs and fonts from the binary itself, ONNX Runtime with its wasm in
// memory, and AI models in a cache folder, downloaded on first use from
// their pinned revision and checked against their SHA-256.

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODELS, type ModelDef, type ModelFile, type ModelId, modelBytes } from "../ai/catalog.ts";
import { setTransformersLoader } from "../engine/ai/caption.ts";
import { setAiLoaders } from "../engine/ai/runtime.ts";
import { registerFonts } from "../engine/ops/vector.ts";
import { setWasmLoader } from "../engine/wasm.ts";
import { CODECS, FONT_FILES, ORT_WASM, read, RESVG_WASM } from "./assets.ts";

export function cacheDir(): string {
  if (process.env.PIXVAULT_CACHE) return process.env.PIXVAULT_CACHE;
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "pixvault");
  return process.platform === "darwin" ? join(homedir(), "Library", "Caches", "pixvault") : join(homedir(), ".cache", "pixvault");
}

const fileOf = (m: ModelDef, f: ModelFile) => join(cacheDir(), "models", m.id, f.sha256);

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function isDownloaded(id: ModelId): Promise<boolean> {
  for (const f of MODELS[id].files) if (!(await Bun.file(fileOf(MODELS[id], f)).exists())) return false;
  return true;
}

const mb = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

/** Download a model's files (only the missing ones), verified, with progress on stderr. */
export async function downloadModel(id: ModelId, quiet = false): Promise<void> {
  const m = MODELS[id];
  const total = modelBytes(m);
  let done = 0;
  const tty = process.stderr.isTTY && !quiet;
  if (!quiet) process.stderr.write(`Downloading ${m.label.en} (${mb(total)}, ${m.licence}) once, into ${cacheDir()}\n`);
  await mkdir(join(cacheDir(), "models", m.id), { recursive: true });
  for (const f of m.files) {
    const out = fileOf(m, f);
    if (await Bun.file(out).exists()) {
      done += f.bytes;
      continue;
    }
    const url = `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = new Uint8Array(f.bytes);
    let at = 0;
    for await (const chunk of res.body) {
      if (at + chunk.length > buf.length) throw new Error(`${f.path} is larger than expected`);
      buf.set(chunk, at);
      at += chunk.length;
      if (tty) process.stderr.write(`\r  ${Math.round(((done + at) / total) * 100)} %`);
    }
    if (at !== f.bytes || (await sha256(buf)) !== f.sha256) throw new Error(`${f.path} does not match its pinned SHA-256`);
    await Bun.write(`${out}.part`, buf);
    await Bun.$`mv ${out}.part ${out}`.quiet();
    done += f.bytes;
  }
  if (tty) process.stderr.write("\r  100 %\n");
}

export async function removeModel(id: ModelId) {
  await rm(join(cacheDir(), "models", id), { recursive: true, force: true });
}

export async function cachedSize(): Promise<number> {
  let n = 0;
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else n += (await stat(p)).size;
    }
  };
  await walk(join(cacheDir(), "models"));
  return n;
}

let resvg: Promise<typeof import("@resvg/resvg-wasm")> | undefined;

/** SVG to PNG, drawn by resvg (the browser draws it in the web app). */
export async function rasteriseSvg(svg: Uint8Array): Promise<Uint8Array> {
  resvg ??= (async () => {
    const mod = await import("@resvg/resvg-wasm");
    await mod.initWasm(await read(RESVG_WASM));
    return mod;
  })();
  const { Resvg } = await resvg;
  const text = new TextDecoder().decode(svg);
  const probe = new Resvg(text);
  // Like the web app: 2048 px on the long side unless the drawing is bigger.
  const long = Math.max(probe.width, probe.height) || 1024;
  const fitTo = long < 2048 ? (probe.width >= probe.height ? { mode: "width" as const, value: 2048 } : { mode: "height" as const, value: 2048 }) : { mode: "original" as const };
  return new Resvg(text, { fitTo, background: undefined }).render().asPng();
}

let ortModule: Promise<typeof import("onnxruntime-web")> | undefined;

/** ONNX Runtime (WebAssembly), its wasm handed over in memory: nothing to extract or fetch. */
function loadOrt() {
  ortModule ??= (async () => {
    const ort = (await import("onnxruntime-web/webgpu")) as unknown as typeof import("onnxruntime-web");
    ort.env.wasm.wasmBinary = (await read(ORT_WASM)).buffer as ArrayBuffer;
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    return ort;
  })();
  return ortModule;
}

/** Set the engine up for the command line. Models download on first use unless `offline`. */
export async function setup(o: { offline?: boolean; quiet?: boolean } = {}) {
  setWasmLoader(async (name) => WebAssembly.compile(await read(CODECS[name])));
  registerFonts({ sans: await read(FONT_FILES.sans), serif: await read(FONT_FILES.serif), mono: await read(FONT_FILES.mono) });
  setAiLoaders({
    ort: loadOrt,
    files: async (id) => {
      if (!(await isDownloaded(id))) {
        if (o.offline) throw new Error(`the ${MODELS[id].label.en} model is not downloaded (pixvault models download ${id})`);
        await downloadModel(id, o.quiet);
      }
      return Promise.all(MODELS[id].files.map((f) => read(fileOf(MODELS[id], f))));
    },
  });
  // The web build of Transformers.js: its Node build needs native addons a single binary cannot carry.
  // It imports the same ONNX Runtime module, configured here first, and must not take Bun for
  // Node (it would then pick onnxruntime-node): it reads process.release once, on load.
  setTransformersLoader(async () => {
    await loadOrt();
    const release = process.release;
    Object.defineProperty(process, "release", { value: { ...release, name: "bun" }, configurable: true });
    try {
      // A literal path, so the binary carries it.
      // @ts-expect-error The web build is plain JavaScript without its own types here.
      return await import("../../node_modules/@huggingface/transformers/dist/transformers.web.js");
    } finally {
      Object.defineProperty(process, "release", { value: release, configurable: true });
    }
  });
}
