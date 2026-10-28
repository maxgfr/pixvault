// The photos you are working on, for this tab only: nothing is stored, and
// a reload empties it. Photos are kept as the files themselves (Blobs, backed
// by the disk for picked and dropped files), never copied into memory: the
// workers read them when they work on them. Each photo gets an accession
// number, an upright thumbnail and its details, read in workers as it arrives.

import { useSyncExternalStore } from "react";
import { type Format, sniff } from "./engine/formats.ts";
import type { InspectReport } from "./engine/meta/read.ts";
import { concurrency, JobError, runBatch } from "./pool.ts";

export interface Photo {
  key: string;
  /** Accession number, in the order photos joined. */
  no: number;
  name: string;
  file: Blob;
  size: number;
  format: Format | null;
  thumb?: string;
  width?: number;
  height?: number;
  info?: InspectReport;
  /** Why this file cannot be used. */
  problem?: { code: string; message: string };
  /** The photo this one replaced, for "Restore original". */
  previous?: Photo;
  /** Produced here and not downloaded or saved yet. */
  unsaved?: boolean;
}

type Listener = () => void;

class Workspace {
  #photos: Photo[] = [];
  #listeners = new Set<Listener>();
  #counter = 0;

  subscribe(fn: Listener) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  get photos() {
    return this.#photos;
  }

  get(key: string) {
    return this.#photos.find((p) => p.key === key);
  }

  #set(next: Photo[]) {
    this.#photos = next;
    for (const fn of this.#listeners) fn();
  }

  #patch(key: string, file: Blob, patch: Partial<Photo>) {
    // Ignore late results for a photo that has since been replaced.
    this.#set(this.#photos.map((p) => (p.key === key && p.file === file ? { ...p, ...patch } : p)));
  }

  #make(name: string, file: Blob, head: Uint8Array, unsaved?: boolean, no?: number): Photo {
    const format = sniff(head, name);
    return {
      key: crypto.randomUUID(),
      no: no ?? ++this.#counter,
      name,
      file,
      size: file.size,
      format,
      unsaved,
      problem: format ? undefined : { code: "unsupported", message: "not an image" },
    };
  }

  /** Only the first bytes are read here, to tell the format. */
  async add(items: { name: string; file: Blob; unsaved?: boolean }[]): Promise<Photo[]> {
    const heads = await Promise.all(items.map(async (i) => new Uint8Array(await i.file.slice(0, 4096).arrayBuffer())));
    const added = items.map((i, k) => this.#make(i.name, i.file, heads[k]!, i.unsaved));
    this.#set([...this.#photos, ...added]);
    void this.#inspect(added.filter((p) => !p.problem));
    return added;
  }

  async #inspect(list: Photo[]) {
    if (!list.length) return;
    await runBatch(
      list.map((p) => ({ kind: "thumb" as const, input: { name: p.name, blob: p.file }, maxSide: 480 })),
      {
        workers: Math.min(concurrency(), list.length),
        onSettled: (i, r) => {
          const p = list[i]!;
          if (r instanceof JobError) {
            this.#patch(p.key, p.file, { problem: { code: r.code, message: r.message } });
            return;
          }
          const thumb = r.files[0];
          const info = r.report as InspectReport;
          this.#patch(p.key, p.file, {
            thumb: thumb ? URL.createObjectURL(new Blob([thumb.bytes as BlobPart], { type: thumb.mime })) : undefined,
            info,
            width: info?.width,
            height: info?.height,
          });
        },
      },
    );
  }

  remove(key: string) {
    const p = this.get(key);
    if (p) release(p);
    this.#set(this.#photos.filter((x) => x.key !== key));
  }

  clear() {
    this.#photos.forEach(release);
    this.#counter = 0;
    this.#set([]);
  }

  move(key: string, by: number) {
    const at = this.#photos.findIndex((p) => p.key === key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= this.#photos.length) return;
    const next = [...this.#photos];
    const [item] = next.splice(at, 1);
    next.splice(to, 0, item!);
    this.#set(next);
  }

  /** Put a result in place of `key`, keeping the old photo one step back. */
  async replace(key: string, name: string, file: Blob) {
    const old = this.get(key);
    if (!old) return;
    if (old.previous) release(old.previous);
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const next: Photo = { ...this.#make(name, file, head, true, old.no), key: old.key, previous: { ...old, previous: undefined } };
    this.#set(this.#photos.map((p) => (p.key === key ? next : p)));
    void this.#inspect([next]);
  }

  restore(key: string) {
    const cur = this.get(key);
    if (!cur?.previous) return;
    if (cur.thumb && cur.thumb !== cur.previous.thumb) URL.revokeObjectURL(cur.thumb);
    this.#set(this.#photos.map((p) => (p.key === key ? { ...cur.previous!, key } : p)));
  }

  saved(keys: string[]) {
    const set = new Set(keys);
    this.#set(this.#photos.map((p) => (set.has(p.key) && p.unsaved ? { ...p, unsaved: false } : p)));
  }
}

function release(p: Photo) {
  if (p.thumb) URL.revokeObjectURL(p.thumb);
  if (p.previous?.thumb && p.previous.thumb !== p.thumb) URL.revokeObjectURL(p.previous.thumb);
}

export const workspace = new Workspace();

export function usePhotos(): Photo[] {
  return useSyncExternalStore(
    (fn) => workspace.subscribe(fn),
    () => workspace.photos,
  );
}

/** "PV-007". */
export const accession = (no: number) => `PV-${String(no).padStart(3, "0")}`;
