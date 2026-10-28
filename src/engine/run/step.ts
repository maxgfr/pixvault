// The common path for per-photo tools: decode, apply one or more steps,
// write the result. Recipes are the same thing with several steps.

import type { Options } from "../../tools/types.ts";
import { decode } from "../codecs.ts";
import { sniff } from "../formats.ts";
import { readMeta } from "../meta/read.ts";
import { writeOutput } from "../output.ts";
import type { Raster } from "../raster.ts";
import type { Ctx, Input, Output, StepFn } from "./types.ts";

export interface StepCall {
  fn: StepFn;
  options: Options;
}

export async function runSteps(input: Input, steps: StepCall[], output: Options, ctx: Ctx): Promise<Output> {
  const format = sniff(input.bytes, input.name);
  if (!format) throw new Error("not an image");
  const meta = await readMeta(input.bytes);
  let r: Raster = await decode(input.bytes, input.name);
  for (const s of steps) {
    ctx.check();
    r = await s.fn(r, s.options, { ...ctx, name: input.name, format, meta });
  }
  return writeOutput(r, output, { name: input.name, bytes: input.bytes, format, meta });
}
