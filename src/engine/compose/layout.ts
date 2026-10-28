// Pure layout math for collages: where each tile goes. No pixels here, so it
// is easy to test.

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  tiles: Tile[];
  width: number;
  height: number;
}

/**
 * A justified mosaic (rows of equal height that fill the width, like a photo
 * gallery). `ratios` are width/height; `gap` is the space between tiles and
 * around them. The number of rows is chosen for a roughly 4:3 result.
 */
export function mosaicLayout(ratios: number[], width: number, gap: number): Layout {
  const n = ratios.length;
  if (!n) return { tiles: [], width, height: 0 };
  const inner = width - 2 * gap;
  const total = ratios.reduce((s, r) => s + r, 0);
  const rows = Math.max(1, Math.min(n, Math.round(Math.sqrt(0.75 * total))));
  const target = (rows * inner) / total;
  const tiles: Tile[] = [];
  let y = gap;
  let start = 0;
  while (start < n) {
    // Grow the row until it is at least as wide as the canvas at the target height.
    let end = start;
    let sum = 0;
    while (end < n) {
      sum += ratios[end]!;
      end++;
      if (sum * target + (end - start - 1) * gap >= inner) break;
    }
    // Do not leave a lonely last tile: pull it into this row.
    if (end === n - 1 && n - start > 2) {
      sum += ratios[end]!;
      end++;
    }
    const count = end - start;
    const fullHeight = (inner - (count - 1) * gap) / sum;
    const last = end === n;
    // A short last row keeps the target height instead of being blown up.
    const h = last && fullHeight > target * 1.25 ? target : fullHeight;
    const rowWidth = sum * h + (count - 1) * gap;
    let x = gap + (inner - rowWidth) / 2;
    for (let i = start; i < end; i++) {
      const w = ratios[i]! * h;
      tiles.push({ x, y, w, h });
      x += w + gap;
    }
    y += h + gap;
    start = end;
  }
  return { tiles: tiles.map(round), width, height: Math.round(y) };
}

/** Square cells, `cols` per row (√n when not given). */
export function gridLayout(n: number, width: number, gap: number, cols?: number): Layout {
  const c = Math.max(1, Math.min(n, Math.round(cols || Math.ceil(Math.sqrt(n)))));
  const rows = Math.ceil(n / c);
  const cell = (width - gap * (c + 1)) / c;
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) tiles.push(round({ x: gap + (i % c) * (cell + gap), y: gap + Math.floor(i / c) * (cell + gap), w: cell, h: cell }));
  return { tiles, width, height: Math.round(gap + rows * (cell + gap)) };
}

/** One row of equal height filling the width. */
export function rowLayout(ratios: number[], width: number, gap: number): Layout {
  const total = ratios.reduce((s, r) => s + r, 0);
  const h = (width - gap * (ratios.length + 1)) / total;
  let x = gap;
  const tiles = ratios.map((r) => {
    const t = { x, y: gap, w: r * h, h };
    x += r * h + gap;
    return round(t);
  });
  return { tiles, width, height: Math.round(h + 2 * gap) };
}

/** One column of equal width. */
export function columnLayout(ratios: number[], width: number, gap: number): Layout {
  const w = width - 2 * gap;
  let y = gap;
  const tiles = ratios.map((r) => {
    const t = { x: gap, y, w, h: w / r };
    y += w / r + gap;
    return round(t);
  });
  return { tiles, width, height: Math.round(y) };
}

function round(t: Tile): Tile {
  const x = Math.round(t.x);
  const y = Math.round(t.y);
  return { x, y, w: Math.max(1, Math.round(t.x + t.w) - x), h: Math.max(1, Math.round(t.y + t.h) - y) };
}
