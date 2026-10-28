// Which photos the next action applies to: all of them unless unticked.

import { useSyncExternalStore } from "react";
import { type Photo, workspace } from "./workspace.ts";

const off = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version++;
  for (const fn of listeners) fn();
};

export const selection = {
  toggle(key: string) {
    if (off.has(key)) off.delete(key);
    else off.add(key);
    emit();
  },
  only(keys: string[]) {
    off.clear();
    const keep = new Set(keys);
    for (const p of workspace.photos) if (!keep.has(p.key)) off.add(p.key);
    emit();
  },
  all() {
    off.clear();
    emit();
  },
  none() {
    for (const p of workspace.photos) off.add(p.key);
    emit();
  },
  has: (key: string) => !off.has(key),
};

/** The usable photos currently selected, in workspace order. */
export function useSelection(photos: Photo[]): Photo[] {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return photos.filter((p) => !off.has(p.key) && !p.problem);
}
