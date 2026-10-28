// What a file is, from its first bytes, and what can be done with each format.

export type Format = "jpeg" | "png" | "webp" | "avif" | "jxl" | "gif" | "bmp" | "tiff" | "heic" | "raw" | "svg" | "qoi" | "ico";
export type OutFormat = "jpeg" | "png" | "webp" | "avif" | "jxl" | "gif" | "bmp" | "tiff" | "ico" | "qoi";

export interface FormatInfo {
  label: string;
  ext: string;
  mime: string;
  /** Lossy quality setting applies. */
  lossy?: boolean;
  /** Keeps transparency. */
  alpha: boolean;
}

export const FORMATS: Record<Format, FormatInfo> = {
  jpeg: { label: "JPEG", ext: "jpg", mime: "image/jpeg", lossy: true, alpha: false },
  png: { label: "PNG", ext: "png", mime: "image/png", alpha: true },
  webp: { label: "WebP", ext: "webp", mime: "image/webp", lossy: true, alpha: true },
  avif: { label: "AVIF", ext: "avif", mime: "image/avif", lossy: true, alpha: true },
  jxl: { label: "JPEG XL", ext: "jxl", mime: "image/jxl", lossy: true, alpha: true },
  gif: { label: "GIF", ext: "gif", mime: "image/gif", alpha: true },
  bmp: { label: "BMP", ext: "bmp", mime: "image/bmp", alpha: false },
  tiff: { label: "TIFF", ext: "tif", mime: "image/tiff", alpha: true },
  heic: { label: "HEIC", ext: "heic", mime: "image/heic", alpha: true },
  raw: { label: "RAW", ext: "dng", mime: "image/x-raw", alpha: false },
  svg: { label: "SVG", ext: "svg", mime: "image/svg+xml", alpha: true },
  qoi: { label: "QOI", ext: "qoi", mime: "image/qoi", alpha: true },
  ico: { label: "ICO", ext: "ico", mime: "image/x-icon", alpha: true },
};

export const OUT_FORMATS: OutFormat[] = ["jpeg", "png", "webp", "avif", "jxl", "gif", "bmp", "tiff", "ico", "qoi"];

const RAW_EXT = /^(dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|iiq|rwl)$/;

const has = (b: Uint8Array, at: number, ascii: string) => [...ascii].every((c, i) => b[at + i] === c.charCodeAt(0));

/** The format of these bytes, or null. The file name only breaks ties (TIFF vs RAW). */
export function sniff(b: Uint8Array, name = ""): Format | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (has(b, 0, "\x89PNG\r\n\x1a\n")) return "png";
  if (has(b, 0, "RIFF") && has(b, 8, "WEBP")) return "webp";
  if (has(b, 0, "GIF87a") || has(b, 0, "GIF89a")) return "gif";
  if (has(b, 0, "BM") && b.length > 26) return "bmp";
  if (has(b, 0, "qoif")) return "qoi";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "ico";
  if ((b[0] === 0xff && b[1] === 0x0a) || has(b, 0, "\0\0\0\x0cJXL \r\n\x87\n")) return "jxl";
  if (has(b, 4, "ftyp")) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (/^avi[fs]$/.test(brand)) return "avif";
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
    if (brand === "crx ") return "raw";
  }
  if (has(b, 0, "II*\0") || has(b, 0, "MM\0*")) return RAW_EXT.test(ext) ? "raw" : "tiff";
  // Olympus ORF, Panasonic RW2 and Fujifilm RAF use their own magic.
  if (has(b, 0, "IIRO") || has(b, 0, "IIRS") || has(b, 0, "IIU\0") || has(b, 0, "FUJIFILMCCD-RAW")) return "raw";
  const head = new TextDecoder().decode(b.subarray(0, 1024)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head) || (ext === "svg" && head.includes("<svg"))) return "svg";
  return null;
}

/** "photo.HEIC" + "jpeg" → "photo.jpg". */
export function rename(name: string, ext: string, suffix = ""): string {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}${suffix ? `-${suffix}` : ""}.${ext}`;
}
