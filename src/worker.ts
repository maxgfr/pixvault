/// <reference lib="webworker" />
// Runs tools off the main thread. A worker serves several jobs in a row (the
// codecs stay compiled); the page terminates it to cancel or when the batch
// is done, which frees all its memory at once.

import { DecodeError } from "./engine/errors.ts";
import { inspect } from "./engine/meta/read.ts";
import { setWasmLoader, type WasmName } from "./engine/wasm.ts";
import { warmUp } from "./engine/warmup.ts";
import { type RecipeStep, runRecipe, runTool } from "./engine/run/index.ts";
import { isPrepared, preview, thumbnail } from "./engine/run/preview.ts";
import type { Ctx, Input, Output } from "./engine/run/types.ts";
import type { Options } from "./tools/types.ts";

/** A photo as the page sends it: the file itself (read here, never copied by the page) or bytes it made. */
export type PageInput = { name: string; blob: Blob } | Input;

export type JobRequest =
  | { id: number; kind: "tool"; tool: string; inputs: PageInput[]; options: Options }
  | { id: number; kind: "recipe"; steps: RecipeStep[]; output: Options; inputs: PageInput[] }
  | { id: number; kind: "preview"; steps: RecipeStep[]; input: PageInput; maxSide: number; key?: string }
  /** A small upright preview of a photo plus its details, when it joins the workspace. */
  | { id: number; kind: "thumb"; input: PageInput; maxSide: number };

const read = async (i: PageInput): Promise<Input> => ("bytes" in i ? i : { name: i.name, bytes: new Uint8Array(await i.blob.arrayBuffer()) });

export type JobMessage =
  | { id: number; type: "progress"; done: number; total: number; label?: string }
  | { id: number; type: "done"; files: Output[]; report?: unknown; before?: Output }
  | { id: number; type: "error"; code: string; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Codecs come from the page, compiled once for every worker (see pool.ts).
const waiting = new Map<WasmName, { resolve: (m: WebAssembly.Module) => void; reject: (e: Error) => void }[]>();
setWasmLoader(
  (name) =>
    new Promise((resolve, reject) => {
      const list = waiting.get(name) ?? [];
      list.push({ resolve, reject });
      waiting.set(name, list);
      if (list.length === 1) scope.postMessage({ type: "wasm", name });
    }),
);

// Optimise the everyday codecs before the first photo arrives (see engine/warmup.ts).
const warm = warmUp();

type WasmReply = { type: "wasm"; name: WasmName; module?: WebAssembly.Module; error?: string };

scope.onmessage = async (e: MessageEvent<JobRequest | WasmReply>) => {
  if ("type" in e.data && e.data.type === "wasm") {
    const { name, module, error } = e.data;
    for (const w of waiting.get(name) ?? []) {
      if (module) w.resolve(module);
      else w.reject(new Error(error ?? "codec unavailable"));
    }
    waiting.delete(name);
    return;
  }
  const req = e.data as JobRequest;
  await warm;
  const post = (m: JobMessage, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
  const ctx: Ctx = {
    progress: (done, total, label) => post({ id: req.id, type: "progress", done, total, label }),
    check: () => {},
  };
  try {
    if (req.kind === "thumb") {
      const input = await read(req.input);
      const [{ before, width, height }, report] = await Promise.all([thumbnail(input, req.maxSide), inspect(input.bytes, input.name)]);
      // The decoded size is the truth: headers of tiled or rotated photos (HEIC) do not always say it.
      post({ id: req.id, type: "done", files: [before], report: { ...report, width, height } }, [before.bytes.buffer as ArrayBuffer]);
      return;
    }
    if (req.kind === "preview") {
      // Slider moves on a photo already prepared do not even read the file.
      const input = req.key && isPrepared(req.key) ? { name: req.input.name, bytes: new Uint8Array(0) } : await read(req.input);
      const { before, after } = await preview(input, req.steps, req.maxSide, ctx, false, req.key);
      post({ id: req.id, type: "done", files: [after], before }, [after.bytes.buffer as ArrayBuffer, before.bytes.buffer as ArrayBuffer]);
      return;
    }
    const inputs = await Promise.all(req.inputs.map(read));
    const r = req.kind === "tool" ? await runTool(req.tool, inputs, req.options, ctx) : await runRecipe(req.steps, req.output, inputs, ctx);
    // A buffer can back several outputs (a file passed through as is); transfer each once.
    post({ id: req.id, type: "done", files: r.files, report: r.report }, [...new Set(r.files.map((f) => f.bytes.buffer as ArrayBuffer))]);
  } catch (err) {
    const code = err instanceof DecodeError ? err.code : err instanceof RangeError ? "too-large" : "internal";
    post({ id: req.id, type: "error", code, message: err instanceof Error ? err.message : String(err) });
  }
};
