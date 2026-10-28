// PDF writing with pdf-lib, loaded only by the tools that make PDFs.

import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

export { rgb };

export const MM = 72 / 25.4;
export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function newPdf(title?: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  // pdf-lib writes its own name and URL as the producer otherwise.
  doc.setProducer("pixvault");
  doc.setCreator("pixvault");
  if (title) doc.setTitle(title);
  return doc;
}

export interface PdfImage {
  bytes: Uint8Array;
  kind: "jpeg" | "png";
}

export async function embed(doc: PDFDocument, img: PdfImage) {
  return img.kind === "jpeg" ? doc.embedJpg(img.bytes) : doc.embedPng(img.bytes);
}

export const helvetica = (doc: PDFDocument) => doc.embedFont(StandardFonts.Helvetica);
export const helveticaBold = (doc: PDFDocument) => doc.embedFont(StandardFonts.HelveticaBold);

/** Text the standard fonts can encode (WinAnsi): other characters become "?". */
export function winAnsi(text: string): string {
  return [...text].map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 255 ? c : "?")).join("");
}

/** Shorten text with "…" until it fits `width` points. */
export function fit(font: PDFFont, text: string, size: number, width: number): string {
  let t = winAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}
