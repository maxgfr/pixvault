// Test photos with real-world metadata, built on the fly.
import { encode } from "../codecs.ts";
import type { OutFormat } from "../formats.ts";
import { sample } from "../test/setup.ts";
import { setMeta } from "./containers.ts";
import { buildExif, buildXmp } from "./exif-write.ts";
import type { PhotoMeta } from "./types.ts";

export const PHONE: PhotoMeta = {
  make: "Apple",
  model: "iPhone 15 Pro",
  lens: "iPhone 15 Pro back triple camera 6.765mm f/1.78",
  taken: "2025-08-02T09:41:12",
  offset: "+02:00",
  exposure: 1 / 120,
  fnumber: 1.78,
  iso: 64,
  focal: 6.765,
  gps: { lat: 43.296482, lon: 5.36978, alt: 21 },
  software: "17.5.1",
  orientation: 1,
};

export async function photo(format: Extract<OutFormat, "jpeg" | "png" | "webp">, meta: PhotoMeta = PHONE, xmp?: Parameters<typeof buildXmp>[0], extraXml = "") {
  const pixels = await encode(sample(64, 48), format);
  const xml = xmp ? buildXmp(xmp).replace("</rdf:Description>", `${extraXml}</rdf:Description>`) : undefined;
  return setMeta(pixels, { exif: buildExif(meta), ...(xml ? { xmp: xml } : {}) });
}
