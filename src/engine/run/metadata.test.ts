import { expect, test } from "bun:test";
import { decode } from "../codecs.ts";
import { PHONE, photo } from "../meta/fixtures.ts";
import { readMeta, type InspectReport } from "../meta/read.ts";
import { diff } from "../test/setup.ts";
import { fillPattern, parseDate, runs, shiftDate, type StripReport } from "./metadata.ts";
import type { Ctx } from "./types.ts";

const ctx: Ctx = { progress() {}, check() {} };

test("inspect groups details and lists what they reveal", async () => {
  const b = await photo("jpeg", { ...PHONE, serial: "X1" }, { description: "Harbour", keywords: ["sea"] });
  const r = (await runs.inspect!([{ name: "IMG_1.jpg", bytes: b }], {}, ctx)).report as InspectReport;
  expect(r.format).toBe("jpeg");
  expect([r.width, r.height]).toEqual([64, 48]);
  expect(r.gps?.lat).toBeCloseTo(43.296482, 5);
  expect(r.risks[0]).toEqual({ code: "location", level: "high" });
  expect(r.risks.map((x) => x.code)).toContain("device");
  const ids = r.groups.map((g) => g.id);
  for (const g of ["camera", "settings", "date", "location", "author"] as const) expect(ids).toContain(g);
  const shutter = r.groups.flatMap((g) => g.entries).find((e) => e.key === "ExposureTime");
  expect(shutter?.value).toBe("1/120 s");
  expect(shutter?.label.fr).toBe("Vitesse d'obturation");
  expect(r.blocks.some((x) => x.kind === "exif")).toBe(true);
});

test("inspect on a bare file reports no risk", async () => {
  const b = await photo("png", {});
  const r = (await runs.inspect!([{ name: "a.png", bytes: b }], {}, ctx)).report as InspectReport;
  expect(r.risks).toEqual([]);
});

test("strip tool: lossless, location gone, report", async () => {
  const b = await photo("jpeg");
  const out = await runs.strip!([{ name: "a.jpg", bytes: b }], { remove: "gps" }, ctx);
  const rep = out.report as StripReport;
  expect(rep.removed).toEqual(["gps"]);
  expect(out.files[0]!.name).toBe("a.jpg");
  expect(out.files[0]!.mime).toBe("image/jpeg");
  expect((await readMeta(out.files[0]!.bytes)).gps).toBeUndefined();
  expect(diff(await decode(out.files[0]!.bytes), await decode(b))).toBe(0);
});

test("edit-meta shifts dates, sets credits, keeps pixels and other tags", async () => {
  const b = await photo("jpeg", { ...PHONE, orientation: 3 });
  const out = await runs["edit-meta"]!([{ name: "a.jpg", bytes: b }], { shift: -9.5, artist: "Ana", copyright: "© 2026 Ana", description: "Quai" }, ctx);
  const m = await readMeta(out.files[0]!.bytes);
  expect(m.taken).toBe("2025-08-02T00:11:12");
  expect(m.artist).toBe("Ana");
  expect(m.copyright).toBe("© 2026 Ana");
  expect(m.description).toBe("Quai");
  expect(m.orientation).toBe(3);
  expect(m.lens).toBe(PHONE.lens!);
  expect(m.gps?.lat).toBeCloseTo(43.296482, 5);
  expect(diff(await decode(out.files[0]!.bytes), await decode(b))).toBe(0);
  const set = await runs["edit-meta"]!([{ name: "a.jpg", bytes: b }], { date: "2024-07-14 18:30" }, ctx);
  expect((await readMeta(set.files[0]!.bytes)).taken).toBe("2024-07-14T18:30:00");
});

test("edit-meta on a file with no date cannot shift, and refuses HEIC", async () => {
  const b = await photo("png", { make: "X" });
  await expect(runs["edit-meta"]!([{ name: "a.png", bytes: b }], { shift: 1 }, ctx)).rejects.toThrow("no date");
  const heic = new Uint8Array(await Bun.file(new URL("../../../fixtures/sample.heic", import.meta.url)).arrayBuffer());
  await expect(runs["edit-meta"]!([{ name: "a.heic", bytes: heic }], { artist: "x" }, ctx)).rejects.toThrow("JPEG, PNG and WebP");
});

test("rename: patterns, order by date, collisions, slugs", async () => {
  const a = await photo("jpeg", { ...PHONE, taken: "2025-08-03T10:00:00" });
  const b = await photo("jpeg", { ...PHONE, taken: "2025-08-01T08:00:00" });
  const c = await photo("png", {});
  const inputs = [
    { name: "IMG_0003.JPG", bytes: a },
    { name: "IMG_0001.JPG", bytes: b },
    { name: "Écran café.png", bytes: c },
  ];
  const byDate = await runs.rename!(inputs, { pattern: "{date}-{n}", start: 1, digits: 3, order: "date" }, ctx);
  expect(byDate.files.map((f) => f.name)).toEqual(["2025-08-01-001.JPG", "2025-08-03-002.JPG", "003.png"]);
  expect(byDate.files[0]!.bytes).toBe(b);
  const same = await runs.rename!(inputs, { pattern: "trip", order: "list" }, ctx);
  expect(same.files.map((f) => f.name)).toEqual(["trip.JPG", "trip-2.JPG", "trip.png"]);
  const slug = await runs.rename!([inputs[2]!], { pattern: "{name} {w}x{h}", case: "slug" }, ctx);
  expect(slug.files[0]!.name).toBe("ecran-cafe-64x48.png");
  const cam = await runs.rename!([inputs[0]!], { pattern: "{camera}_{time}", case: "lower" }, ctx);
  expect(cam.files[0]!.name).toBe("apple iphone 15 pro_10-00-00.jpg");
});

test("date helpers", () => {
  expect(parseDate("2024:07:14 18:30:05")).toBe("2024-07-14T18:30:05");
  expect(parseDate("2024-7-4")).toBe("2024-07-04T00:00:00");
  expect(parseDate("tomorrow")).toBeUndefined();
  expect(shiftDate("2024-12-31T23:30:00", 1)).toBe("2025-01-01T00:30:00");
  expect(fillPattern("{n}-{x}", { n: "1", name: "", date: "", time: "", camera: "", w: "", h: "", ext: "" })).toBe("1-{x}");
});
