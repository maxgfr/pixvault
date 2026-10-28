/// <reference lib="webworker" />
// Runs tools off the main thread. A worker serves several jobs in a row (the
// codecs stay compiled); the page terminates it to cancel or when the batch
// is done, which frees all its memory at once.

import { DecodeError } from "./engine/errors.ts";
import { type RecipeStep, runRecipe, runTool } from "./engine/run/index.ts";
import { preview } from "./engine/run/preview.ts";
import type { Ctx, Input, Output } from "./engine/run/types.ts";
import type { Options } from "./tools/types.ts";

export type JobRequest =
  | { id: number; kind: "tool"; tool: string; inputs: Input[]; options: Options }
  | { id: number; kind: "recipe"; steps: RecipeStep[]; output: Options; inputs: Input[] }
  | { id: number; kind: "preview"; steps: RecipeStep[]; input: Input; maxSide: number };

export type JobMessage =
  | { id: number; type: "progress"; done: number; total: number; label?: string }
  | { id: number; type: "done"; files: Output[]; report?: unknown; before?: Output }
  | { id: number; type: "error"; code: string; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<JobRequest>) => {
  const req = e.data;
  const post = (m: JobMessage, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
  const ctx: Ctx = {
    progress: (done, total, label) => post({ id: req.id, type: "progress", done, total, label }),
    check: () => {},
  };
  try {
    if (req.kind === "preview") {
      const { before, after } = await preview(req.input, req.steps, req.maxSide, ctx);
      post({ id: req.id, type: "done", files: [after], before }, [after.bytes.buffer as ArrayBuffer, before.bytes.buffer as ArrayBuffer]);
      return;
    }
    const r = req.kind === "tool" ? await runTool(req.tool, req.inputs, req.options, ctx) : await runRecipe(req.steps, req.output, req.inputs, ctx);
    // A buffer can back several outputs (a file passed through as is); transfer each once.
    post({ id: req.id, type: "done", files: r.files, report: r.report }, [...new Set(r.files.map((f) => f.bytes.buffer as ArrayBuffer))]);
  } catch (err) {
    const code = err instanceof DecodeError ? err.code : err instanceof RangeError ? "too-large" : "internal";
    post({ id: req.id, type: "error", code, message: err instanceof Error ? err.message : String(err) });
  }
};
