// Models are downloaded by the page, only when the user agrees: streamed
// with progress, checked against their pinned SHA-256, and kept in Cache
// Storage until removed. The worker reads them from there.

import { useEffect, useState, useSyncExternalStore } from "react";
import { cacheKey, fileURL, type GpuSupport, MODEL_CACHE, MODELS, type ModelId } from "./catalog.ts";

const base = () => location.href.split("#")[0]!;
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const fn of listeners) fn();
};

export async function isDownloaded(id: ModelId): Promise<boolean> {
  if (!("caches" in window)) return false;
  const cache = await caches.open(MODEL_CACHE);
  const m = MODELS[id];
  for (const f of m.files) if (!(await cache.match(cacheKey(m, f, base())))) return false;
  return true;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class DownloadError extends Error {}

export async function download(id: ModelId, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const m = MODELS[id];
  const cache = await caches.open(MODEL_CACHE);
  const total = m.files.reduce((n, f) => n + f.bytes, 0);
  let done = 0;
  for (const f of m.files) {
    const key = cacheKey(m, f, base());
    if (await cache.match(key)) {
      done += f.bytes;
      onProgress(done, total);
      continue;
    }
    const res = await fetch(fileURL(m, f, base()), { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok || !res.body) throw new DownloadError(`HTTP ${res.status}`);
    const buf = new Uint8Array(f.bytes);
    let at = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (at + value.length > buf.length) throw new DownloadError("the file is larger than expected");
      buf.set(value, at);
      at += value.length;
      onProgress(done + at, total);
    }
    if (at !== f.bytes || (await sha256(buf)) !== f.sha256) throw new DownloadError("the file does not match its fingerprint");
    await cache.put(key, new Response(buf, { headers: { "content-type": "application/octet-stream" } }));
    done += f.bytes;
  }
  changed();
}

export async function removeModel(id: ModelId) {
  const m = MODELS[id];
  const cache = await caches.open(MODEL_CACHE);
  await Promise.all(m.files.map((f) => cache.delete(cacheKey(m, f, base()))));
  changed();
}

/** Whether a model is on this device, refreshed after downloads and removals. */
export function useDownloaded(id: ModelId | null): boolean | null {
  const v = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!id) return setState(null);
    let live = true;
    setState(null);
    void isDownloaded(id).then((d) => live && setState(d));
    return () => {
      live = false;
    };
  }, [id, v]);
  return state;
}

let gpu: Promise<GpuSupport> | undefined;
/** What this browser's WebGPU can run (the worker probes the same way). */
export function pageGpu(): Promise<GpuSupport> {
  gpu ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      return { f16: Boolean(adapter?.features.has("shader-f16")), storage: adapter?.limits.maxStorageBuffersPerShaderStage ?? 0 };
    } catch {
      return { f16: false, storage: 0 };
    }
  })();
  return gpu;
}

/** null until known. */
export function useGpu(): GpuSupport | null {
  const [v, setV] = useState<GpuSupport | null>(null);
  useEffect(() => void pageGpu().then(setV), []);
  return v;
}
