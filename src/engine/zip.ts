// Several results in one download. Runs in the page (fflate only): photos
// are already compressed, so they are stored as is, which is also fast.

import { zipSync, type Zippable } from "fflate";

const STORED = /\.(jpe?g|png|webp|avif|jxl|gif|heic|heif|zip|pdf|ico|qoi|mp4|webm)$/i;

/** Unique names in a folder: "photo.jpg", "photo-2.jpg", "photo-3.jpg"… (case-insensitive, like most file systems). */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const clean = name.replace(/^\/+/, "").replace(/\\/g, "/") || "file";
    const m = /^(.*?)(\.[^./]+)?$/.exec(clean)!;
    let candidate = clean;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${m[1]}-${n}${m[2] ?? ""}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function zip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const names = uniqueNames(files.map((f) => f.name));
  const tree: Zippable = {};
  files.forEach((f, i) => {
    tree[names[i]!] = [f.bytes, { level: STORED.test(names[i]!) ? 0 : 6 }];
  });
  return zipSync(tree);
}
