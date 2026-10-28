// What a tool implementation receives and returns, in the worker.

import type { Options } from "../../tools/types.ts";
import type { Format } from "../formats.ts";
import type { PhotoMeta } from "../meta/types.ts";
import type { Raster } from "../raster.ts";

export interface Input {
  name: string;
  bytes: Uint8Array;
}

export interface Output {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export interface RunResult {
  files: Output[];
  /** Tool-specific data the interface renders (palette, metadata, duplicates…). */
  report?: unknown;
}

export interface Ctx {
  progress(done: number, total: number, label?: string): void;
  /** Throws if the user cancelled. */
  check(): void;
}

/** What a pixel step knows about the photo it works on. */
export interface StepCtx extends Ctx {
  name: string;
  format: Format;
  /** Parsed details (date, camera…), for captions and watermarks. */
  meta: PhotoMeta;
}

/** A per-photo pixel transformation: chainable, previewable. */
export type StepFn = (r: Raster, o: Options, ctx: StepCtx) => Promise<Raster> | Raster;

/** A whole tool: files in, files (and a report) out. */
export type RunFn = (inputs: Input[], o: Options, ctx: Ctx) => Promise<RunResult>;

export const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
export const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
export const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
export const bytesOf = (v: unknown): Uint8Array | undefined => (v instanceof Uint8Array ? v : undefined);
