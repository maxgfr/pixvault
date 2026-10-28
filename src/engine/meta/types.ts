// Photo details normalised from EXIF/XMP/IPTC, whatever the container.

export interface PhotoMeta {
  make?: string;
  model?: string;
  lens?: string;
  /** Local time the photo was taken, "YYYY-MM-DDTHH:MM:SS" (no zone). */
  taken?: string;
  /** "+02:00" when the camera recorded it. */
  offset?: string;
  exposure?: number;
  fnumber?: number;
  iso?: number;
  focal?: number;
  focal35?: number;
  gps?: { lat: number; lon: number; alt?: number };
  artist?: string;
  copyright?: string;
  description?: string;
  software?: string;
  orientation?: number;
  serial?: string;
  owner?: string;
  keywords?: string[];
  width?: number;
  height?: number;
}

/** "Canon EOS R6" without repeating the make ("Canon Canon EOS R6"). */
export function cameraName(m: PhotoMeta): string {
  const make = m.make?.trim() ?? "";
  const model = m.model?.trim() ?? "";
  if (!make) return model;
  if (!model) return make;
  return model.toLowerCase().startsWith(make.split(" ")[0]!.toLowerCase()) ? model : `${make} ${model}`;
}

/** "f/2.8 · 1/250 s · ISO 400 · 35 mm". */
export function settingsLine(m: PhotoMeta): string {
  const parts: string[] = [];
  if (m.fnumber) parts.push(`f/${+m.fnumber.toFixed(1)}`);
  if (m.exposure) parts.push(m.exposure >= 1 ? `${+m.exposure.toFixed(1)} s` : `1/${Math.round(1 / m.exposure)} s`);
  if (m.iso) parts.push(`ISO ${m.iso}`);
  if (m.focal) parts.push(`${Math.round(m.focal)} mm`);
  return parts.join(" · ");
}
