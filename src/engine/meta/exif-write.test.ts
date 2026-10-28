import { expect, test } from "bun:test";
import exifr from "exifr";
import { buildExif, parseTiff, serializeTiff, toRational } from "./exif-write.ts";

const meta = {
  make: "Canon",
  model: "Canon EOS R6",
  lens: "RF35mm F1.8 MACRO IS STM",
  taken: "2024-07-14T18:30:05",
  offset: "+02:00",
  exposure: 1 / 250,
  fnumber: 2.8,
  iso: 400,
  focal: 35,
  focal35: 35,
  gps: { lat: 48.858370, lon: -2.294481, alt: -12.5 },
  artist: "Élodie Café",
  copyright: "© 2026 Élodie",
  description: "La tour, vue d'en bas",
  orientation: 6,
  software: "pixvault",
};

test("written EXIF reads back through exifr", async () => {
  const tiff = buildExif(meta);
  const r = await exifr.parse(tiff, { tiff: true, exif: true, gps: true, translateValues: false, reviveValues: false });
  expect(r.Make).toBe("Canon");
  expect(r.Model).toBe("Canon EOS R6");
  expect(r.LensModel).toBe(meta.lens);
  expect(r.DateTimeOriginal).toBe("2024:07:14 18:30:05");
  expect(r.OffsetTimeOriginal).toBe("+02:00");
  expect(r.ExposureTime).toBeCloseTo(0.004, 6);
  expect(r.FNumber).toBe(2.8);
  expect(r.ISO).toBe(400);
  expect(r.FocalLength).toBe(35);
  expect(r.FocalLengthIn35mmFormat).toBe(35);
  expect(r.Orientation).toBe(6);
  expect(r.Artist).toBe("Élodie Café");
  expect(r.Copyright).toBe("© 2026 Élodie");
  expect(r.ImageDescription).toBe(meta.description);
  expect(r.latitude).toBeCloseTo(48.85837, 5);
  expect(r.longitude).toBeCloseTo(-2.294481, 5);
  expect(r.GPSAltitude).toBeCloseTo(12.5, 3);
  expect(r.GPSAltitudeRef[0]).toBe(1);
});

test("parse → serialize keeps every entry, in either byte order", () => {
  const doc = parseTiff(buildExif(meta))!;
  const again = parseTiff(serializeTiff(doc))!;
  expect(again.ifd0.length).toBe(doc.ifd0.length);
  expect(again.exif.length).toBe(doc.exif.length);
  expect(again.gps.length).toBe(doc.gps.length);
  expect(serializeTiff(again)).toEqual(serializeTiff(doc));
  const be = parseTiff(serializeTiff({ ...doc, le: false }));
  expect(be?.le).toBe(false);
});

test("thumbnails survive a round trip", () => {
  const doc = parseTiff(buildExif({ make: "X" }))!;
  doc.thumbnail = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const back = parseTiff(serializeTiff(doc))!;
  expect(back.thumbnail).toEqual(doc.thumbnail);
});

test("rationals are exact for shutter speeds and decimals", () => {
  expect(toRational(1 / 250)).toEqual([1, 250]);
  expect(toRational(2.8)).toEqual([28, 10]);
  expect(toRational(30)).toEqual([30, 1]);
  const [n, d] = toRational(Math.PI);
  expect(n / d).toBeCloseTo(Math.PI, 5);
});

test("not a TIFF is null", () => {
  expect(parseTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
});
