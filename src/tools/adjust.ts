import type { L, ToolDef } from "./types.ts";

const q = (en: string, fr: string): L => ({ en, fr });
const slider = (name: string, label: L, min = -100, max = 100, def = 0, advanced = false) => ({ name, kind: "range" as const, label, min, max, default: def, advanced });

export const FILTERS: { value: string; label: L }[] = [
  { value: "bw", label: q("Black and white", "Noir et blanc") },
  { value: "noir", label: q("Noir (high contrast)", "Noir (contrasté)") },
  { value: "sepia", label: q("Sepia", "Sépia") },
  { value: "vintage", label: q("Vintage", "Vintage") },
  { value: "fade", label: q("Faded film", "Pellicule passée") },
  { value: "warm", label: q("Warm", "Chaud") },
  { value: "cool", label: q("Cool", "Froid") },
  { value: "vivid", label: q("Vivid", "Éclatant") },
  { value: "matte", label: q("Matte", "Mat") },
  { value: "duotone", label: q("Duotone", "Bichromie") },
  { value: "invert", label: q("Negative", "Négatif") },
  { value: "posterize", label: q("Posterize", "Postériser") },
];

export const adjustTools: ToolDef[] = [
  {
    id: "adjust",
    title: q("Adjust light and colour", "Lumière et couleurs"),
    summary: q("Exposure, contrast, highlights, shadows, white balance, saturation, sharpness, vignette, with a live preview.", "Exposition, contraste, hautes lumières, ombres, balance des blancs, saturation, netteté, vignette, avec aperçu en direct."),
    category: "adjust",
    input: "image",
    step: true,
    output: true,
    editor: "edit",
    aliases: ["brightness", "exposure", "contrast", "saturation", "white balance", "temperature", "sharpen", "blur", "vignette", "edit", "retouch", "luminosité", "netteté", "retouche"],
    fields: [
      slider("exposure", q("Exposure", "Exposition")),
      slider("contrast", q("Contrast", "Contraste")),
      slider("highlights", q("Highlights", "Hautes lumières")),
      slider("shadows", q("Shadows", "Ombres")),
      slider("temperature", q("Temperature", "Température")),
      slider("tint", q("Tint", "Teinte")),
      slider("saturation", q("Saturation", "Saturation")),
      slider("vibrance", q("Vibrance", "Vibrance")),
      slider("sharpness", q("Sharpness", "Netteté"), 0, 100),
      slider("blur", q("Blur", "Flou"), 0, 100, 0, true),
      slider("vignette", q("Vignette", "Vignette"), -100, 100, 0, true),
      slider("grain", q("Film grain", "Grain"), 0, 100, 0, true),
    ],
  },
  {
    id: "auto-enhance",
    title: q("Auto enhance", "Amélioration auto"),
    summary: q("Levels, contrast and white balance corrected photo by photo, in one click for a whole batch.", "Niveaux, contraste et balance des blancs corrigés photo par photo, en un clic pour tout un lot."),
    category: "adjust",
    input: "image",
    step: true,
    output: true,
    aliases: ["auto", "levels", "fix", "magic", "white balance", "niveaux", "corriger", "magique"],
    fields: [
      { name: "strength", kind: "range", label: q("Strength", "Intensité"), min: 0, max: 100, default: 70, unit: "%" },
      { name: "whiteBalance", kind: "boolean", label: q("Correct the white balance", "Corriger la balance des blancs"), default: true },
    ],
  },
  {
    id: "filter",
    title: q("Filters", "Filtres"),
    summary: q("Black and white, sepia, vintage, film, duotone and more, with adjustable strength.", "Noir et blanc, sépia, vintage, pellicule, bichromie et plus, à l'intensité réglable."),
    category: "adjust",
    input: "image",
    step: true,
    output: true,
    aliases: ["black and white", "grayscale", "monochrome", "sepia", "vintage", "effect", "noir et blanc", "effet", "gris"],
    fields: [
      { name: "filter", kind: "select", label: q("Filter", "Filtre"), default: "bw", choices: FILTERS },
      { name: "strength", kind: "range", label: q("Strength", "Intensité"), min: 0, max: 100, default: 100, unit: "%" },
      { name: "dark", kind: "color", label: q("Shadow colour", "Couleur des ombres"), default: "#1b1f3b", when: { field: "filter", is: ["duotone"] } },
      { name: "light", kind: "color", label: q("Highlight colour", "Couleur des lumières"), default: "#ffcf8a", when: { field: "filter", is: ["duotone"] } },
      { name: "levels", kind: "number", label: q("Levels per channel", "Niveaux par canal"), min: 2, max: 16, default: 4, when: { field: "filter", is: ["posterize"] } },
    ],
  },
  {
    id: "lut",
    title: q("Apply a LUT", "Appliquer une LUT"),
    summary: q("Colour grade with any .cube 3D LUT, the format used by Lightroom, Premiere and DaVinci.", "Étalonnez avec n'importe quelle LUT 3D .cube, le format de Lightroom, Premiere et DaVinci."),
    category: "adjust",
    input: "image",
    step: true,
    output: true,
    aliases: ["cube", "grade", "grading", "color grading", "preset", "étalonnage", "look"],
    fields: [
      { name: "cube", kind: "file", label: q(".cube file", "Fichier .cube"), accept: ".cube,text/plain", required: true },
      { name: "strength", kind: "range", label: q("Strength", "Intensité"), min: 0, max: 100, default: 100, unit: "%" },
    ],
  },
];
