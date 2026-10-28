// Runs jobs on a few workers at once: one photo per job for per-photo
// tools, so a batch of 200 photos keeps every core busy. Workers live for the
// batch and are terminated after it, or at once on cancel.

import type { JobMessage, JobRequest } from "./worker.ts";
import type { Output } from "./engine/run/types.ts";
import { scriptURL } from "./trusted.ts";

export type Job = DistributiveOmit<JobRequest, "id">;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface JobDone {
  files: Output[];
  report?: unknown;
  before?: Output;
}

export class JobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15 * 60 * 1000;
let nextId = 1;

export const concurrency = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

export interface BatchOptions {
  workers?: number;
  signal?: AbortSignal;
  /** A job finished (or failed): its index and outcome. */
  onSettled?: (index: number, result: JobDone | JobError) => void;
  /** Progress inside a job, 0–1 when known. */
  onProgress?: (index: number, fraction: number | null, label?: string) => void;
}

/** Run every job; resolves with one result per job, in order (errors included, not thrown). */
export function runBatch(jobs: Job[], o: BatchOptions = {}): Promise<(JobDone | JobError)[]> {
  const results: (JobDone | JobError)[] = Array.from({ length: jobs.length });
  if (!jobs.length) return Promise.resolve(results);
  const size = Math.min(o.workers ?? concurrency(), jobs.length);
  let next = 0;
  let settled = 0;
  const workers: Worker[] = [];
  return new Promise((resolve) => {
    const finish = () => {
      for (const w of workers) w.terminate();
      o.signal?.removeEventListener("abort", abort);
      resolve(results);
    };
    const abort = () => {
      for (let i = 0; i < jobs.length; i++) results[i] ??= new JobError("cancelled", "cancelled");
      finish();
    };
    if (o.signal?.aborted) return abort();
    o.signal?.addEventListener("abort", abort);
    const settle = (index: number, r: JobDone | JobError) => {
      if (results[index]) return;
      results[index] = r;
      o.onSettled?.(index, r);
      if (++settled === jobs.length) finish();
    };
    const spawn = (): Worker => {
      const w = new Worker(scriptURL("./worker.js"), { type: "module", name: "pixvault" });
      workers.push(w);
      return w;
    };
    const feed = (w: Worker) => {
      if (next >= jobs.length || o.signal?.aborted) return;
      const index = next++;
      const id = nextId++;
      const timer = setTimeout(() => {
        w.terminate();
        settle(index, new JobError("timeout", "this took more than 15 minutes and was stopped"));
        replace(w);
      }, TIMEOUT_MS);
      w.onmessage = (e: MessageEvent<JobMessage>) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === "progress") o.onProgress?.(index, m.total ? m.done / m.total : null, m.label);
        else {
          clearTimeout(timer);
          settle(index, m.type === "done" ? { files: m.files, report: m.report, before: m.before } : new JobError(m.code, m.message));
          feed(w);
        }
      };
      w.onerror = (e) => {
        e.preventDefault();
        clearTimeout(timer);
        settle(index, new JobError("crash", e.message || "the worker stopped (out of memory?)"));
        replace(w);
      };
      // Copies, not transfers: the page keeps its photos for another run.
      w.postMessage({ ...jobs[index]!, id } as JobRequest);
    };
    const replace = (dead: Worker) => {
      dead.terminate();
      if (next < jobs.length) feed(spawn());
    };
    for (let i = 0; i < size; i++) feed(spawn());
  });
}

/** One job, thrown on error. */
export async function runOne(job: Job, signal?: AbortSignal): Promise<JobDone> {
  const [r] = await runBatch([job], { workers: 1, signal });
  if (r instanceof JobError) throw r;
  return r!;
}

/**
 * One long-lived worker for live previews: codecs stay warm between slider
 * moves, and only the latest request matters (older ones are dropped).
 */
export class Previewer {
  #worker: Worker | null = null;
  #busy = false;
  #pending: { job: Job; resolve: (r: JobDone | null) => void; reject: (e: JobError) => void } | null = null;

  request(job: Job): Promise<JobDone | null> {
    return new Promise((resolve, reject) => {
      // A newer request supersedes the one still waiting.
      this.#pending?.resolve(null);
      this.#pending = { job, resolve, reject };
      if (!this.#busy) this.#next();
    });
  }

  #next() {
    const p = this.#pending;
    if (!p) return;
    this.#pending = null;
    this.#busy = true;
    this.#worker ??= new Worker(scriptURL("./worker.js"), { type: "module", name: "pixvault-preview" });
    const w = this.#worker;
    const id = nextId++;
    const done = () => {
      this.#busy = false;
      this.#next();
    };
    w.onmessage = (e: MessageEvent<JobMessage>) => {
      const m = e.data;
      if (m.id !== id || m.type === "progress") return;
      if (m.type === "done") p.resolve(this.#pending ? null : { files: m.files, report: m.report, before: m.before });
      else p.reject(new JobError(m.code, m.message));
      done();
    };
    w.onerror = (e) => {
      e.preventDefault();
      this.#worker?.terminate();
      this.#worker = null;
      p.reject(new JobError("crash", e.message || "the preview stopped"));
      done();
    };
    w.postMessage({ ...p.job, id } as JobRequest);
  }

  dispose() {
    this.#worker?.terminate();
    this.#worker = null;
    this.#pending?.resolve(null);
    this.#pending = null;
    this.#busy = false;
  }
}
