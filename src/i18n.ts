// English and French, following the browser until the user picks one.
// Strings live next to the code that shows them, as { en, fr } pairs (the
// tool catalog uses the same shape), so a translation never drifts from its
// context.

import { useSyncExternalStore } from "react";
import type { L } from "./tools/types.ts";

export type Lang = "en" | "fr";

const KEY = "pixvault-lang";
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let lang: Lang = initial();
document.documentElement.lang = lang;

export function setLang(next: Lang) {
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  for (const fn of listeners) fn();
}

export const currentLang = () => lang;

export function useLang() {
  const l = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => lang,
  );
  return {
    lang: l,
    /** A catalog string in the current language. */
    l: (s: L) => s[l],
    /** An inline pair: t("Download", "Télécharger"). */
    t: (en: string, fr: string) => (l === "fr" ? fr : en),
  };
}

/** For code outside components (titles, errors). */
export const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

const units = { en: ["B", "KB", "MB", "GB"], fr: ["o", "Ko", "Mo", "Go"] };

export function bytes(n: number, l: Lang = lang): string {
  let i = 0;
  let v = n;
  while (v >= 1000 && i < 3) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(l, { maximumFractionDigits: digits }).format(v)} ${units[l][i]}`;
}

/** "−62 %" / "+4 %" relative change. */
export function delta(before: number, after: number, l: Lang = lang): string {
  if (!before) return "";
  const p = Math.round(((after - before) / before) * 100);
  const sign = p > 0 ? "+" : p < 0 ? "−" : "±";
  return l === "fr" ? `${sign}${Math.abs(p)} %` : `${sign}${Math.abs(p)}%`;
}

export const count = (n: number, l: Lang = lang) => new Intl.NumberFormat(l).format(n);

/** "1 photo" / "12 photos" in both languages. */
export const photos = (n: number, l: Lang = lang) => `${count(n, l)} photo${n > 1 ? "s" : ""}`;

/** Translations for engine error codes (src/engine/errors.ts). */
export function errorText(code: string, message: string): string {
  const known: Record<string, [string, string]> = {
    unsupported: ["pixvault cannot read or write this here", "pixvault ne peut pas lire ou écrire ceci ici"],
    damaged: ["this file looks damaged", "ce fichier semble endommagé"],
    "too-large": ["this image is too large to process in a browser tab", "cette image est trop grande pour un onglet de navigateur"],
    "no-preview": ["this RAW file has no full-size preview inside", "ce fichier RAW ne contient pas d'aperçu pleine taille"],
    "encode-failed": ["the encoder failed on this image", "l'encodeur a échoué sur cette image"],
    "bad-options": ["these settings cannot be applied", "ces réglages ne peuvent pas s'appliquer"],
    timeout: ["this took too long and was stopped", "c'était trop long, le traitement a été arrêté"],
    crash: ["the browser ran out of memory on this photo", "le navigateur a manqué de mémoire sur cette photo"],
    cancelled: ["cancelled", "annulé"],
    model: ["the AI model could not run", "le modèle d'IA n'a pas pu tourner"],
  };
  const k = known[code];
  if (!k) return message;
  // English keeps the engine's precise message; French gets the translated summary.
  return lang === "fr" ? k[1] : message || k[0];
}
