// "Describe and tag" with the user's own AI provider, through llm-connect:
// the key is encrypted at rest under a non-extractable WebCrypto key, the
// catalog is the static ./models.json (no live lookup), and nothing is sent
// anywhere until the user has saved a provider and runs the tool.

import "./zod-jitless.ts";
import { generateText } from "ai";
import { callProblem, createLlmSettingsStore, describeError, isConfigured, type LlmSettings, loadModel, resolveCapabilities, providerKindOf, modelIdOf, secureStorage } from "llm-connect";
import { currentLang } from "../i18n.ts";

export const llm = createLlmSettingsStore({
  catalogUrl: "./models.json",
  storage: secureStorage({ prefsKey: "pixvault-ai", dbName: "pixvault-secrets" }),
  recommended: ["openai", "anthropic", "google", "mistral", "openrouter"],
});

let loaded: Promise<unknown> | null = null;
export const loadLlm = () => (loaded ??= llm.load().catch(() => null));

export function savedSettings(): LlmSettings | null {
  const s = llm.getState().saved;
  return s && isConfigured(s) ? (s as LlmSettings) : null;
}

export interface Description {
  caption: string;
  keywords: string[];
}

const LANG: Record<string, string> = { en: "English", fr: "French" };

/** Ask the saved model to describe one photo (a JPEG, already reduced by the page). */
export async function describeWithApi(jpeg: Uint8Array, detail: "short" | "long", language: string, signal?: AbortSignal): Promise<Description> {
  const settings = savedSettings();
  if (!settings) throw new Error("no AI provider is set up");
  const lang = LANG[language === "auto" ? currentLang() : language] ?? "English";
  const messages = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `Describe this photo for its alt text${detail === "long" ? " in a detailed paragraph" : " in one sentence"}, then give up to 10 keywords. Write in ${lang}. Answer with JSON only: {"caption": "...", "keywords": ["..."]}`,
        },
        { type: "image" as const, image: jpeg, mediaType: "image/jpeg" },
      ],
    },
  ];
  const capabilities = resolveCapabilities({ kind: providerKindOf(settings), modelId: modelIdOf(settings) });
  const problem = callProblem(settings, { messages }, capabilities);
  if (problem) throw new Error(problem.message);
  try {
    const res = await generateText({ model: await loadModel(settings), messages, maxRetries: 1, abortSignal: signal });
    const json = /\{[\s\S]*\}/.exec(res.text)?.[0];
    const parsed = json ? (JSON.parse(json) as Partial<Description>) : null;
    return { caption: String(parsed?.caption ?? res.text).trim(), keywords: Array.isArray(parsed?.keywords) ? parsed.keywords.map(String).slice(0, 12) : [] };
  } catch (e) {
    throw new Error(describeError(e).message);
  }
}
