// Reading photo details with exifr, whatever the container: JPEG, PNG,
// HEIC, AVIF and TIFF/RAW directly; WebP, JPEG XL, CR3 and anything else by
// finding the EXIF and XMP blocks and handing exifr a tiny JPEG around them.

import exifr from "exifr";
import type { L } from "../../tools/types.ts";
import { type Format, sniff } from "../formats.ts";
import { type Block, blocks, dimensions, hasIcc, locateExif, locateXmp, xmpHasGps } from "./containers.ts";
import { isoDate } from "./exif-write.ts";
import { appSegment } from "./jpeg.ts";
import type { PhotoMeta } from "./types.ts";

// exifr returns an open record of anything.
type Raw = Record<string, any>;

const enc = new TextEncoder();
const EXIFR_NATIVE = new Set<Format>(["jpeg", "png", "heic", "avif", "tiff"]);

/** A JPEG holding only the EXIF and XMP blocks found in another container. */
function wrapAsJpeg(b: Uint8Array, format: Format | null): Uint8Array | null {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  const exif = locateExif(b, format);
  if (exif && exif.len <= 65527) parts.push(appSegment(0xe1, new Uint8Array([...enc.encode("Exif\0\0"), ...b.subarray(exif.at, exif.at + exif.len)])));
  for (const x of locateXmp(b)) {
    if (x.len <= 65000) parts.push(appSegment(0xe1, new Uint8Array([...enc.encode("http://ns.adobe.com/xap/1.0/\0"), ...b.subarray(x.at, x.at + x.len)])));
  }
  if (parts.length === 1) return null;
  parts.push(new Uint8Array([0xff, 0xd9]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function parse(b: Uint8Array, options: object): Promise<Raw | undefined> {
  const format = sniff(b);
  // silentErrors is a real exifr option missing from its typings.
  const opts = { silentErrors: true, ...options } as Parameters<typeof exifr.parse>[1];
  if (format && EXIFR_NATIVE.has(format)) {
    try {
      const r = await exifr.parse(b, opts);
      if (r && Object.keys(r).some((k) => k !== "errors")) return r;
    } catch {
      // fall through to the wrapped blocks
    }
  }
  const wrapped = wrapAsJpeg(b, format);
  if (!wrapped) return undefined;
  try {
    return await exifr.parse(wrapped, opts);
  } catch {
    return undefined;
  }
}

/** A string out of whatever exifr returns for text ({lang, value}, arrays, numbers). */
function text(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.replace(/\0/g, "").trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ") || undefined;
  if (v instanceof Uint8Array) return undefined;
  if (typeof v === "object" && "value" in (v as object)) return text((v as { value: unknown }).value);
  return undefined;
}

const number = (v: unknown): number | undefined => {
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

function list(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const items = (Array.isArray(v) ? v : [v]).map(text).filter((s): s is string => Boolean(s));
  return items.length ? items : undefined;
}

/** The normalised details of a photo. Never throws: an unreadable file has none. */
export async function readMeta(bytes: Uint8Array): Promise<PhotoMeta> {
  try {
    const r = await parse(bytes, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, ifd1: false, makerNote: false, translateValues: false, reviveValues: false, mergeOutput: true });
    const dims = dimensions(bytes);
    const m: PhotoMeta = dims ? { width: dims.width, height: dims.height } : {};
    if (!r) return m;
    const set = <K extends keyof PhotoMeta>(k: K, v: PhotoMeta[K] | undefined) => {
      if (v !== undefined) m[k] = v;
    };
    set("make", text(r.Make));
    set("model", text(r.Model));
    set("lens", text(r.LensModel) ?? text(r.Lens));
    const xmpDate = typeof r.DateCreated === "string" ? r.DateCreated.slice(0, 19) : undefined;
    set("taken", isoDate(text(r.DateTimeOriginal)) ?? isoDate(text(r.CreateDate)) ?? isoDate(xmpDate) ?? isoDate(text(r.ModifyDate)));
    set("offset", text(r.OffsetTimeOriginal) ?? text(r.OffsetTime));
    set("exposure", number(r.ExposureTime));
    set("fnumber", number(r.FNumber));
    set("iso", number(r.ISO) ?? number(r.ISOSpeedRatings) ?? number(r.PhotographicSensitivity));
    set("focal", number(r.FocalLength));
    set("focal35", number(r.FocalLengthIn35mmFormat));
    if (typeof r.latitude === "number" && typeof r.longitude === "number" && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
      const alt = typeof r.GPSAltitude === "number" ? r.GPSAltitude * ((r.GPSAltitudeRef?.[0] ?? r.GPSAltitudeRef) === 1 ? -1 : 1) : undefined;
      m.gps = alt === undefined ? { lat: r.latitude, lon: r.longitude } : { lat: r.latitude, lon: r.longitude, alt };
    }
    set("artist", text(r.Artist) ?? text(r.creator) ?? text(r.Byline));
    set("copyright", text(r.Copyright) ?? text(r.rights) ?? text(r.CopyrightNotice));
    set("description", text(r.ImageDescription) ?? text(r.description) ?? text(r.Caption));
    set("software", text(r.Software) ?? text(r.CreatorTool));
    const o = number(r.Orientation);
    if (o && o >= 1 && o <= 8) m.orientation = o;
    set("serial", text(r.BodySerialNumber) ?? text(r.SerialNumber) ?? text(r.CameraSerialNumber));
    set("owner", text(r.CameraOwnerName) ?? text(r.OwnerName));
    set("keywords", list(r.subject) ?? list(r.Keywords));
    return m;
  } catch {
    return {};
  }
}

// ── The full report for "See photo details" ─────────────────────────────

export type GroupId = "camera" | "lens" | "settings" | "date" | "location" | "author" | "software" | "image" | "other";

export interface InspectEntry {
  key: string;
  label: L;
  value: string;
}

export interface InspectGroup {
  id: GroupId;
  entries: InspectEntry[];
}

export type RiskCode = "location" | "serial" | "owner" | "timestamp" | "device" | "software" | "thumbnail" | "history";

export interface Risk {
  code: RiskCode;
  level: "high" | "medium" | "low";
}

export interface InspectReport {
  name: string;
  format: Format | null;
  size: number;
  width?: number;
  height?: number;
  icc: boolean;
  /** The normalised details (same as the other tools see). */
  meta: PhotoMeta;
  groups: InspectGroup[];
  gps?: { lat: number; lon: number; alt?: number };
  /** What these details give away, worst first. */
  risks: Risk[];
  /** The file's metadata-relevant blocks and their sizes. */
  blocks: Block[];
}

const q = (en: string, fr: string): L => ({ en, fr });

/** Labels for the tags people look for; anything else shows its tag name. */
const LABELS: Record<string, [GroupId, L]> = {
  Make: ["camera", q("Camera maker", "Fabricant")],
  Model: ["camera", q("Camera model", "Modèle")],
  BodySerialNumber: ["camera", q("Camera serial number", "N° de série du boîtier")],
  SerialNumber: ["camera", q("Serial number", "N° de série")],
  CameraSerialNumber: ["camera", q("Camera serial number", "N° de série du boîtier")],
  CameraOwnerName: ["camera", q("Owner", "Propriétaire")],
  OwnerName: ["camera", q("Owner", "Propriétaire")],
  LensModel: ["lens", q("Lens", "Objectif")],
  LensMake: ["lens", q("Lens maker", "Fabricant de l'objectif")],
  LensInfo: ["lens", q("Lens range", "Plage de l'objectif")],
  Lens: ["lens", q("Lens", "Objectif")],
  LensSerialNumber: ["lens", q("Lens serial number", "N° de série de l'objectif")],
  ExposureTime: ["settings", q("Shutter speed", "Vitesse d'obturation")],
  FNumber: ["settings", q("Aperture", "Ouverture")],
  ISO: ["settings", q("ISO", "ISO")],
  FocalLength: ["settings", q("Focal length", "Focale")],
  FocalLengthIn35mmFormat: ["settings", q("35 mm equivalent", "Équivalent 24×36")],
  ExposureProgram: ["settings", q("Exposure program", "Programme d'exposition")],
  ExposureMode: ["settings", q("Exposure mode", "Mode d'exposition")],
  ExposureCompensation: ["settings", q("Exposure compensation", "Correction d'exposition")],
  MeteringMode: ["settings", q("Metering", "Mesure")],
  Flash: ["settings", q("Flash", "Flash")],
  WhiteBalance: ["settings", q("White balance", "Balance des blancs")],
  DigitalZoomRatio: ["settings", q("Digital zoom", "Zoom numérique")],
  SceneCaptureType: ["settings", q("Scene type", "Type de scène")],
  DateTimeOriginal: ["date", q("Taken", "Prise de vue")],
  CreateDate: ["date", q("Digitised", "Numérisée")],
  ModifyDate: ["date", q("Modified", "Modifiée")],
  OffsetTimeOriginal: ["date", q("Time zone", "Fuseau horaire")],
  OffsetTime: ["date", q("Time zone (modified)", "Fuseau (modification)")],
  DateCreated: ["date", q("Created (XMP)", "Création (XMP)")],
  latitude: ["location", q("Latitude", "Latitude")],
  longitude: ["location", q("Longitude", "Longitude")],
  GPSAltitude: ["location", q("Altitude", "Altitude")],
  GPSImgDirection: ["location", q("Facing", "Orientation de la prise")],
  GPSDateStamp: ["location", q("GPS date", "Date GPS")],
  City: ["location", q("City", "Ville")],
  Country: ["location", q("Country", "Pays")],
  State: ["location", q("Region", "Région")],
  Artist: ["author", q("Author", "Auteur")],
  creator: ["author", q("Author (XMP)", "Auteur (XMP)")],
  Byline: ["author", q("Author (IPTC)", "Auteur (IPTC)")],
  Copyright: ["author", q("Copyright", "Copyright")],
  rights: ["author", q("Rights (XMP)", "Droits (XMP)")],
  CopyrightNotice: ["author", q("Copyright (IPTC)", "Copyright (IPTC)")],
  ImageDescription: ["author", q("Description", "Description")],
  description: ["author", q("Description (XMP)", "Description (XMP)")],
  title: ["author", q("Title", "Titre")],
  subject: ["author", q("Keywords", "Mots-clés")],
  Keywords: ["author", q("Keywords (IPTC)", "Mots-clés (IPTC)")],
  Caption: ["author", q("Caption (IPTC)", "Légende (IPTC)")],
  UserComment: ["author", q("Comment", "Commentaire")],
  Software: ["software", q("Software", "Logiciel")],
  CreatorTool: ["software", q("Edited with", "Retouchée avec")],
  HostComputer: ["software", q("Computer", "Ordinateur")],
  ImageWidth: ["image", q("Width", "Largeur")],
  ImageHeight: ["image", q("Height", "Hauteur")],
  PixelXDimension: ["image", q("Width (EXIF)", "Largeur (EXIF)")],
  PixelYDimension: ["image", q("Height (EXIF)", "Hauteur (EXIF)")],
  Orientation: ["image", q("Orientation", "Orientation")],
  ColorSpace: ["image", q("Colour space", "Espace colorimétrique")],
  ProfileDescription: ["image", q("Colour profile", "Profil couleur")],
  XResolution: ["image", q("Horizontal resolution", "Résolution horizontale")],
  YResolution: ["image", q("Vertical resolution", "Résolution verticale")],
  BitDepth: ["image", q("Bit depth", "Profondeur")],
};

/** Which group a tag from a given exifr block goes in, when it has no label. */
const BLOCK_GROUP: Record<string, GroupId> = { gps: "location", ifd0: "other", exif: "settings", ifd1: "image", icc: "image", ihdr: "image", jfif: "image", iptc: "author", xmpMM: "software", photoshop: "author", dc: "author", xmp: "software", tiff: "image" };

const SKIP = new Set(["errors", "MakerNote", "thumbnail", "ThumbnailOffset", "ThumbnailLength", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef", "GPSAltitudeRef", "GPSVersionID", "ExifVersion", "FlashpixVersion", "InteropIndex", "InteropVersion", "ComponentsConfiguration", "PrintIM"]);

const spaced = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

function show(key: string, v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (key === "ExposureTime" && typeof v === "number") return v >= 1 ? `${+v.toFixed(1)} s` : `1/${Math.round(1 / v)} s`;
  if (key === "FNumber" && typeof v === "number") return `f/${+v.toFixed(1)}`;
  if ((key === "FocalLength" || key === "FocalLengthIn35mmFormat") && typeof v === "number") return `${+v.toFixed(1)} mm`;
  if ((key === "latitude" || key === "longitude") && typeof v === "number") return v.toFixed(6);
  if (key === "GPSAltitude" && typeof v === "number") return `${+v.toFixed(1)} m`;
  if (v instanceof Uint8Array) return v.length <= 8 ? [...v].join(".") : `${v.length} bytes`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
  if (typeof v === "string") return v.replace(/\0/g, "").trim() || null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    const parts = v.map((x) => show(key, x)).filter((x): x is string => x !== null);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object") {
    if ("value" in (v as object)) return show(key, (v as { value: unknown }).value);
    const parts = Object.entries(v as object)
      .map(([k, x]) => {
        const f = show(k, x);
        return f === null ? null : `${k}: ${f}`;
      })
      .filter(Boolean);
    return parts.length ? parts.join("; ").slice(0, 500) : null;
  }
  return null;
}

const ORDER: GroupId[] = ["camera", "lens", "settings", "date", "location", "author", "software", "image", "other"];

/** Everything the file says about itself, grouped, with what it reveals. */
export async function inspect(bytes: Uint8Array, name: string): Promise<InspectReport> {
  const format = sniff(bytes, name);
  const meta = await readMeta(bytes);
  const fileBlocks = blocks(bytes);
  const raw = (await parse(bytes, { tiff: true, exif: true, gps: true, interop: false, ifd1: true, xmp: true, iptc: true, icc: true, jfif: false, ihdr: true, makerNote: false, userComment: true, translateValues: true, reviveValues: false, mergeOutput: false })) ?? {};
  const groups = new Map<GroupId, InspectEntry[]>(ORDER.map((g) => [g, []]));
  const seen = new Set<string>();
  let thumbnail = false;
  let history = false;
  let xmpLocation = false;
  for (const [block, values] of Object.entries(raw)) {
    if (!values || typeof values !== "object" || block === "errors") continue;
    if (block === "ifd1" && ("ThumbnailLength" in values || "ThumbnailOffset" in values || "JPEGInterchangeFormat" in values)) thumbnail = true;
    if (block === "xmpMM" && ("History" in values || "DerivedFrom" in values)) history = true;
    if (block === "photoshop" && "DocumentAncestors" in values) history = true;
    for (const [key, v] of Object.entries(values as Raw)) {
      if (SKIP.has(key) || seen.has(key) || (block === "ifd1" && !LABELS[key])) continue;
      if ((block === "photoshop" || block === "Iptc4xmpCore" || block === "iptc") && /^(City|Country|State|Location|Sublocation|ProvinceState)/.test(key)) xmpLocation = true;
      const f = show(key, v);
      if (f === null) continue;
      seen.add(key);
      const [group, label] = LABELS[key] ?? [BLOCK_GROUP[block] ?? "other", q(spaced(key), spaced(key))];
      groups.get(group)!.push({ key, label, value: f });
    }
  }
  const xmpText = locateXmp(bytes)
    .map((x) => new TextDecoder("latin1").decode(bytes.subarray(x.at, x.at + x.len)))
    .join("");
  if (xmpText && xmpHasGps(xmpText)) xmpLocation = true;
  if (/xmpMM:History|stEvt:action/.test(xmpText)) history = true;

  const risks: Risk[] = [];
  if (meta.gps || xmpLocation) risks.push({ code: "location", level: "high" });
  if (meta.serial || seen.has("LensSerialNumber")) risks.push({ code: "serial", level: "medium" });
  if (meta.owner) risks.push({ code: "owner", level: "medium" });
  if (thumbnail) risks.push({ code: "thumbnail", level: "medium" });
  if (meta.taken) risks.push({ code: "timestamp", level: "low" });
  if (meta.make || meta.model) risks.push({ code: "device", level: "low" });
  if (meta.software || seen.has("HostComputer")) risks.push({ code: "software", level: "low" });
  if (history) risks.push({ code: "history", level: "low" });

  return {
    name,
    format,
    size: bytes.length,
    width: meta.width,
    height: meta.height,
    icc: hasIcc(bytes),
    meta,
    groups: ORDER.map((id) => ({ id, entries: groups.get(id)! })).filter((g) => g.entries.length),
    gps: meta.gps,
    risks,
    blocks: fileBlocks,
  };
}
