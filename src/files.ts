// Getting files in (drop, picker, paste, share target) and out (download,
// ZIP, a folder, the share sheet). Nothing here talks to a server.

import { sniff } from "./engine/formats.ts";
import { uniqueNames, zip } from "./engine/zip.ts";

export interface InFile {
  name: string;
  /** The file itself: picked and dropped files stay on disk until a worker reads them. */
  file: Blob;
}

/** Read dropped items, walking into folders (any depth up to 8). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => Boolean(e));
  if (!entries.length || entries.every((e) => e.isFile)) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory && depth < 8) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most 100 entries per call.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch.sort((a, b) => a.name.localeCompare(b.name))) if (!e.name.startsWith(".")) await walk(e, depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, 0);
  return out;
}

/** SVG is drawn by the page (workers cannot rasterise it): to a PNG, 2048 px on the long side unless it says otherwise. */
async function rasteriseSvg(file: Blob): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([file], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 1024;
    const h0 = img.naturalHeight || 1024;
    const scale = Math.max(1, 2048 / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w0 * scale);
    canvas.height = Math.round(h0 * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readFiles(list: Iterable<File>): Promise<InFile[]> {
  const out: InFile[] = [];
  for (const f of list) {
    const name = f.name || "pasted.png";
    // Only SVG is read whole here (the page draws it); everything else stays a file.
    if (sniff(new Uint8Array(await f.slice(0, 4096).arrayBuffer()), name) === "svg") {
      const png = await rasteriseSvg(f);
      if (png) {
        out.push({ name: name.replace(/\.svg$/i, "") + ".png", file: new Blob([png as BlobPart], { type: "image/png" }) });
        continue;
      }
    }
    out.push({ name, file: f });
  }
  return out;
}

const blobOf = (f: { bytes: Uint8Array; mime?: string }) => new Blob([f.bytes as BlobPart], { type: f.mime || "application/octet-stream" });

export function download(f: { name: string; bytes: Uint8Array; mime?: string }) {
  const url = URL.createObjectURL(blobOf(f));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadZip(files: { name: string; bytes: Uint8Array }[], name: string) {
  download({ name, bytes: zip(files), mime: "application/zip" });
}

export const canSaveToFolder = () => typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

/** Write every file into a folder the user picks (Chromium); never overwrites. Returns how many were written. */
export async function saveToFolder(files: { name: string; bytes: Uint8Array }[]): Promise<number> {
  const pick = (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const dir = await pick({ mode: "readwrite", id: "pixvault-out", startIn: "pictures" });
  const taken = new Set<string>();
  for await (const key of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) taken.add(key.toLowerCase());
  const names = uniqueNames([...taken, ...files.map((f) => f.name)]).slice(taken.size);
  let n = 0;
  for (const [i, f] of files.entries()) {
    const handle = await dir.getFileHandle(names[i]!, { create: true });
    const w = await handle.createWritable();
    await w.write(f.bytes as BlobPart);
    await w.close();
    n++;
  }
  return n;
}

export function canShare(files: { name: string; bytes: Uint8Array; mime?: string }[]): boolean {
  if (!navigator.canShare) return false;
  try {
    return navigator.canShare({ files: files.map((f) => new File([f.bytes as BlobPart], f.name, { type: f.mime })) });
  } catch {
    return false;
  }
}

export async function share(files: { name: string; bytes: Uint8Array; mime?: string }[]) {
  await navigator.share({ files: files.map((f) => new File([f.bytes as BlobPart], f.name, { type: f.mime })) });
}

/** Photos another app shared to the installed PWA, parked by the service worker. */
export async function takeShared(): Promise<InFile[]> {
  if (!("caches" in window)) return [];
  const inbox = await caches.open("pixvault-inbox");
  const out: InFile[] = [];
  for (const req of await inbox.keys()) {
    const res = await inbox.match(req);
    if (!res) continue;
    out.push({ name: decodeURIComponent(res.headers.get("x-name") ?? "shared.jpg"), file: await res.blob() });
  }
  await caches.delete("pixvault-inbox");
  return out;
}
