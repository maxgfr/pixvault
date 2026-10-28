// Perceptual hashes: two 64-bit fingerprints of what a photo shows, robust to
// resizing, recompression and small edits. dHash compares neighbouring
// brightness; pHash keeps the signs of the lowest DCT frequencies.

import type { Raster } from "../raster.ts";
import { resize } from "../resize.ts";

export interface PhotoHash {
  d: bigint;
  p: bigint;
}

function gray(r: Raster): Float64Array {
  const out = new Float64Array(r.width * r.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * r.data[i * 4]! + 0.587 * r.data[i * 4 + 1]! + 0.114 * r.data[i * 4 + 2]!;
  return out;
}

const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: 32 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 64)));

export async function photoHash(r: Raster): Promise<PhotoHash> {
  const small = gray(await resize(r, 9, 8, "triangle"));
  let d = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d = (d << 1n) | (small[y * 9 + x]! < small[y * 9 + x + 1]! ? 1n : 0n);

  const g = gray(await resize(r, 32, 32, "triangle"));
  const coef: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) s += g[y * 32 + x]! * COS[u]![x]! * COS[v]![y]!;
      coef.push(s);
    }
  }
  const ac = coef.slice(1).sort((a, b) => a - b);
  const median = (ac[31]! + ac[32]!) / 2;
  let p = 0n;
  for (const c of coef) p = (p << 1n) | (c > median ? 1n : 0n);
  return { d, p };
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** 0–1: how alike two photos look. */
export const similarity = (a: PhotoHash, b: PhotoHash) => 1 - (hamming(a.d, b.d) + hamming(a.p, b.p)) / 128;

/** Groups of indices whose similarity reaches `threshold` (0–1), linked transitively. */
export function groupSimilar(hashes: PhotoHash[], threshold: number): { indices: number[]; similarity: number }[] {
  const parent = hashes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const best = new Map<string, number>();
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const s = similarity(hashes[i]!, hashes[j]!);
      if (s >= threshold) {
        parent[find(j)] = find(i);
        best.set(`${i}-${j}`, s);
      }
    }
  }
  const groups = new Map<number, number[]>();
  hashes.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((indices) => {
      let min = 1;
      for (let a = 0; a < indices.length; a++) for (let b = a + 1; b < indices.length; b++) min = Math.min(min, similarity(hashes[indices[a]!]!, hashes[indices[b]!]!));
      return { indices, similarity: min };
    });
}
