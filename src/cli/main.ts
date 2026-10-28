#!/usr/bin/env bun
// pixvault on the command line: the same engine and tools as the web app,
// on local files, offline (AI models download once, on first use).
//
//   pixvault <tool> [--option value …] <photos or folders…> [-o folder]
//   pixvault recipe --step "resize:size=1600" --step "watermark:text=© Me" photos/
//   pixvault tools | help <tool> | models [list|download <id>|remove <id>|path] | --version

import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { MODELS, type ModelId, modelBytes, modelFor } from "../ai/catalog.ts";
import type { InspectReport } from "../engine/meta/read.ts";
import { sniff } from "../engine/formats.ts";
import { type RecipeStep, runRecipe, runTool, STEPS } from "../engine/run/index.ts";
import type { Ctx, Input, Output, RunResult } from "../engine/run/types.ts";
import { CATEGORIES, type Field, OUTPUT_FIELDS, type Options, type ToolDef, toolById, tools, withDefaults } from "../tools/index.ts";
import { cachedSize, cacheDir, downloadModel, isDownloaded, rasteriseSvg, removeModel, setup } from "./env.ts";

declare const __PIXVAULT_VERSION__: string | undefined;
const VERSION = typeof __PIXVAULT_VERSION__ === "string" ? __PIXVAULT_VERSION__ : "0.0.0-dev";

const out = (s = "") => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

class UsageError extends Error {}

// ── Arguments ────────────────────────────────────────────────────────────

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
  steps: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, "");

function parse(argv: string[], switches: Set<string>): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const steps: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a === "-o") {
      flags.set("out", argv[++i] ?? "");
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = norm(eq > 0 ? a.slice(2, eq) : a.slice(2));
      let value: string | true = eq > 0 ? a.slice(eq + 1) : true;
      // `--name value`, unless the next word is another flag or this is a known switch.
      if (value === true && !switches.has(key) && !(key.startsWith("no") && switches.has(key.slice(2))) && i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) value = argv[++i]!;
      if (key === "step") steps.push(String(value));
      else flags.set(key, value);
      continue;
    }
    positional.push(a);
  }
  return { positional, flags, steps };
}

/** Flags that never take a value (tool booleans are handled from the catalog). */
const SWITCHES = new Set(["json", "offline", "quiet", "help", "version", "overwrite"]);

const GLOBAL = new Set(["out", "json", "offline", "quiet", "help", "overwrite", "recipe", "step"]);

/** A catalog field's value from a command-line string. */
function coerce(f: Field, raw: string | true, toolId: string): Options[string] | Promise<Uint8Array> {
  const fail = (why: string) => new UsageError(`--${kebab(f.name)}: ${why} (pixvault help ${toolId})`);
  switch (f.kind) {
    case "boolean":
      if (raw === true || raw === "true" || raw === "yes" || raw === "1") return true;
      if (raw === "false" || raw === "no" || raw === "0") return false;
      throw fail(`expected true or false, got "${raw}"`);
    case "number":
    case "range": {
      const n = Number(raw);
      if (raw === true || !Number.isFinite(n)) throw fail(`expected a number`);
      if (n < f.min || n > f.max) throw fail(`expected ${f.min} to ${f.max}${f.unit ? ` ${f.unit}` : ""}, got ${n}`);
      return n;
    }
    case "select": {
      const v = String(raw);
      if (!f.choices.some((c) => c.value === v)) throw fail(`expected one of ${f.choices.map((c) => c.value).join(", ")}`);
      return v;
    }
    case "color": {
      const v = String(raw);
      if (!/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) throw fail(`expected a colour like #ff5a36`);
      return v.startsWith("#") ? v : `#${v}`;
    }
    case "file": {
      if (raw === true) throw fail("expected a file path");
      return Bun.file(resolve(String(raw)))
        .arrayBuffer()
        .then((b) => new Uint8Array(b))
        .catch(() => {
          throw fail(`cannot read ${raw}`);
        });
    }
    default:
      if (raw === true) throw fail("expected a value");
      return String(raw);
  }
}

const fieldsOf = (t: ToolDef) => [...t.fields, ...(t.output ? OUTPUT_FIELDS : [])];

/** Options for a tool from flags (or a recipe step's key=value pairs); unknown names are errors. */
async function optionsFor(t: ToolDef, given: Map<string, string | true>, skip = GLOBAL): Promise<Options> {
  const fields = new Map(fieldsOf(t).map((f) => [norm(f.name), f]));
  const o: Options = {};
  for (const [key, raw] of given) {
    if (skip.has(key)) continue;
    let f = fields.get(key);
    let value: string | true = raw;
    if (!f && key.startsWith("no") && fields.get(key.slice(2))?.kind === "boolean") {
      f = fields.get(key.slice(2));
      value = "false";
    }
    if (!f) {
      const near = [...fields.values()].map((x) => x.name).filter((n) => norm(n).includes(key) || key.includes(norm(n)));
      throw new UsageError(`unknown option --${key} for ${t.id}${near.length ? ` (did you mean --${kebab(near[0]!)}?)` : ""}; see pixvault help ${t.id}`);
    }
    o[f.name] = await coerce(f, value, t.id);
  }
  return withDefaults(t, o);
}

// ── Inputs and outputs ──────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|jxl|gif|bmp|tiff?|heic|heif|dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|iiq|rwl|svg|qoi|ico)$/i;

async function collect(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    const full = resolve(p);
    const info = await stat(full).catch(() => null);
    if (!info) throw new UsageError(`no such file: ${p}`);
    if (info.isDirectory()) {
      const entries = (await readdir(full, { recursive: true })).filter((e) => IMAGE_EXT.test(e) && !basename(e).startsWith(".")).sort();
      files.push(...entries.map((e) => join(full, e)));
    } else files.push(full);
  }
  if (!files.length) throw new UsageError("no photos given");
  return files;
}

async function readInput(path: string): Promise<Input> {
  let bytes: Uint8Array = new Uint8Array(await Bun.file(path).arrayBuffer());
  let name = basename(path);
  // SVG is drawn to a PNG first, as the web app does.
  if (sniff(bytes, name) === "svg") {
    bytes = await rasteriseSvg(bytes);
    name = name.replace(/\.svg$/i, ".png");
  }
  return { name, bytes };
}

/** Never overwrite: photo.jpg, photo-2.jpg… unless --overwrite. */
async function freeName(dir: string, name: string, taken: Set<string>, overwrite: boolean): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = join(dir, n === 1 ? name : `${stem}-${n}${ext}`);
    if (taken.has(candidate)) continue;
    if (overwrite || !(await Bun.file(candidate).exists())) {
      taken.add(candidate);
      return candidate;
    }
  }
}

const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const pct = (a: number, b: number) => (a ? `${b <= a ? "−" : "+"}${Math.abs(Math.round(((b - a) / a) * 100))}%` : "");

function ctx(label: string, quiet: boolean): Ctx {
  return {
    progress: (done, total, name) => {
      if (!quiet && process.stderr.isTTY && total > 1) process.stderr.write(`\r${label} ${done}/${total}${name ? ` ${name}` : ""}\x1b[K`);
    },
    check: () => {},
  };
}

// ── Reports ──────────────────────────────────────────────────────────────

const RISK: Record<string, string> = {
  location: "where it was taken (GPS)",
  serial: "the camera's serial number",
  owner: "the owner's name",
  timestamp: "the exact date and time",
  device: "the device that took it",
  software: "the software that edited it",
  thumbnail: "a hidden thumbnail (may show the uncropped original)",
  history: "an edit history",
};

function printReport(toolId: string, report: unknown) {
  const list = Array.isArray(report) ? report : [report];
  for (const r of list as Record<string, unknown>[]) {
    if (!r) continue;
    switch (toolId) {
      case "inspect": {
        const i = r as unknown as InspectReport;
        out(`${i.name}  ${i.format?.toUpperCase() ?? "?"} · ${i.width ?? "?"}×${i.height ?? "?"} · ${kb(i.size)}`);
        if (i.risks.length) out(`  gives away: ${i.risks.map((k) => RISK[k.code] ?? k.code).join("; ")}`);
        if (i.gps) out(`  location: ${i.gps.lat.toFixed(5)}, ${i.gps.lon.toFixed(5)}`);
        for (const g of i.groups) for (const e of g.entries) out(`  ${e.label.en}: ${e.value}`);
        out();
        break;
      }
      case "palette":
        out(`${r.name}  ${(r.colors as { hex: string; share: number }[]).map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join("  ")}`);
        break;
      case "histogram":
        out(`${r.name}  mean ${Math.round(((r.mean as number) / 255) * 100)}% · shadows clipped ${((r.clippedShadows as number) * 100).toFixed(1)}% · highlights clipped ${((r.clippedHighlights as number) * 100).toFixed(1)}% · ${r.hint}`);
        break;
      case "duplicates": {
        const d = r as unknown as { groups: { indices: number[]; similarity: number }[]; photos: { name: string }[] };
        if (!d.groups.length) out("No duplicates.");
        for (const g of d.groups) out(`${Math.round(g.similarity * 100)}%  ${g.indices.map((k) => d.photos[k]?.name).join("  ")}`);
        break;
      }
      case "base64":
        out(String(r.dataUri));
        break;
      case "describe":
        out(`${r.name}: ${r.caption}${(r.keywords as string[]).length ? `\n  keywords: ${(r.keywords as string[]).join(", ")}` : ""}`);
        break;
    }
  }
}

// ── Running ──────────────────────────────────────────────────────────────

async function writeAll(files: Output[], dir: string, overwrite: boolean): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const taken = new Set<string>();
  const paths: string[] = [];
  for (const f of files) {
    const target = await freeName(dirname(join(dir, f.name)), basename(f.name), taken, overwrite);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, f.bytes);
    paths.push(target);
  }
  return paths;
}

async function run(t: ToolDef | null, steps: RecipeStep[] | null, options: Options, inputs: string[], flags: Map<string, string | true>) {
  const quiet = flags.has("quiet");
  const json = flags.has("json");
  const dir = resolve(String(flags.get("out") ?? "."));
  const overwrite = flags.has("overwrite");
  const label = t?.id ?? "recipe";
  const files = await collect(inputs);
  const reports: unknown[] = [];
  const written: { from: string; to: string[]; before: number; after: number }[] = [];
  let failed = 0;

  const one = async (paths: string[]) => {
    const ins = await Promise.all(paths.map(readInput));
    const c = ctx(label, quiet || json);
    const r: RunResult = steps ? await runRecipe(steps, options, ins, c) : await runTool(t!.id, ins, options, c);
    if (r.report !== undefined) reports.push(r.report);
    const to = await writeAll(r.files, dir, overwrite);
    written.push({ from: paths.length === 1 ? paths[0]! : `${paths.length} photos`, to, before: ins.reduce((n, i) => n + i.bytes.length, 0), after: r.files.reduce((n, f) => n + f.bytes.length, 0) });
  };

  if (t && t.input === "images") {
    if (t.min && files.length < t.min) throw new UsageError(`${t.id} needs at least ${t.min} photos`);
    await one(files);
  } else {
    for (const [i, f] of files.entries()) {
      if (!quiet && !json && process.stderr.isTTY && files.length > 1) process.stderr.write(`\r${label} ${i + 1}/${files.length} ${basename(f)}\x1b[K`);
      try {
        await one([f]);
      } catch (e) {
        failed++;
        err(`\r${basename(f)}: ${(e as Error).message}\x1b[K`);
      }
    }
  }
  if (!quiet && !json && process.stderr.isTTY) process.stderr.write("\r\x1b[K");

  if (json) {
    out(JSON.stringify({ tool: label, outputs: written, reports: reports.length === 1 ? reports[0] : reports }, null, 2));
  } else {
    for (const r of reports) printReport(t?.id ?? "", r);
    if (!quiet) {
      for (const w of written) for (const p of w.to) out(`${p}${w.to.length === 1 && w.before ? `  ${kb(w.before)} → ${kb(w.after)} ${pct(w.before, w.after)}` : ""}`);
      const before = written.reduce((n, w) => n + w.before, 0);
      const after = written.reduce((n, w) => n + w.after, 0);
      if (written.length > 1 && after) err(`${written.length} photos · ${kb(before)} → ${kb(after)} ${pct(before, after)}`);
    }
  }
  if (failed) process.exitCode = 1;
}

/** "resize:by=long,size=1600" → a recipe step with its options checked. */
async function stepOf(spec: string): Promise<RecipeStep> {
  const at = spec.indexOf(":");
  const id = (at < 0 ? spec : spec.slice(0, at)).trim();
  const t = toolById.get(id);
  if (!t || !STEPS[id] || t.model) throw new UsageError(`"${id}" cannot be a recipe step; steps: ${tools.filter((x) => x.step && !x.model).map((x) => x.id).join(", ")}`);
  const pairs = new Map<string, string | true>();
  if (at >= 0) {
    for (const part of spec.slice(at + 1).split(/,(?=[\w-]+=)/)) {
      const eq = part.indexOf("=");
      if (eq < 0) throw new UsageError(`step ${id}: expected key=value, got "${part}"`);
      pairs.set(norm(part.slice(0, eq).trim()), part.slice(eq + 1));
    }
  }
  return { tool: id, options: await optionsFor({ ...t, output: false }, pairs, new Set()) };
}

/** The steps of a recipe link copied from the web app (…#/recipe?r=…). */
function recipeFromLink(link: string): { steps: RecipeStep[]; output: Options } {
  const r = /[?&]r=([\w-]+)/.exec(link)?.[1] ?? link;
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) as { steps: RecipeStep[]; output: Options };
  for (const s of json.steps) if (!STEPS[s.tool]) throw new UsageError(`the recipe uses an unknown step ${s.tool}`);
  return { steps: json.steps.map((s) => ({ tool: s.tool, options: withDefaults(toolById.get(s.tool)!, s.options) })), output: json.output };
}

// ── Help ─────────────────────────────────────────────────────────────────

const USAGE = `pixvault ${VERSION} — private photo tools, on your machine

Usage:
  pixvault <tool> [--option value …] <photos or folders…> [-o folder]
  pixvault recipe --step "resize:size=1600" --step "watermark:text=© Me" [--format webp] <photos…>
  pixvault recipe --recipe "<link copied from the web app>" <photos…>
  pixvault tools                 every tool, by category
  pixvault help <tool>           a tool's options
  pixvault models [list|download <id>|remove <id>|path]

Options for every tool:
  -o, --out <folder>   where to write (default: the current folder); never overwrites unless --overwrite
  --json               machine-readable output and reports
  --quiet              no progress, no summary
  --offline            fail instead of downloading an AI model

Examples:
  pixvault compress --quality 75 --format webp photos/
  pixvault convert --to jpeg IMG_0042.HEIC
  pixvault strip --remove gps *.jpg -o shared/
  pixvault resize --by preset --preset ig-portrait trip/ -o instagram/
  pixvault remove-bg product.jpg
  pixvault inspect --json photo.jpg

The same engine as https://maxgfr.github.io/pixvault/ — nothing is uploaded.`;

/** targetKb → target-kb (either spelling is accepted). */
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function describeField(f: Field): string {
  const name = `--${kebab(f.name)}`;
  let kind = "";
  switch (f.kind) {
    case "select":
      kind = f.choices.map((c) => c.value).join("|");
      break;
    case "number":
    case "range":
      kind = `${f.min}–${f.max}${f.unit ? ` ${f.unit}` : ""}`;
      break;
    case "boolean":
      kind = `(switch; --no-${kebab(f.name)} to turn off)`;
      break;
    case "file":
      kind = "<file>";
      break;
    case "color":
      kind = "#rrggbb";
      break;
    default:
      kind = "<text>";
  }
  const def = "default" in f && f.default !== undefined && f.default !== "" ? ` [${f.default}]` : "";
  return `  ${name.padEnd(16)} ${kind}${def}\n      ${f.label.en}${f.help ? ` — ${f.help.en}` : ""}`;
}

function toolHelp(t: ToolDef): string {
  const model = t.model ? `\nUses an AI model, downloaded once on first use.` : "";
  const fields = fieldsOf(t);
  return `pixvault ${t.id} — ${t.title.en}\n${t.summary.en}${model}\n\nUsage: pixvault ${t.id} [options] <${t.input === "images" ? "photos…" : "photos or folders…"}> [-o folder]\n${fields.length ? `\nOptions:\n${fields.map(describeField).join("\n")}` : ""}`;
}

function listTools(): string {
  return CATEGORIES.map((c) => `${c.title.en}\n${tools.filter((t) => t.category === c.id).map((t) => `  ${t.id.padEnd(15)} ${t.title.en}`).join("\n")}`).join("\n\n");
}

// No WebGPU on the command line: the models the tools pick on the processor, not the graphics-card ones of the web app.
const NO_GPU = { f16: false, storage: 0 };
const CLI_MODELS = new Set(tools.flatMap((t) => [modelFor(t.id, {}, NO_GPU), modelFor(t.id, { scale: "4" }, NO_GPU)]).filter((id): id is ModelId => id !== null));

async function models(args: string[]) {
  const [action = "list", id] = args;
  if (action === "path") return out(cacheDir());
  if (action === "list") {
    for (const m of Object.values(MODELS).filter((m) => CLI_MODELS.has(m.id))) out(`${(await isDownloaded(m.id)) ? "✓" : " "} ${m.id.padEnd(16)} ${kb(modelBytes(m)).padStart(9)}  ${m.licence.padEnd(10)} ${m.label.en}`);
    out(`\n${(await cachedSize()) / 1e6 > 0 ? `${((await cachedSize()) / 1e6).toFixed(0)} MB in ${cacheDir()}` : `cache: ${cacheDir()}`}`);
    return;
  }
  if (!id || !(id in MODELS)) throw new UsageError(`models ${action} <id>: one of ${Object.keys(MODELS).join(", ")}`);
  if (action === "download") {
    if (!CLI_MODELS.has(id as ModelId)) throw new UsageError(`${id} runs on a graphics card, in the web app only; the command line uses ${[...CLI_MODELS].join(", ")}`);
    return downloadModel(id as ModelId);
  }
  if (action === "remove") return removeModel(id as ModelId);
  throw new UsageError(`unknown models action ${action}`);
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function main(argv: string[]) {
  // The tool's own switches (booleans) never take the next word as their value.
  const command0 = argv.find((a) => !a.startsWith("-"));
  const tool0 = command0 ? toolById.get(command0) : undefined;
  const switches = new Set([...SWITCHES, ...(tool0 ? fieldsOf(tool0).filter((f) => f.kind === "boolean").map((f) => norm(f.name)) : [])]);
  const { positional, flags, steps } = parse(argv, switches);
  const [command, ...rest] = positional;
  if (flags.has("version") || command === "version") return out(VERSION);
  if (!command || (command === "help" && !rest.length)) return out(USAGE);
  if (command === "help") {
    const t = toolById.get(rest[0]!);
    if (!t) throw new UsageError(`unknown tool ${rest[0]}; see pixvault tools`);
    return out(toolHelp(t));
  }
  if (command === "tools") return out(listTools());
  await setup({ offline: flags.has("offline"), quiet: flags.has("quiet") || flags.has("json") });
  if (command === "models") return models(rest);
  if (command === "recipe") {
    if (flags.has("help")) return out(USAGE);
    let plan: { steps: RecipeStep[]; output: Options };
    if (flags.has("recipe")) plan = recipeFromLink(String(flags.get("recipe")));
    else {
      if (!steps.length) throw new UsageError('recipe needs --step "<tool>:key=value,…" (or --recipe <link>)');
      plan = { steps: await Promise.all(steps.map(stepOf)), output: {} };
    }
    // Output options (--format, --quality, --metadata) override the link's.
    const outTool: ToolDef = { id: "recipe", title: { en: "Recipe", fr: "Recette" }, summary: { en: "", fr: "" }, category: "transform", input: "image", fields: [], output: true };
    const given = await optionsFor(outTool, flags);
    const explicit = new Set(OUTPUT_FIELDS.filter((f) => flags.has(norm(f.name))).map((f) => f.name));
    const output: Options = { ...given, ...plan.output };
    for (const name of explicit) output[name] = given[name];
    return run(null, plan.steps, output, rest, flags);
  }
  const t = toolById.get(command);
  if (!t) throw new UsageError(`unknown tool or command "${command}"; see pixvault tools`);
  if (flags.has("help")) return out(toolHelp(t));
  if (t.id === "describe" && flags.get("engine") === "api") throw new UsageError("describe --engine api is available in the web app; the command line describes photos on this machine");
  const options = await optionsFor(t, flags);
  return run(t, null, options, rest, flags);
}

// Piped into `head` or a pager that quits: the reader has what it wanted, so stop quietly like other tools do.
const closedPipe = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code === "EPIPE";

if (import.meta.main) {
  process.stdout.on("error", (e) => {
    if (closedPipe(e)) process.exit(0);
    throw e;
  });
  main(process.argv.slice(2)).catch((e: unknown) => {
    if (closedPipe(e)) process.exit(0);
    err(`pixvault: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
