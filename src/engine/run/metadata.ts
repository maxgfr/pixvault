// metadata tools: implementations, looked up by tool id.
// See photo details, remove them, edit dates and credits, rename a batch.
// None of them re-encodes: the image data stays byte for byte the same.

import { DecodeError } from "../errors.ts";
import { FORMATS, sniff } from "../formats.ts";
import { dimensions, locateExif, REWRITABLE, setMeta, strip, type StripMode } from "../meta/containers.ts";
import { applyMeta, ascii, emptyDoc, exifDate, find, isoDate, parseTiff, put, readAscii, serializeTiff, TAG, type TiffDoc } from "../meta/exif-write.ts";
import { inspect, readMeta } from "../meta/read.ts";
import { cameraName } from "../meta/types.ts";
import { num, type Output, type RunFn, type StepFn, str } from "./types.ts";

export const steps: Record<string, StepFn> = {};

const mimeOf = (b: Uint8Array, name: string) => {
  const f = sniff(b, name);
  return f ? FORMATS[f].mime : "application/octet-stream";
};

export interface StripReport {
  before: number;
  after: number;
  /** What was removed: "gps", "serial", "owner", "maker-note", "exif", "xmp", "iptc", "comment", "thumbnail", "details", "app", "text", "time". */
  removed: string[];
}

export interface EditReport {
  /** The date taken after the change, "YYYY-MM-DDTHH:MM:SS". */
  taken?: string;
  changed: string[];
}

/** "2024-07-14 18:30", "2024:07:14 18:30:05", "2024-07-14T18:30" → ISO local time. */
export function parseDate(s: string): string | undefined {
  const m = /^\s*(\d{4})[-:/](\d{1,2})[-:/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s);
  if (!m) return undefined;
  const p = (v: string | undefined, d = "00") => (v ?? d).padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}`;
}

/** Shift an ISO local time by hours (may be fractional), calendar-correct. */
export function shiftDate(iso: string, hours: number): string {
  const [d, t] = iso.split("T");
  const [y, mo, da] = d!.split("-").map(Number);
  const [h, mi, se] = t!.split(":").map(Number);
  const ms = Date.UTC(y!, mo! - 1, da!, h!, mi!, se!) + Math.round(hours * 3600) * 1000;
  return new Date(ms).toISOString().slice(0, 19);
}

function editDoc(doc: TiffDoc, o: Record<string, unknown>, changed: string[]): string | undefined {
  const current = isoDate(readAscii(find(doc.exif, TAG.DateTimeOriginal))) ?? isoDate(readAscii(find(doc.exif, TAG.DateTimeDigitized))) ?? isoDate(readAscii(find(doc.ifd0, TAG.DateTime)));
  let taken = current;
  const set = str(o.date).trim();
  if (set) {
    const parsed = parseDate(set);
    if (!parsed) throw new DecodeError(`“${set}” is not a date (expected 2024-07-14 18:30)`, "bad-options");
    taken = parsed;
  }
  const shift = num(o.shift, 0);
  if (shift) {
    if (!taken) throw new DecodeError("this photo has no date to shift", "bad-options");
    taken = shiftDate(taken, shift);
  }
  if (taken && taken !== current) {
    // Only the dates that exist move (plus DateTimeOriginal), so "modified" stays meaningful when it differs.
    const d = exifDate(taken);
    put(doc.exif, ascii(TAG.DateTimeOriginal, d));
    if (find(doc.exif, TAG.DateTimeDigitized) || !current) put(doc.exif, ascii(TAG.DateTimeDigitized, d));
    if (find(doc.ifd0, TAG.DateTime) || !current) put(doc.ifd0, ascii(TAG.DateTime, d));
    changed.push("date");
  }
  for (const [field, tag] of [
    ["artist", TAG.Artist],
    ["copyright", TAG.Copyright],
    ["description", TAG.ImageDescription],
  ] as const) {
    const v = str(o[field]).trim();
    if (v && v !== readAscii(find(doc.ifd0, tag))) {
      applyMeta(doc, { [field]: v });
      changed.push(field);
    }
  }
  return taken;
}

const SLUG_DROP = /\p{M}/gu;
// Characters no file system accepts in a name, and control characters.
const UNSAFE = /[/\\:*?"<>|]|\p{Cc}/gu;

function caseOf(s: string, mode: string): string {
  if (mode === "lower") return s.toLowerCase();
  if (mode === "slug")
    return s
      .normalize("NFKD")
      .replace(SLUG_DROP, "")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  return s;
}

/** Fill a rename pattern for one photo. */
export function fillPattern(pattern: string, t: { n: string; name: string; date: string; time: string; camera: string; w: string; h: string; ext: string }): string {
  return pattern.replace(/\{(n|name|date|time|camera|w|h|ext)\}/g, (_, k: keyof typeof t) => t[k]);
}

export const runs: Record<string, RunFn> = {
  async inspect(inputs) {
    const input = inputs[0];
    if (!input) return { files: [] };
    return { files: [], report: await inspect(input.bytes, input.name) };
  },

  async strip(inputs, o, ctx) {
    const mode = (str(o.remove, "all") as StripMode) || "all";
    const files: Output[] = [];
    const reports: StripReport[] = [];
    for (const [i, input] of inputs.entries()) {
      ctx.progress(i, inputs.length, input.name);
      const orientation = mode === "all" ? ((await readMeta(input.bytes)).orientation ?? 1) : 1;
      const r = strip(input.bytes, mode, orientation);
      files.push({ name: input.name, bytes: r.bytes, mime: mimeOf(r.bytes, input.name) });
      reports.push({ before: input.bytes.length, after: r.bytes.length, removed: r.removed });
    }
    return { files, report: reports.length === 1 ? reports[0] : reports };
  },

  async "edit-meta"(inputs, o, ctx) {
    const files: Output[] = [];
    const reports: EditReport[] = [];
    for (const [i, input] of inputs.entries()) {
      ctx.progress(i, inputs.length, input.name);
      const format = sniff(input.bytes, input.name);
      if (!format || !REWRITABLE.has(format)) {
        throw new DecodeError(`dates and credits can be changed in JPEG, PNG and WebP files; convert this ${format ? FORMATS[format].label : ""} photo first`.replace("  ", " "), "unsupported");
      }
      const loc = locateExif(input.bytes, format);
      const doc = (loc && parseTiff(input.bytes.subarray(loc.at, loc.at + loc.len))) || emptyDoc(true);
      const changed: string[] = [];
      const taken = editDoc(doc, o, changed);
      const bytes = changed.length ? setMeta(input.bytes, { exif: serializeTiff(doc) }) : input.bytes;
      files.push({ name: input.name, bytes, mime: FORMATS[format].mime });
      reports.push({ taken, changed });
    }
    return { files, report: reports.length === 1 ? reports[0] : reports };
  },

  async rename(inputs, o, ctx) {
    const pattern = str(o.pattern, "{date}-{n}").trim() || "{n}";
    const start = Math.max(0, Math.round(num(o.start, 1)));
    const digits = Math.max(1, Math.min(8, Math.round(num(o.digits, 3))));
    const order = str(o.order, "list");
    const caseMode = str(o.case, "keep");
    const items = await Promise.all(
      inputs.map(async (input, index) => {
        const meta = await readMeta(input.bytes);
        const dims = meta.width && meta.height ? { width: meta.width, height: meta.height } : dimensions(input.bytes);
        return { input, index, meta, dims };
      }),
    );
    if (order === "date") items.sort((a, b) => (a.meta.taken ?? "\uffff").localeCompare(b.meta.taken ?? "\uffff") || a.index - b.index);
    else if (order === "name") items.sort((a, b) => a.input.name.localeCompare(b.input.name, undefined, { numeric: true }) || a.index - b.index);
    const used = new Map<string, number>();
    const files: Output[] = [];
    const renames: { from: string; to: string }[] = [];
    for (const [i, item] of items.entries()) {
      ctx.progress(i, items.length, item.input.name);
      const dot = item.input.name.lastIndexOf(".");
      const base = dot > 0 ? item.input.name.slice(0, dot) : item.input.name;
      const ext = dot > 0 ? item.input.name.slice(dot + 1) : (FORMATS[sniff(item.input.bytes) ?? "png"]?.ext ?? "img");
      const taken = item.meta.taken;
      let stem = fillPattern(pattern, {
        n: String(start + i).padStart(digits, "0"),
        name: base,
        date: taken?.slice(0, 10) ?? "",
        time: taken ? taken.slice(11, 19).replace(/:/g, "-") : "",
        camera: cameraName(item.meta),
        w: item.dims ? String(item.dims.width) : "",
        h: item.dims ? String(item.dims.height) : "",
        ext,
      })
        .replace(UNSAFE, "-")
        .trim()
        .replace(/^[-_ .]+|[-_ ]+$/g, "");
      stem = caseOf(stem, caseMode) || String(start + i).padStart(digits, "0");
      const finalExt = caseMode === "keep" ? ext : ext.toLowerCase();
      let name = `${stem}.${finalExt}`;
      const key = name.toLowerCase();
      const seen = used.get(key) ?? 0;
      used.set(key, seen + 1);
      if (seen) {
        name = `${stem}-${seen + 1}.${finalExt}`;
        used.set(name.toLowerCase(), 1);
      }
      files.push({ name, bytes: item.input.bytes, mime: mimeOf(item.input.bytes, item.input.name) });
      renames.push({ from: item.input.name, to: name });
    }
    return { files, report: { renames } };
  },
};
