// The shape of a tool, shared by the interface (which shows its fields) and
// the worker (which runs it). Definitions are light: no codec is imported here.

/** A string in every language the interface speaks. */
export interface L {
  en: string;
  fr: string;
}

export type Category = "optimize" | "transform" | "adjust" | "brand" | "metadata" | "compose" | "analyze" | "ai";

export const CATEGORIES: { id: Category; title: L }[] = [
  { id: "optimize", title: { en: "Compress and convert", fr: "Compresser et convertir" } },
  { id: "transform", title: { en: "Resize and crop", fr: "Redimensionner et recadrer" } },
  { id: "adjust", title: { en: "Adjust and filters", fr: "Réglages et filtres" } },
  { id: "brand", title: { en: "Watermark and redact", fr: "Filigrane et masquage" } },
  { id: "metadata", title: { en: "Metadata and names", fr: "Métadonnées et noms" } },
  { id: "compose", title: { en: "Combine", fr: "Assembler" } },
  { id: "analyze", title: { en: "Analyze", fr: "Analyser" } },
  { id: "ai", title: { en: "AI on your device", fr: "IA sur votre appareil" } },
];

interface FieldBase {
  name: string;
  label: L;
  help?: L;
  /** Shown only when another field has one of these values. */
  when?: { field: string; is: (string | number | boolean)[] };
  /** Folded under "More options". */
  advanced?: boolean;
}

export type Field =
  | (FieldBase & { kind: "select"; choices: { value: string; label: L }[]; default: string })
  | (FieldBase & { kind: "number"; min: number; max: number; step?: number; default?: number; unit?: string; placeholder?: L })
  | (FieldBase & { kind: "range"; min: number; max: number; step?: number; default: number; unit?: string })
  | (FieldBase & { kind: "text" | "textarea"; default?: string; placeholder?: L; required?: boolean })
  | (FieldBase & { kind: "color"; default: string })
  | (FieldBase & { kind: "boolean"; default: boolean })
  /** A file the user picks for this run (a logo, a .cube LUT); its bytes arrive as an option. */
  | (FieldBase & { kind: "file"; accept: string; required?: boolean });

export type OptionValue = string | number | boolean | Uint8Array | undefined;
export type Options = Record<string, OptionValue>;

export interface ToolDef {
  id: string;
  title: L;
  summary: L;
  category: Category;
  /** "image": runs once per photo. "images": one run over all of them (collage, GIF, PDF…). */
  input: "image" | "images";
  /** Fewest photos the tool needs (for "images"). */
  min?: number;
  fields: Field[];
  /** Search words, any language. */
  aliases?: string[];
  /** Per-photo pixel step that can be chained in a recipe and previewed live. */
  step?: boolean;
  /** The tool also writes the output format/quality/metadata fields. */
  output?: boolean;
  /** Needs an on-device model, downloaded on first use. */
  model?: string;
  /** Opens an interactive editor instead of a form. */
  editor?: "crop" | "redact" | "erase" | "edit";
  /** Shows a report (palette, metadata…) rather than, or as well as, files. */
  report?: boolean;
}

export function withDefaults(def: ToolDef, o: Options): Options {
  const out: Options = { ...o };
  for (const f of [...def.fields, ...(def.output ? OUTPUT_FIELDS : [])]) {
    if (out[f.name] === undefined && "default" in f && f.default !== undefined) out[f.name] = f.default;
  }
  return out;
}

const q = (en: string, fr: string): L => ({ en, fr });

/** What every pixel tool asks about the file it writes. */
export const OUTPUT_FIELDS: Field[] = [
  {
    name: "format",
    kind: "select",
    label: q("Save as", "Enregistrer en"),
    default: "keep",
    advanced: true,
    choices: [
      { value: "keep", label: q("Same format", "Même format") },
      { value: "jpeg", label: q("JPEG", "JPEG") },
      { value: "png", label: q("PNG", "PNG") },
      { value: "webp", label: q("WebP", "WebP") },
      { value: "avif", label: q("AVIF", "AVIF") },
      { value: "jxl", label: q("JPEG XL", "JPEG XL") },
    ],
  },
  { name: "quality", kind: "range", label: q("Quality", "Qualité"), min: 1, max: 100, default: 85, advanced: true, when: { field: "format", is: ["keep", "jpeg", "webp", "avif", "jxl"] } },
  {
    name: "metadata",
    kind: "select",
    label: q("Photo details (EXIF)", "Infos de la photo (EXIF)"),
    default: "no-gps",
    advanced: true,
    help: q("Camera, date and location stored in the file.", "Appareil, date et position enregistrés dans le fichier."),
    choices: [
      { value: "no-gps", label: q("Keep, without location", "Garder, sans la position") },
      { value: "keep", label: q("Keep everything", "Tout garder") },
      { value: "strip", label: q("Remove all", "Tout retirer") },
    ],
  },
];
