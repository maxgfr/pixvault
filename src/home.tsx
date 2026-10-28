// The front door: an empty mat whose window takes photos, then the index of
// every tool. Once photos are in, the same page is the workspace.

import { useEffect, useId, useRef, useState } from "react";
import { filesFromDrop, readFiles } from "./files.ts";
import { useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { CATEGORIES, tools } from "./tools/index.ts";
import { usePhotos, workspace } from "./workspace.ts";
import { WorkspacePage } from "./workspace-page.tsx";

export async function addFiles(list: Iterable<File>) {
  const read = await readFiles(list);
  if (read.length) workspace.add(read);
}

const FORMATS = "JPEG · PNG · HEIC · WebP · AVIF · JPEG XL · RAW · TIFF · GIF · SVG";

/** The mat with an open window: drop, pick files or a folder. */
export function DropMat({ compact = false }: { compact?: boolean }) {
  const { t } = useLang();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div
      className="drop-mat"
      data-compact={compact ? "" : undefined}
      data-over={over ? "" : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void filesFromDrop(e.dataTransfer).then(addFiles);
      }}
    >
      <div className="drop-window">
        <Icon name="upload" size={28} />
        <p className="drop-title">{t("Drop your photos here", "Déposez vos photos ici")}</p>
        <p className="drop-sub" id={id}>
          {t("One or hundreds, or a whole folder. You can also paste a screenshot.", "Une ou des centaines, ou tout un dossier. Vous pouvez aussi coller une capture.")}
        </p>
        <div className="drop-buttons">
          <button type="button" className="primary" onClick={() => input.current?.click()} aria-describedby={id}>
            {t("Choose photos", "Choisir des photos")}
          </button>
          <button type="button" className="secondary" onClick={() => folder.current?.click()}>
            <Icon name="folder" /> {t("A folder", "Un dossier")}
          </button>
        </div>
        <p className="drop-formats">{FORMATS}</p>
      </div>
      <input ref={input} type="file" hidden multiple accept="image/*,.heic,.heif,.jxl,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.pef,.srw,.tif,.tiff,.qoi,.svg" onChange={(e) => {
        const list = [...(e.currentTarget.files ?? [])];
        e.currentTarget.value = "";
        void addFiles(list);
      }} aria-label={t("Photos to work on", "Photos à traiter")} />
      <input ref={folder} type="file" hidden multiple {...{ webkitdirectory: "" }} onChange={(e) => {
        const list = [...(e.currentTarget.files ?? [])].filter((f) => !f.name.startsWith("."));
        e.currentTarget.value = "";
        void addFiles(list);
      }} aria-label={t("Folder of photos", "Dossier de photos")} />
    </div>
  );
}

/** Every tool, as a catalogue index by category, with search. */
export function ToolIndex() {
  const { l, t } = useLang();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (tool: (typeof tools)[number]) =>
    !needle || `${tool.title.en} ${tool.title.fr} ${tool.summary.en} ${tool.summary.fr} ${(tool.aliases ?? []).join(" ")}`.toLowerCase().includes(needle);
  const groups = CATEGORIES.map((c) => ({ ...c, items: tools.filter((x) => x.category === c.id && match(x)) })).filter((g) => g.items.length);
  return (
    <section className="index" aria-labelledby="index-title">
      <div className="index-head">
        <h2 id="index-title">{t("Every tool", "Tous les outils")}</h2>
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={t(`Search ${tools.length} tools: heic, gps, instagram…`, `Chercher parmi ${tools.length} outils : heic, gps, instagram…`)} aria-label={t("Search tools", "Chercher un outil")} />
        </label>
      </div>
      <div className="index-columns">
        {groups.map((g) => (
          <section key={g.id} className="index-group">
            <h3>
              <Icon name={g.id} size={18} /> {l(g.title)}
            </h3>
            <ul>
              {g.items.map((x) => (
                <li key={x.id}>
                  <a href={`#/${x.id}`}>
                    <strong>{l(x.title)}</strong>
                    <span>{l(x.summary)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!groups.length ? <p className="note">{t(`No tool matches “${q}”.`, `Aucun outil ne correspond à « ${q} ».`)}</p> : null}
      </div>
    </section>
  );
}

export function Home() {
  const { t } = useLang();
  const photos = usePhotos();
  if (photos.length) return <WorkspacePage />;
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <h1>{t("Photo tools that never upload your photos.", "Des outils photo qui n'envoient jamais vos photos.")}</h1>
          <p className="lede">
            {t(
              "Compress, convert HEIC and RAW, resize, crop, retouch, clean the metadata, combine, and edit with AI. Everything runs in this tab, on your device.",
              "Compresser, convertir les HEIC et RAW, redimensionner, recadrer, retoucher, nettoyer les métadonnées, assembler, et retoucher avec l'IA. Tout se passe dans cet onglet, sur votre appareil.",
            )}
          </p>
          <ul className="facts">
            <li>
              <Icon name="shield" size={18} /> {t("No upload, no account", "Aucun envoi, aucun compte")}
            </li>
            <li>
              <Icon name="offline" size={18} /> {t("Works offline", "Marche hors ligne")}
            </li>
            <li>
              <Icon name="layers" size={18} /> {t("Whole batches at once", "Des lots entiers d'un coup")}
            </li>
          </ul>
        </div>
        <DropMat />
      </section>
      <ToolIndex />
    </div>
  );
}

/** Pasting files or a screenshot anywhere outside a text field adds them. */
export function usePaste() {
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      const list = [...(e.clipboardData?.files ?? [])];
      if (!list.length) return;
      e.preventDefault();
      void addFiles(list);
    };
    addEventListener("paste", paste);
    return () => removeEventListener("paste", paste);
  }, []);
}
