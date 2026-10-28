// optimize tools: implementations, looked up by tool id.
import type { RunFn, StepFn } from "./types.ts";

export const steps: Record<string, StepFn> = {};
export const runs: Record<string, RunFn> = {};
