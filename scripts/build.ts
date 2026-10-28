// Build the site into dist/: bundle the app, the worker and the service
// worker, copy the wasm modules, and write the offline manifest.
// `--serve` then serves dist/ under /pixvault/ like GitHub Pages does.
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { MODELS } from "../src/ai/catalog.ts";
import { WASM } from "../src/engine/wasm.ts";

const root = new URL("../", import.meta.url).pathname;
const dist = `${root}dist`;
const serve = process.argv.includes("--serve");
const BASE = "/pixvault/";

await rm(dist, { recursive: true, force: true });

function check(result: Awaited<ReturnType<typeof Bun.build>>) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

// Emscripten glue (libheif) requires Node built-ins on its Node.js path only:
// resolve them to an empty module instead of bundling polyfills.
const noNodeBuiltins: Bun.BunPlugin = {
  name: "no-node-builtins",
  setup(build) {
    build.onResolve({ filter: /^(node:)?(fs|path|crypto|buffer|util|events|stream|url|os|child_process|worker_threads|module)$/ }, () => ({ path: `${root}scripts/node-stub.ts` }));
  },
};

check(
  await Bun.build({
    entrypoints: [`${root}index.html`],
    outdir: dist,
    minify: true,
    splitting: true,
    naming: { entry: "[name].[ext]", chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": '"production"' },
  }),
);
check(
  await Bun.build({
    entrypoints: [`${root}src/worker.ts`],
    outdir: dist,
    minify: true,
    target: "browser",
    format: "esm",
    splitting: true,
    naming: { entry: "worker.js", chunk: "assets/w-[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [noNodeBuiltins],
  }),
);

await mkdir(`${dist}/wasm`, { recursive: true });
for (const [name, path] of Object.entries(WASM)) await cp(`${root}node_modules/${path}`, `${dist}/wasm/${name}.wasm`);

// ONNX Runtime's WebGPU build for the AI tools, served from here, never from a CDN.
await mkdir(`${dist}/ort`, { recursive: true });
for (const ext of ["mjs", "wasm"]) await cp(`${root}node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.${ext}`, `${dist}/ort/ort-wasm-simd-threaded.asyncify.${ext}`);
// The models this site serves (scripts/fetch-models.ts), downloaded by users only on request.
for (const m of Object.values(MODELS)) {
  if (m.host !== "site") continue;
  await mkdir(`${dist}/models/${m.id}`, { recursive: true });
  for (const f of m.files) {
    const name = f.path.split("/").pop()!;
    await cp(`${root}models/${m.id}/${name}`, `${dist}/models/${m.id}/${name}`);
  }
}

await cp(`${root}public`, dist, { recursive: true });
// Links to files under public/ are added after bundling: the HTML bundler
// would otherwise try to resolve and rename them.
const html = await Bun.file(`${dist}/index.html`).text();
await Bun.write(
  `${dist}/index.html`,
  html.replace(
    "</head>",
    '<link rel="icon" href="./icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="./icon-192.png"><link rel="manifest" href="./manifest.webmanifest"></head>',
  ),
);
await Bun.write(`${dist}/.nojekyll`, "");

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files: string[] = [];
const hash = createHash("sha256");
for await (const p of walk(dist)) {
  const rel = relative(dist, p);
  if (rel === ".nojekyll") continue;
  files.push(rel);
  hash.update(rel).update(new Uint8Array(await Bun.file(p).arrayBuffer()));
}
files.sort();
// The everyday codecs are cached at install; the rarer ones (AVIF, JPEG XL,
// HEIC, QOI) and the AI runtime the first time a photo needs them.
const EAGER_WASM = new Set(["jpeg-enc", "jpeg-dec", "webp-enc", "webp-dec", "png", "oxipng", "resize"]);
const lazy = files.filter((f) => (f.startsWith("wasm/") && !EAGER_WASM.has(f.slice(5, -5))) || f.startsWith("ort/") || /^assets\/w-(ai|transformers|ort|pdf)[\w-]*\.js$/.test(f));
// Models stay out of both lists: only the user's "Download" puts them on the device.
const precache = ["./", ...files.filter((f) => f !== "index.html" && !f.startsWith("models/") && !lazy.includes(f))];
const manifest = { version: hash.digest("hex").slice(0, 16), precache, lazy };

check(
  await Bun.build({
    entrypoints: [`${root}src/sw.ts`],
    outdir: dist,
    minify: true,
    target: "browser",
    naming: "sw.js",
    define: { __MANIFEST__: JSON.stringify(manifest) },
  }),
);

let total = 0;
for (const f of files) total += (await stat(`${dist}/${f}`)).size;
console.log(`site: ${files.length + 1} files, ${(total / 1048576).toFixed(1)} MiB, version ${manifest.version}`);

if (serve) {
  const port = Number(process.env.PORT ?? 4173);
  const types: Record<string, string> = { wasm: "application/wasm", webmanifest: "application/manifest+json", mjs: "text/javascript", onnx: "application/octet-stream" };
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(BASE)) return Response.redirect(`${url.origin}${BASE}`, 302);
      let path = decodeURIComponent(url.pathname.slice(BASE.length)) || "index.html";
      if (path.endsWith("/")) path += "index.html";
      const file = Bun.file(join(dist, path));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      const ext = path.split(".").pop() ?? "";
      return new Response(file, types[ext] ? { headers: { "content-type": types[ext] } } : undefined);
    },
  });
  console.log(`serving http://localhost:${port}${BASE}`);
}
