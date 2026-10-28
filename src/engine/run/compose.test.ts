import { expect, test } from "bun:test";
import { decode, encode } from "../codecs.ts";
import { decodeGifFrames } from "../gif.ts";
import { sniff } from "../formats.ts";
import { noisy, sample } from "../test/setup.ts";
import { collageLayout, frameOrder, runs } from "./compose.ts";
import type { Ctx, Input } from "./types.ts";

const ctx: Ctx = { progress() {}, check() {} };

async function photos(n: number, w = 60, h = 40): Promise<Input[]> {
  return Promise.all(Array.from({ length: n }, async (_, i) => ({ name: `p${i}.png`, bytes: await encode(i % 2 ? sample(w, h) : sample(h, w), "png") })));
}

test("collage: the file has the layout's size", async () => {
  const inputs = await photos(4);
  const o = { layout: "grid", width: 400, gap: 2, format: "png", radius: 10 };
  const r = await runs.collage!(inputs, o, ctx);
  const img = await decode(r.files[0]!.bytes);
  const layout = collageLayout([1, 1, 1, 1], o);
  expect([img.width, img.height]).toEqual([layout.width, layout.height]);
  expect(r.files[0]!.name).toBe("collage.png");
});

test("contact sheet as PDF and as an image", async () => {
  const inputs = await photos(7);
  const pdf = await runs["contact-sheet"]!(inputs, { cols: 3, title: "Holidays é", labels: "name", to: "pdf" }, ctx);
  expect(new TextDecoder().decode(pdf.files[0]!.bytes.subarray(0, 5))).toBe("%PDF-");
  const img = await runs["contact-sheet"]!(inputs, { cols: 3, to: "jpeg" }, ctx);
  expect(sniff(img.files[0]!.bytes)).toBe("jpeg");
});

test("compare: side by side, stacked and split", async () => {
  const [a, b] = await photos(2, 80, 60);
  for (const layout of ["side", "stack", "split"]) {
    const r = await runs.compare!([a!, b!], { layout, gap: 0 }, ctx);
    const img = await decode(r.files[0]!.bytes);
    expect(img.width).toBeGreaterThan(0);
    if (layout === "split") expect(img.width).toBe(60);
  }
});

test("photos to PDF: one page per photo", async () => {
  const inputs = await photos(3);
  for (const page of ["fit", "a4"]) {
    const r = await runs.pdf!(inputs, { page }, ctx);
    const text = new TextDecoder("latin1").decode(r.files[0]!.bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect((r.report as { pages: number }).pages).toBe(3);
  }
});

test("animated GIF, with a boomerang", async () => {
  expect(frameOrder(4, true)).toEqual([0, 1, 2, 3, 2, 1]);
  const inputs = await photos(4);
  const r = await runs.gif!(inputs, { width: 50, boomerang: true, delay: 100 }, ctx);
  expect(decodeGifFrames(r.files[0]!.bytes)).toHaveLength(6);
  const plain = await runs.gif!(inputs, { width: 50 }, ctx);
  expect(decodeGifFrames(plain.files[0]!.bytes)).toHaveLength(4);
});

test("GIF frames come back as PNGs", async () => {
  const inputs = await photos(3);
  const g = await runs.gif!(inputs, { width: 40 }, ctx);
  const r = await runs.frames!([{ name: "anim.gif", bytes: g.files[0]!.bytes }], { every: 1 }, ctx);
  expect(r.files.map((f) => f.name)).toEqual(["anim-001.png", "anim-002.png", "anim-003.png"]);
  expect(sniff(r.files[0]!.bytes)).toBe("png");
});

test("sprite sheet: one CSS class per image", async () => {
  const inputs = await photos(5, 20, 16);
  inputs[1]!.name = "p0.png";
  const r = await runs.sprite!(inputs, { padding: 2 }, ctx);
  const css = new TextDecoder().decode(r.files.find((f) => f.name === "sprite.css")!.bytes);
  expect(css.match(/\.sprite-[\w-]+ \{/g)).toHaveLength(5);
  expect(css).toContain(".sprite-p0-2 ");
});

test("favicon: the whole set", async () => {
  const r = await runs.favicon!([{ name: "logo.png", bytes: await encode(noisy(120, 80), "png") }], { padding: 5, radius: 20, name: "Demo" }, ctx);
  expect(r.files.map((f) => f.name).sort()).toEqual(
    ["apple-touch-icon.png", "favicon-16.png", "favicon-32.png", "favicon.html", "favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "site.webmanifest"].sort(),
  );
  const ico = r.files.find((f) => f.name === "favicon.ico")!;
  expect(sniff(ico.bytes)).toBe("ico");
  expect((await decode(r.files.find((f) => f.name === "apple-touch-icon.png")!.bytes)).width).toBe(180);
  expect(JSON.parse(new TextDecoder().decode(r.files.find((f) => f.name === "site.webmanifest")!.bytes)).name).toBe("Demo");
});
