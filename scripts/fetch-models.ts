// Downloads the AI models this site serves itself into models/<id>/, pinned
// by SHA-256 (src/ai/catalog.ts). The build copies them to dist/models/; the
// browser downloads them from there only when the user asks for that tool.
// Bigger models are not fetched here: the browser gets them from Hugging Face.
import { mkdir } from "node:fs/promises";
import { MODELS } from "../src/ai/catalog.ts";

const dir = new URL("../models/", import.meta.url).pathname;

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

for (const m of Object.values(MODELS)) {
  if (m.host !== "site") continue;
  await mkdir(`${dir}${m.id}`, { recursive: true });
  for (const f of m.files) {
    const out = `${dir}${m.id}/${f.path.split("/").pop()}`;
    const have = Bun.file(out);
    if ((await have.exists()) && (await sha256(await have.arrayBuffer())) === f.sha256) continue;
    const url = `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    const got = await sha256(bytes);
    if (got !== f.sha256) throw new Error(`${m.id}/${f.path}: sha256 ${got}, expected ${f.sha256}`);
    await Bun.write(out, bytes);
    console.log(`${m.id}: ${f.path} (${(bytes.byteLength / 1e6).toFixed(1)} MB)`);
  }
}
console.log("models ready");
