// Every implementation, by tool id. Per-photo pixel tools only declare a
// step; the generic path decodes, applies it and writes the output.

import { toolById } from "../../tools/index.ts";
import type { Options } from "../../tools/types.ts";
import { DecodeError } from "../errors.ts";
import * as adjust from "./adjust.ts";
import * as ai from "./ai.ts";
import * as analyze from "./analyze.ts";
import * as brand from "./brand.ts";
import * as compose from "./compose.ts";
import * as metadata from "./metadata.ts";
import * as optimize from "./optimize.ts";
import { runSteps } from "./step.ts";
import * as transform from "./transform.ts";
import type { Ctx, Input, RunFn, RunResult, StepFn } from "./types.ts";

const modules = [optimize, transform, adjust, brand, metadata, compose, analyze, ai];

export const STEPS: Record<string, StepFn> = Object.assign({}, ...modules.map((m) => m.steps));
export const RUNS: Record<string, RunFn> = Object.assign({}, ...modules.map((m) => m.runs));

export interface RecipeStep {
  tool: string;
  options: Options;
}

/** Run one tool on its inputs (one photo for per-photo tools, all of them otherwise). */
export async function runTool(id: string, inputs: Input[], options: Options, ctx: Ctx): Promise<RunResult> {
  const run = RUNS[id];
  if (run) return run(inputs, options, ctx);
  const step = STEPS[id];
  if (!step || !toolById.get(id)) throw new DecodeError(`unknown tool ${id}`, "bad-options");
  const files = [];
  for (const [i, input] of inputs.entries()) {
    ctx.progress(i, inputs.length, input.name);
    files.push(await runSteps(input, [{ fn: step, options }], options, ctx));
  }
  return { files };
}

/** A recipe: several steps in order on each photo, then one output. */
export async function runRecipe(steps: RecipeStep[], output: Options, inputs: Input[], ctx: Ctx): Promise<RunResult> {
  const calls = steps.map((s) => {
    const fn = STEPS[s.tool];
    if (!fn) throw new DecodeError(`${s.tool} cannot be part of a recipe`, "bad-options");
    return { fn, options: s.options };
  });
  const files = [];
  for (const input of inputs) files.push(await runSteps(input, calls, output, ctx));
  return { files };
}
