// Runs jobs on a pool of workers: one photo per job for per-photo tools, so
// a batch of 200 photos keeps every core busy. Workers start when a tool
// opens, warm their codecs up (engine/warmup.ts) and stay warm after a batch
// (two of them for up to a minute, with their AI models loaded); they are
// terminated after that, or at once on cancel. The page compiles each wasm
// codec once and hands the same module to every worker.

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
/** Idle workers keep their wasm memory (a few hundred MB after a big photo): after a short pause only two stay warm, and none after a minute. */
const TRIM_MS = 15 * 1000;
const KEEP_WARM = 2;
const IDLE_MS = 60 * 1000;
let nextId = 1;

/**
 * Workers for a batch: the cores minus two (the page and the system keep one
 * each), at most 6 (measured: beyond that they only fight over memory
 * bandwidth on 48 MB photos), and fewer on devices that report little memory.
 */
export function concurrency(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const byMemory = memory && memory <= 2 ? 1 : memory && memory <= 4 ? 2 : 6;
  return Math.max(1, Math.min(6, byMemory, cores - 2));
}

// ── Codecs compiled once ────────────────────────────────────────────────

const compiled = new Map<string, Promise<WebAssembly.Module>>();

function compile(name: string): Promise<WebAssembly.Module> {
  let p = compiled.get(name);
  if (!p) {
    p = WebAssembly.compileStreaming(fetch(new URL(`./wasm/${name}.wasm`, location.href)));
    p.catch(() => compiled.delete(name));
    compiled.set(name, p);
  }
  return p;
}

/** A worker that asks the page for its wasm modules. */
function spawn(name: string): Worker {
  const w = new Worker(scriptURL("./worker.js"), { type: "module", name });
  w.addEventListener("message", (e: MessageEvent<JobMessage | { type: "wasm"; name: string }>) => {
    const m = e.data;
    if (m.type !== "wasm") return;
    e.stopImmediatePropagation();
    compile(m.name).then(
      (module) => w.postMessage({ type: "wasm", name: m.name, module }),
      (err: unknown) => w.postMessage({ type: "wasm", name: m.name, error: String(err) }),
    );
  });
  return w;
}

// ── The pool ────────────────────────────────────────────────────────────

class Pool {
  #idle: Worker[] = [];
  #count = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #trim: ReturnType<typeof setTimeout> | undefined;
  #waiting: ((w: Worker) => void)[] = [];

  /** A worker for one job: an idle one, a new one, or the next one freed. */
  acquire(limit: number): Promise<Worker> {
    this.#stopTimers();
    const idle = this.#idle.pop();
    if (idle) return Promise.resolve(idle);
    if (this.#count < Math.max(limit, 1)) {
      this.#count++;
      return Promise.resolve(spawn("pixvault"));
    }
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  release(w: Worker) {
    const next = this.#waiting.shift();
    if (next) return next(w);
    this.#idle.push(w);
    this.#idleTimers();
  }

  #stopTimers() {
    clearTimeout(this.#timer);
    clearTimeout(this.#trim);
  }

  #idleTimers() {
    this.#stopTimers();
    this.#trim = setTimeout(() => this.drain(KEEP_WARM), TRIM_MS);
    this.#timer = setTimeout(() => this.drain(0), IDLE_MS);
  }

  /** A worker that crashed, timed out or was cancelled mid-job. */
  kill(w: Worker) {
    w.terminate();
    this.#count--;
    const next = this.#waiting.shift();
    if (next) {
      this.#count++;
      next(spawn("pixvault"));
    }
  }

  /** Start workers ahead of a batch, so they are warm when it begins. */
  prewarm(n: number) {
    while (this.#count < n) {
      this.#count++;
      this.#idle.push(spawn("pixvault"));
    }
    this.#idleTimers();
  }

  /** Terminate idle workers down to `keep`. */
  drain(keep = 0) {
    while (this.#idle.length > keep) {
      this.#idle.shift()!.terminate();
      this.#count--;
    }
  }
}

const pool = new Pool();

/** Called when a tool opens: the batch it may run finds its workers ready. */
export const prewarm = (photos: number) => pool.prewarm(Math.min(concurrency(), Math.max(1, photos)));

export interface BatchOptions {
  workers?: number;
  signal?: AbortSignal;
  /** A job finished (or failed): its index and outcome. */
  onSettled?: (index: number, result: JobDone | JobError) => void;
  /** Progress inside a job, 0–1 when known. */
  onProgress?: (index: number, fraction: number | null, label?: string) => void;
}

/** Run one job on a worker; resolves with its outcome, never throws. */
function runOn(w: Worker, job: Job, index: number, o: BatchOptions): Promise<{ result: JobDone | JobError; healthy: boolean }> {
  const id = nextId++;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: JobDone | JobError, healthy: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      o.signal?.removeEventListener("abort", onAbort);
      resolve({ result, healthy });
    };
    const onMessage = (e: MessageEvent<JobMessage>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "progress") o.onProgress?.(index, m.total ? m.done / m.total : null, m.label);
      else finish(m.type === "done" ? { files: m.files, report: m.report, before: m.before } : new JobError(m.code, m.message), true);
    };
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      finish(new JobError("crash", e.message || "the worker stopped (out of memory?)"), false);
    };
    const onAbort = () => finish(new JobError("cancelled", "cancelled"), false);
    const timer = setTimeout(() => finish(new JobError("timeout", "this took more than 15 minutes and was stopped"), false), TIMEOUT_MS);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    o.signal?.addEventListener("abort", onAbort);
    // Copies, not transfers: the page keeps its photos for another run (Blobs are not copied at all).
    w.postMessage({ ...job, id } as JobRequest);
  });
}

/** Run every job; resolves with one result per job, in order (errors included, not thrown). */
export async function runBatch(jobs: Job[], o: BatchOptions = {}): Promise<(JobDone | JobError)[]> {
  const results: (JobDone | JobError)[] = Array.from({ length: jobs.length });
  if (!jobs.length) return results;
  const limit = Math.min(o.workers ?? concurrency(), jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      if (o.signal?.aborted) break;
      const index = next++;
      const w = await pool.acquire(limit);
      const { result, healthy } = await runOn(w, jobs[index]!, index, o);
      // A cancelled, crashed or timed-out worker may still be busy or broken: it goes.
      if (healthy) pool.release(w);
      else pool.kill(w);
      results[index] = result;
      o.onSettled?.(index, result);
    }
  };
  await Promise.all(Array.from({ length: limit }, lane));
  for (let i = 0; i < jobs.length; i++) results[i] ??= new JobError("cancelled", "cancelled");
  return results;
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
      if (!this.#busy) void this.#next();
    });
  }

  async #next() {
    const p = this.#pending;
    if (!p) return;
    this.#pending = null;
    this.#busy = true;
    this.#worker ??= spawn("pixvault-preview");
    const { result, healthy } = await runOn(this.#worker, p.job, 0, {});
    if (!healthy) {
      this.#worker?.terminate();
      this.#worker = null;
    }
    if (result instanceof JobError) p.reject(result);
    else p.resolve(this.#pending ? null : result);
    this.#busy = false;
    void this.#next();
  }

  dispose() {
    this.#worker?.terminate();
    this.#worker = null;
    this.#pending?.resolve(null);
    this.#pending = null;
    this.#busy = false;
  }
}
