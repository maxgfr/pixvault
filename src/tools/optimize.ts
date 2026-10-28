import { OUTPUT_FIELDS, type ToolDef } from "./types.ts";

const metadataField = OUTPUT_FIELDS.find((f) => f.name === "metadata")!;

export const optimizeTools: ToolDef[] = [
  {
    id: "compress",
    title: { en: "Compress", fr: "Compresser" },
    summary: { en: "Make photos lighter with the best modern encoders. Never returns a bigger file.", fr: "Allégez vos photos avec les meilleurs encodeurs actuels. Jamais de fichier plus lourd." },
    category: "optimize",
    input: "image",
    aliases: ["optimize", "shrink", "reduce", "size", "kb", "mozjpeg", "oxipng", "optimiser", "réduire", "poids", "alléger"],
    fields: [
      {
        name: "mode",
        kind: "select",
        label: { en: "Aim for", fr: "Objectif" },
        default: "quality",
        choices: [
          { value: "quality", label: { en: "A quality level", fr: "Un niveau de qualité" } },
          { value: "size", label: { en: "A maximum file size", fr: "Un poids maximum" } },
          { value: "lossless", label: { en: "Lossless (pixels unchanged)", fr: "Sans perte (pixels identiques)" } },
        ],
      },
      { name: "quality", kind: "range", label: { en: "Quality", fr: "Qualité" }, min: 10, max: 100, default: 78, when: { field: "mode", is: ["quality"] } },
      { name: "targetKb", kind: "number", label: { en: "Maximum size", fr: "Poids maximum" }, min: 5, max: 100000, step: 5, default: 300, unit: "KB", when: { field: "mode", is: ["size"] } },
      {
        name: "format",
        kind: "select",
        label: { en: "Format", fr: "Format" },
        default: "keep",
        choices: [
          { value: "keep", label: { en: "Same as the original", fr: "Celui d'origine" } },
          { value: "auto", label: { en: "Smallest of WebP, AVIF and JPEG", fr: "Le plus léger entre WebP, AVIF et JPEG" } },
          { value: "jpeg", label: { en: "JPEG (MozJPEG)", fr: "JPEG (MozJPEG)" } },
          { value: "webp", label: { en: "WebP", fr: "WebP" } },
          { value: "avif", label: { en: "AVIF", fr: "AVIF" } },
          { value: "jxl", label: { en: "JPEG XL", fr: "JPEG XL" } },
          { value: "png", label: { en: "PNG (OxiPNG)", fr: "PNG (OxiPNG)" } },
        ],
      },
      { name: "maxSide", kind: "number", label: { en: "Also shrink to at most", fr: "Réduire aussi à au plus" }, min: 16, max: 20000, unit: "px", advanced: true, placeholder: { en: "Keep size", fr: "Taille d'origine" } },
      { name: "colors", kind: "number", label: { en: "PNG colours (palette)", fr: "Couleurs PNG (palette)" }, min: 2, max: 256, advanced: true, help: { en: "Fewer colours, much smaller PNGs. Leave empty for full colour.", fr: "Moins de couleurs, des PNG bien plus légers. Vide = toutes les couleurs." }, placeholder: { en: "Full colour", fr: "Toutes" } },
      { name: "effort", kind: "range", label: { en: "Encoder effort", fr: "Effort de l'encodeur" }, min: 0, max: 9, default: 4, advanced: true, help: { en: "Higher is slower and slightly smaller.", fr: "Plus haut : plus lent et un peu plus léger." } },
      metadataField,
    ],
  },
  {
    id: "convert",
    title: { en: "Convert", fr: "Convertir" },
    summary: { en: "HEIC, RAW, AVIF, WebP, JPEG XL, TIFF, SVG… to JPEG, PNG, WebP, AVIF, JPEG XL, GIF, TIFF, BMP, ICO or PDF.", fr: "HEIC, RAW, AVIF, WebP, JPEG XL, TIFF, SVG… vers JPEG, PNG, WebP, AVIF, JPEG XL, GIF, TIFF, BMP, ICO ou PDF." },
    category: "optimize",
    input: "image",
    aliases: ["heic", "heif", "iphone", "raw", "dng", "cr2", "nef", "arw", "svg", "tiff", "jpg", "png", "webp", "avif", "jxl", "change format", "format", "convertir", "transformer"],
    fields: [
      {
        name: "to",
        kind: "select",
        label: { en: "Convert to", fr: "Convertir en" },
        default: "jpeg",
        choices: [
          { value: "jpeg", label: { en: "JPEG", fr: "JPEG" } },
          { value: "png", label: { en: "PNG", fr: "PNG" } },
          { value: "webp", label: { en: "WebP", fr: "WebP" } },
          { value: "avif", label: { en: "AVIF", fr: "AVIF" } },
          { value: "jxl", label: { en: "JPEG XL", fr: "JPEG XL" } },
          { value: "gif", label: { en: "GIF", fr: "GIF" } },
          { value: "tiff", label: { en: "TIFF", fr: "TIFF" } },
          { value: "bmp", label: { en: "BMP", fr: "BMP" } },
          { value: "ico", label: { en: "ICO (icon)", fr: "ICO (icône)" } },
          { value: "qoi", label: { en: "QOI", fr: "QOI" } },
          { value: "pdf", label: { en: "PDF (one per photo)", fr: "PDF (un par photo)" } },
        ],
      },
      { name: "quality", kind: "range", label: { en: "Quality", fr: "Qualité" }, min: 1, max: 100, default: 88, when: { field: "to", is: ["jpeg", "webp", "avif", "jxl", "pdf"] } },
      { name: "lossless", kind: "boolean", label: { en: "Lossless", fr: "Sans perte" }, default: false, when: { field: "to", is: ["webp", "avif", "jxl"] } },
      { name: "background", kind: "color", label: { en: "Background for transparency", fr: "Fond sous la transparence" }, default: "#ffffff", advanced: true, when: { field: "to", is: ["jpeg", "bmp", "pdf"] } },
      metadataField,
    ],
  },
];
