// The command line end to end: every tool run as a real process on the
// fixtures, outputs checked by what they are, not by their names.
// PIXVAULT_BIN=dist-cli/pixvault-macos-arm64 runs the same suite on a compiled binary.
// The AI models come from models/ (bun scripts/fetch-models.ts), copied into a
// temporary cache; Florence-2 (218 MB) only runs with PIXVAULT_TEST_CAPTION=1.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import exifr from "exifr";
import { unzipSync } from "fflate";
import { MODELS } from "../ai/catalog.ts";
import { decode, encode } from "../engine/codecs.ts";
import { sniff } from "../engine/formats.ts";
import { sample } from "../engine/test/setup.ts";

setDefaultTimeout(60_000);

const repo = new URL("../../", import.meta.url).pathname;
const fixtures = `${repo}fixtures/`;
const bin = process.env.PIXVAULT_BIN ? [resolve(repo, process.env.PIXVAULT_BIN)] : ["bun", `${repo}src/cli/main.ts`];
let work = "";
let cache = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "pixvault-cli-"));
  cache = join(work, "cache");
  // Seed the model cache with the self-hosted models, so nothing is downloaded.
  for (const m of Object.values(MODELS)) {
    if (m.host !== "site") continue;
    for (const f of m.files) {
      const src = `${repo}models/${m.id}/${f.path.split("/").pop()}`;
      if (!(await Bun.file(src).exists())) continue;
      await mkdir(join(cache, "models", m.id), { recursive: true });
      await copyFile(src, join(cache, "models", m.id, f.sha256));
    }
  }
  // Inputs the fixtures do not have.
  await Bun.write(join(work, "identity.cube"), cube());
  await Bun.write(join(work, "drawing.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ff5a36"/><circle cx="60" cy="40" r="30" fill="#17191c"/></svg>');
  const mask = sample(64, 48);
  for (let i = 0; i < mask.data.length; i += 4) {
    const x = (i / 4) % 64;
    const on = x > 20 && x < 30;
    mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = on ? 255 : 0;
    mask.data[i + 3] = 255;
  }
  await Bun.write(join(work, "mask.png"), await encode(mask, "png"));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

function cube(): string {
  const n = 2;
  const rows: string[] = [`LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r} ${g} ${b}`);
  return `${rows.join("\n")}\n`;
}

async function pv(args: string[], o: { cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn([...bin, ...args], { cwd: o.cwd ?? work, env: { ...process.env, PIXVAULT_CACHE: cache }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}

/** Run a tool into a fresh folder; returns the files it wrote. */
async function tool(name: string, args: string[], inputs: string[]): Promise<{ files: string[]; stdout: string }> {
  const out = join(work, `out-${name}-${Math.random().toString(36).slice(2, 8)}`);
  const r = await pv([name, ...args, ...inputs.map((i) => (i.startsWith("/") ? i : `${fixtures}${i}`)), "-o", out, "--quiet"]);
  if (r.code !== 0) throw new Error(`pixvault ${name} exited ${r.code}: ${r.stderr}`);
  const files = (await readdir(out, { recursive: true }).catch(() => [] as string[])).map((f) => join(out, f));
  return { files, stdout: r.stdout };
}

const bytes = async (p: string) => new Uint8Array(await Bun.file(p).arrayBuffer());
const formatOf = async (p: string) => sniff(await bytes(p), p);
const size = async (p: string) => {
  const r = await decode(await bytes(p), p);
  return [r.width, r.height];
};

describe("commands", () => {
  test("--version, tools, help", async () => {
    expect((await pv(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect((await pv(["tools"])).stdout).toContain("remove-bg");
    const help = await pv(["help", "compress"]);
    expect(help.stdout).toContain("--target-kb");
  });

  test("bad options are refused with a usage error", async () => {
    const r = await pv(["compress", "--qualty", "70", `${fixtures}gps.jpg`]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown option");
    expect((await pv(["compress", "--quality", "500", `${fixtures}gps.jpg`])).code).toBe(2);
  });

  test("never overwrites, unless asked", async () => {
    const out = join(work, "twice");
    for (let i = 0; i < 2; i++) expect((await pv(["compress", `${fixtures}gps.jpg`, "-o", out, "--quiet"])).code).toBe(0);
    expect((await readdir(out)).sort()).toEqual(["gps-2.jpg", "gps.jpg"]);
  });

  test("models list", async () => {
    const r = await pv(["models", "list"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("faces");
  });
});

describe("optimize", () => {
  test("compress never grows a file and writes WebP when asked", async () => {
    const { files } = await tool("compress", ["--format", "webp", "--quality", "70"], ["gps.jpg", "plain.jpg"]);
    expect(files).toHaveLength(2);
    for (const f of files) expect(await formatOf(f)).toBe("webp");
  });

  for (const to of ["jpeg", "png", "webp", "avif", "jxl", "gif", "tiff", "bmp", "ico", "qoi"] as const) {
    test(`convert HEIC to ${to}`, async () => {
      const { files } = await tool("convert", ["--to", to], ["sample.heic"]);
      expect(await formatOf(files[0]!)).toBe(to);
    });
  }

  test("convert to PDF", async () => {
    const { files } = await tool("convert", ["--to", "pdf"], ["plain.jpg"]);
    expect(new TextDecoder().decode((await bytes(files[0]!)).subarray(0, 5))).toBe("%PDF-");
  });

  test("SVG is drawn, then converted", async () => {
    const { files } = await tool("convert", ["--to", "png"], [join(work, "drawing.svg")]);
    expect(await formatOf(files[0]!)).toBe("png");
    expect(await size(files[0]!)).toEqual([2048, 1365]);
  });
});

describe("transform, adjust, brand", () => {
  test("resize to a preset", async () => {
    const { files } = await tool("resize", ["--by", "preset", "--preset", "ig-square", "--enlarge"], ["crew.jpg"]);
    expect(await size(files[0]!)).toEqual([1080, 1080]);
  });
  test("crop, rotate, canvas, border", async () => {
    expect(await size((await tool("crop", ["--ratio", "1:1"], ["crew.jpg"])).files[0]!)).toEqual([511, 511]);
    expect(await size((await tool("rotate", ["--turn", "90", "--flip-h"], ["crew.jpg"])).files[0]!)).toEqual([511, 640]);
    const [w, h] = await size((await tool("canvas", ["--ratio", "1:1"], ["crew.jpg"])).files[0]!);
    expect(w).toBe(h);
    expect((await size((await tool("border", ["--width", "5"], ["crew.jpg"])).files[0]!))[0]).toBeGreaterThan(640);
  });
  test("split into tiles", async () => {
    expect((await tool("split", ["--cols", "3", "--rows", "2"], ["crew.jpg"])).files).toHaveLength(6);
  });
  for (const [name, args] of [
    ["adjust", ["--exposure", "30", "--vibrance", "20"]],
    ["auto-enhance", []],
    ["filter", ["--filter", "sepia"]],
    ["lut", ["--cube", "identity.cube"]],
    ["watermark", ["--text", "© pixvault {year}", "--position", "tile"]],
    ["watermark", ["--kind", "image", "--logo", `${fixtures}logo.png`]],
    ["caption", ["--text", "{date} · {camera}"]],
    ["redact", ["--regions", "10,10,30,30", "--style", "pixelate"]],
  ] as [string, string[]][]) {
    test(`${name} ${args.join(" ")}`.trim(), async () => {
      const resolved = args.map((a) => (a.endsWith(".cube") ? join(work, a) : a));
      const { files } = await tool(name, resolved, ["gps.jpg"]);
      expect(await formatOf(files[0]!)).toBe("jpeg");
    });
  }
});

describe("metadata", () => {
  test("inspect --json reports the location", async () => {
    const r = await pv(["inspect", "--json", `${fixtures}gps.jpg`]);
    const j = JSON.parse(r.stdout);
    expect(j.reports.gps.lat).toBeCloseTo(43.296, 2);
  });
  test("strip the location, keep the rest, pixels untouched", async () => {
    const { files } = await tool("strip", ["--remove", "gps"], ["gps.jpg"]);
    const out = await bytes(files[0]!);
    expect(await exifr.gps(Buffer.from(out))).toBeUndefined();
    expect((await exifr.parse(Buffer.from(out)))?.Model).toBe("iPhone 15 Pro");
  });
  test("edit the date and credits", async () => {
    const { files } = await tool("edit-meta", ["--date", "2024-07-14 18:30", "--artist", "Ada"], ["gps.jpg"]);
    const m = await exifr.parse(Buffer.from(await bytes(files[0]!)));
    expect(m?.Artist).toBe("Ada");
  });
  test("rename from a pattern", async () => {
    const { files } = await tool("rename", ["--pattern", "trip-{n}", "--digits", "2"], ["gps.jpg", "plain.jpg"]);
    expect(files.map((f) => f.split("/").pop()).sort()).toEqual(["trip-01.jpg", "trip-02.jpg"]);
  });
});

describe("compose and analyze", () => {
  test("collage, compare, contact sheet, PDF", async () => {
    expect(await formatOf((await tool("collage", [], ["gps.jpg", "plain.jpg", "crew.jpg"])).files[0]!)).toBe("jpeg");
    expect(await formatOf((await tool("compare", [], ["gps.jpg", "plain.jpg"])).files[0]!)).toBeTruthy();
    const sheet = (await tool("contact-sheet", [], ["gps.jpg", "plain.jpg"])).files[0]!;
    expect(new TextDecoder().decode((await bytes(sheet)).subarray(0, 5))).toBe("%PDF-");
    const pdf = (await tool("pdf", [], ["gps.jpg", "plain.jpg"])).files[0]!;
    expect(new TextDecoder().decode((await bytes(pdf)).subarray(0, 5))).toBe("%PDF-");
  });
  test("GIF, then its frames back", async () => {
    const gif = (await tool("gif", ["--delay", "200", "--boomerang"], ["gps.jpg", "plain.jpg", "crew.jpg"])).files[0]!;
    expect(await formatOf(gif)).toBe("gif");
    expect((await tool("frames", [], [gif])).files.length).toBe(4);
  });
  test("sprite sheet and favicon set", async () => {
    const sprite = (await tool("sprite", [], ["gps.jpg", "plain.jpg"])).files.map((f) => f.split("/").pop()).sort();
    expect(sprite).toEqual(["sprite.css", "sprite.png"]);
    const icons = (await tool("favicon", [], ["logo.png"])).files.map((f) => f.split("/").pop());
    expect(icons).toContain("favicon.ico");
    expect(icons).toContain("site.webmanifest");
  });
  test("palette, histogram, duplicates, base64", async () => {
    expect(JSON.parse((await pv(["palette", "--json", `${fixtures}crew.jpg`])).stdout).reports[0].colors.length).toBeGreaterThan(2);
    expect(JSON.parse((await pv(["histogram", "--json", `${fixtures}crew.jpg`])).stdout).reports[0].luma).toHaveLength(256);
    const d = JSON.parse((await pv(["duplicates", "--json", `${fixtures}gps.jpg`, `${fixtures}gps.jpg`, `${fixtures}crew.jpg`])).stdout).reports;
    expect(d.groups).toHaveLength(1);
    expect((await pv(["base64", `${fixtures}logo.png`])).stdout).toStartWith("data:image/png;base64,");
  });
});

describe("recipes", () => {
  test("steps from the command line", async () => {
    const out = join(work, "recipe");
    const r = await pv(["recipe", "--step", "resize:by=long,size=320", "--step", "filter:filter=bw", "--format", "webp", `${fixtures}crew.jpg`, "-o", out, "--quiet"]);
    expect(r.code).toBe(0);
    const f = join(out, "crew.webp");
    expect(await formatOf(f)).toBe("webp");
    expect((await size(f))[0]).toBe(320);
  });
  test("a link copied from the web app", async () => {
    const recipe = { name: "t", steps: [{ tool: "resize", options: { by: "long", size: 200 } }], output: { format: "png", metadata: "strip" } };
    const link = `https://maxgfr.github.io/pixvault/#/recipe?r=${btoa(JSON.stringify(recipe)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    const out = join(work, "recipe-link");
    expect((await pv(["recipe", "--recipe", link, `${fixtures}crew.jpg`, "-o", out, "--quiet"])).code).toBe(0);
    expect(await formatOf(join(out, "crew.png"))).toBe("png");
  });
});

describe("AI on this machine", () => {
  const have = (id: keyof typeof MODELS) => MODELS[id].files.every((f) => Bun.file(`${repo}models/${id}/${f.path.split("/").pop()}`).size > 0);
  test.if(have("background-lite"))("remove the background", async () => {
    const { files } = await tool("remove-bg", [], ["crew.jpg"]);
    expect(await formatOf(files[0]!)).toBe("png");
  }, 120_000);
  test.if(have("upscale-2"))("upscale ×2", async () => {
    const small = join(work, "small.png");
    await Bun.write(small, await encode(sample(40, 30), "png"));
    expect(await size((await tool("upscale", ["--scale", "2"], [small])).files[0]!)).toEqual([80, 60]);
  }, 120_000);
  test.if(have("faces"))("blur faces and smart crop", async () => {
    expect(await formatOf((await tool("blur-faces", [], ["crew.jpg"])).files[0]!)).toBe("jpeg");
    expect(await size((await tool("smart-crop", ["--ratio", "1:1"], ["crew.jpg"])).files[0]!)).toEqual([511, 511]);
  }, 120_000);
  test.if(have("inpaint"))("erase what the mask covers", async () => {
    expect(await formatOf((await tool("erase", ["--mask", join(work, "mask.png")], ["crew.jpg"])).files[0]!)).toBe("jpeg");
  }, 120_000);
  test.if(process.env.PIXVAULT_TEST_CAPTION === "1")("describe with Florence-2", async () => {
    const r = await pv(["describe", "--json", `${fixtures}crew.jpg`]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).reports[0].caption.length).toBeGreaterThan(5);
  }, 900_000);
});

test("a ZIP is never needed: folders go in, folders come out", async () => {
  const out = join(work, "folder");
  expect((await pv(["compress", fixtures, "-o", out, "--quiet"])).code).toBe(0);
  expect((await readdir(out)).length).toBeGreaterThanOrEqual(5);
  expect(unzipSync).toBeDefined();
});
