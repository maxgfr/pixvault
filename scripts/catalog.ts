// The model catalog for "Describe and tag" with your own API key: built by
// llm-models, then cut down to the providers whose API hosts the page's CSP
// allows (index.html connect-src), and to models that can see images.
import { $ } from "bun";

export const PROVIDERS = ["openai", "anthropic", "google", "mistral", "openrouter", "groq", "xai"] as const;

const out = new URL("../public/models.json", import.meta.url).pathname;
await $`bunx llm-models catalog --npm callable --require ${PROVIDERS.slice(0, 4).join(",")} --out ${out}`.quiet();
const all = (await Bun.file(out).json()) as Record<string, { models: Record<string, { input?: string[] }>; defaultModel?: string }>;
const kept: typeof all = {};
for (const id of PROVIDERS) {
  const p = all[id];
  if (!p) continue;
  const models = Object.fromEntries(Object.entries(p.models).filter(([, m]) => m.input?.includes("image")));
  if (!Object.keys(models).length) continue;
  kept[id] = { ...p, models, defaultModel: p.defaultModel && models[p.defaultModel] ? p.defaultModel : Object.keys(models)[0] };
}
await Bun.write(out, JSON.stringify(kept));
console.log(`models.json: ${Object.keys(kept).length} providers, ${Object.values(kept).reduce((n, p) => n + Object.keys(p.models).length, 0)} vision models`);
