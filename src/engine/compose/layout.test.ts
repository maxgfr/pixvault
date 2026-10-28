import { expect, test } from "bun:test";
import { columnLayout, gridLayout, mosaicLayout, rowLayout } from "./layout.ts";

test("a justified mosaic fills the width row by row, without overlap", () => {
  const ratios = [1.5, 0.67, 1, 1.78, 1.33, 0.75, 1.5];
  const { tiles, width, height } = mosaicLayout(ratios, 1200, 10);
  expect(tiles).toHaveLength(ratios.length);
  expect(height).toBeGreaterThan(0);
  const rows = new Map<number, typeof tiles>();
  for (const t of tiles) rows.set(t.y, [...(rows.get(t.y) ?? []), t]);
  const all = [...rows.values()];
  // Every row but possibly the last spans exactly the inner width.
  for (const row of all.slice(0, -1)) {
    expect(row[0]!.x).toBe(10);
    expect(row.at(-1)!.x + row.at(-1)!.w).toBeGreaterThanOrEqual(width - 11);
    expect(row.at(-1)!.x + row.at(-1)!.w).toBeLessThanOrEqual(width - 9);
  }
  // Tiles keep their aspect ratio (to rounding).
  tiles.forEach((t, i) => expect(Math.abs(t.w / t.h - ratios[i]!)).toBeLessThan(0.05));
});

test("grid, row and column layouts", () => {
  const g = gridLayout(5, 1000, 10);
  expect(g.tiles).toHaveLength(5);
  expect(g.tiles[0]!.w).toBe(g.tiles[0]!.h);
  expect(g.tiles[3]!.y).toBeGreaterThan(g.tiles[0]!.y);
  const r = rowLayout([1, 2], 310, 10);
  expect(Math.abs(r.tiles[1]!.w - 2 * r.tiles[0]!.w)).toBeLessThanOrEqual(1);
  expect(r.height).toBe(93 + 20);
  const c = columnLayout([2, 1], 220, 10);
  expect(c.tiles[0]!.h).toBe(100);
  expect(c.height).toBe(10 + 100 + 10 + 200 + 10);
});
