// Running a tool or a recipe on the selection: one worker job per photo for
// per-photo tools (several at once), one job over all photos otherwise.

import { useRef, useState } from "react";
import type { RecipeStep } from "./engine/run/index.ts";
import type { Output } from "./engine/run/types.ts";
import { type Job, JobError, runBatch } from "./pool.ts";
import type { Options, ToolDef } from "./tools/types.ts";
import type { Photo } from "./workspace.ts";

export interface Outcome {
  /** The photos this job read (one for per-photo tools). */
  inputs: Photo[];
  files: Output[];
  report?: unknown;
  error?: JobError;
}

export interface Progress {
  done: number;
  total: number;
  label?: string;
}

export type Plan = { tool: ToolDef; options: Options; perPhoto?: (p: Photo, i: number) => Options } | { recipe: RecipeStep[]; output: Options };

const input = (p: Photo) => ({ name: p.name, blob: p.file });

function jobsFor(plan: Plan, photos: Photo[]): { job: Job; inputs: Photo[] }[] {
  if ("recipe" in plan) return photos.map((p) => ({ job: { kind: "recipe", steps: plan.recipe, output: plan.output, inputs: [input(p)] }, inputs: [p] }));
  if (plan.tool.input === "images") return [{ job: { kind: "tool", tool: plan.tool.id, inputs: photos.map(input), options: plan.options }, inputs: photos }];
  return photos.map((p, i) => ({ job: { kind: "tool", tool: plan.tool.id, inputs: [input(p)], options: { ...plan.options, ...plan.perPhoto?.(p, i) } }, inputs: [p] }));
}

export function useRunner() {
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run(plan: Plan, photos: Photo[]) {
    const jobs = jobsFor(plan, photos);
    abort.current = new AbortController();
    setOutcomes(null);
    let done = 0;
    setProgress({ done: 0, total: jobs.length });
    const results = await runBatch(
      jobs.map((j) => j.job),
      {
        signal: abort.current.signal,
        onSettled: (_, r) => {
          done++;
          setProgress({ done, total: jobs.length, label: r instanceof JobError ? undefined : r.files[0]?.name });
        },
        onProgress: (i, fraction, label) => {
          // A single long job (collage, PDF…) reports its own steps.
          if (jobs.length === 1 && fraction !== null) setProgress({ done: fraction, total: 1, label: label ?? jobs[i]?.inputs[0]?.name });
        },
      },
    );
    const stopped = abort.current?.signal.aborted;
    abort.current = null;
    setProgress(null);
    // Stopped on purpose: back to the settings, no list of "cancelled" rows.
    if (stopped) return null;
    const next = results.map((r, i) => (r instanceof JobError ? { inputs: jobs[i]!.inputs, files: [], error: r } : { inputs: jobs[i]!.inputs, files: r.files, report: r.report }));
    setOutcomes(next);
    return next;
  }

  return {
    outcomes,
    progress,
    run,
    cancel: () => abort.current?.abort(),
    reset: () => setOutcomes(null),
    running: progress !== null,
  };
}

/** Reports come back as one object or a list per job; this gives a flat list. */
export function reportsOf<T>(outcomes: Outcome[]): T[] {
  return outcomes.flatMap((o) => (o.report === undefined ? [] : Array.isArray(o.report) ? (o.report as T[]) : [o.report as T]));
}
