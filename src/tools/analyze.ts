import type { L, ToolDef } from "./types.ts";

const q = (en: string, fr: string): L => ({ en, fr });

export const analyzeTools: ToolDef[] = [
  {
    id: "palette",
    title: q("Colour palette", "Palette de couleurs"),
    summary: q("The dominant colours of a photo, ready to copy as HEX, RGB, CSS variables or JSON.", "Les couleurs dominantes d'une photo, à copier en HEX, RGB, variables CSS ou JSON."),
    category: "analyze",
    input: "image",
    report: true,
    aliases: ["colors", "colours", "swatch", "dominant", "hex", "theme", "couleurs", "nuancier"],
    fields: [{ name: "count", kind: "number", label: q("Colours", "Couleurs"), min: 2, max: 16, default: 6 }],
  },
  {
    id: "histogram",
    title: q("Histogram and exposure", "Histogramme et exposition"),
    summary: q("Light and colour distribution, clipped highlights and shadows, average brightness.", "Répartition de la lumière et des couleurs, hautes lumières et ombres brûlées, luminosité moyenne."),
    category: "analyze",
    input: "image",
    report: true,
    aliases: ["levels", "exposure", "clipping", "luminance", "niveaux", "exposition", "brûlé"],
    fields: [],
  },
  {
    id: "duplicates",
    title: q("Find duplicates", "Trouver les doublons"),
    summary: q("Spot identical and near-identical photos (bursts, resized copies, edits) by comparing what they show.", "Repérez les photos identiques ou presque (rafales, copies redimensionnées, retouches) en comparant leur contenu."),
    category: "analyze",
    input: "images",
    min: 2,
    report: true,
    aliases: ["similar", "duplicate", "burst", "dedupe", "perceptual hash", "doublon", "similaire", "rafale"],
    fields: [{ name: "threshold", kind: "range", label: q("How similar", "Degré de ressemblance"), min: 50, max: 100, default: 90, unit: "%" }],
  },
  {
    id: "base64",
    title: q("Data URI / Base64", "Data URI / Base64"),
    summary: q("The image as a data: URI or Base64 text, to paste into HTML, CSS or JSON.", "L'image en data: URI ou en texte Base64, à coller dans du HTML, du CSS ou du JSON."),
    category: "analyze",
    input: "image",
    report: true,
    aliases: ["data uri", "embed", "inline", "base 64", "encode", "intégrer"],
    fields: [],
  },
];
