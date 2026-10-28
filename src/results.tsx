// What a run produced: per-photo size changes, and every way to take the
// files away (one by one, ZIP, a folder, the share sheet) or keep working
// on them here.

import { useEffect, useMemo, useState } from "react";
import type { CompressNote, CompressReport } from "./engine/run/optimize.ts";
import type { Output } from "./engine/run/types.ts";
import { canSaveToFolder, canShare, download, downloadZip, saveToFolder, share } from "./files.ts";
import { bytes, delta, errorText, photos as nPhotos, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import type { Outcome } from "./run.ts";
import { reportsOf } from "./run.ts";
import type { ToolDef } from "./tools/types.ts";
import { accession, workspace } from "./workspace.ts";

const DISPLAYABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "image/x-icon"]);

const NOTES: Record<CompressNote, [string, string]> = {
  "kept-original": ["Already as small as it gets: original kept", "Déjà au plus léger : original conservé"],
  "already-fits": ["Already under the target size", "Déjà sous le poids visé"],
  downscaled: ["Shrunk to reach the target size", "Réduite pour atteindre le poids visé"],
  "target-missed": ["Could not reach the target size", "Impossible d'atteindre le poids visé"],
  "lossless-jpeg": ["JPEG cannot be recompressed losslessly: original kept", "Un JPEG ne se recompresse pas sans perte : original conservé"],
  "source-unwritable": ["This format cannot be written in a browser: saved in the most compact one that can", "Ce format ne s'écrit pas dans un navigateur : enregistré dans le plus compact possible"],
};

interface Row {
  key: string;
  outcome: Outcome;
  file?: Output;
  url?: string;
}

export function Results({ tool, outcomes, onBack }: { tool: ToolDef; outcomes: Outcome[]; onBack: () => void }) {
  const { t, lang } = useLang();
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");

  const rows: Row[] = useMemo(
    () =>
      outcomes.flatMap((o, i): Row[] =>
        o.files.length
          ? o.files.map((f, j) => ({ key: `${i}/${j}`, outcome: o, file: f, url: DISPLAYABLE.has(f.mime) && f.bytes.length < 40_000_000 ? URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime })) : undefined }))
          : [{ key: `${i}`, outcome: o }],
      ),
    [outcomes],
  );
  useEffect(() => () => rows.forEach((r) => r.url && URL.revokeObjectURL(r.url)), [rows]);

  const files = rows.flatMap((r) => (r.file ? [r.file] : []));
  const failed = outcomes.filter((o) => o.error);
  const perPhoto = tool.input === "image" && outcomes.every((o) => o.files.length <= 1);
  const before = outcomes.reduce((n, o) => n + (o.files.length ? o.inputs.reduce((m, p) => m + p.bytes.length, 0) : 0), 0);
  const after = files.reduce((n, f) => n + f.bytes.length, 0);
  const notes = new Map(reportsOf<CompressReport>(outcomes).filter((r) => r && "note" in r).map((r) => [r.name, r.note]));

  // Leaving the page would lose results that were never taken away.
  useEffect(() => {
    if (saved || !files.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [saved, files.length]);

  const keep = (r: Row) => {
    if (!r.file) return;
    const src = r.outcome.inputs[0];
    if (perPhoto && src && workspace.get(src.key)) workspace.replace(src.key, r.file.name, r.file.bytes);
    else workspace.add([{ name: r.file.name, bytes: r.file.bytes, unsaved: true }]);
    setKept((s) => new Set(s).add(r.key));
  };

  if (!files.length && !failed.length) return null;

  return (
    <section className="results" aria-labelledby="results-title">
      <header className="results-head">
        <h2 id="results-title">{t("Results", "Résultats")}</h2>
        {files.length ? (
          <p className="num">
            {perPhoto ? (
              <>
                {nPhotos(outcomes.length - failed.length, lang)} · {bytes(before, lang)} → <strong>{bytes(after, lang)}</strong>{" "}
                <span className={after < before ? "gain" : "loss"}>{delta(before, after, lang)}</span>
              </>
            ) : (
              t(`${files.length} file(s) · ${bytes(after, lang)}`, `${files.length} fichier(s) · ${bytes(after, lang)}`)
            )}
          </p>
        ) : null}
      </header>

      {files.length ? (
        <div className="results-actions">
          {files.length > 1 ? (
            <button type="button" className="primary" onClick={() => (downloadZip(files, `pixvault-${tool.id}.zip`), setSaved(true))}>
              <Icon name="zip" /> {t("Download all (ZIP)", "Tout télécharger (ZIP)")}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => (download(files[0]!), setSaved(true))}>
              <Icon name="download" /> {t("Download", "Télécharger")}
            </button>
          )}
          {canSaveToFolder() ? (
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                try {
                  const n = await saveToFolder(files);
                  setSaved(true);
                  setMessage(t(`${n} file(s) saved in the folder.`, `${n} fichier(s) enregistré(s) dans le dossier.`));
                } catch (e) {
                  if ((e as Error).name !== "AbortError") setMessage(t("Could not write to that folder.", "Impossible d'écrire dans ce dossier."));
                }
              }}
            >
              <Icon name="folder" /> {t("Save to a folder", "Enregistrer dans un dossier")}
            </button>
          ) : null}
          {canShare(files) ? (
            <button type="button" className="secondary" onClick={() => share(files).then(() => setSaved(true), () => {})}>
              <Icon name="share" /> {t("Share", "Partager")}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={() => rows.forEach((r) => !kept.has(r.key) && keep(r))} disabled={kept.size === rows.filter((r) => r.file).length}>
            <Icon name="layers" /> {perPhoto ? t("Use these versions", "Utiliser ces versions") : t("Add to your photos", "Ajouter à vos photos")}
          </button>
          <button type="button" className="link" onClick={onBack}>
            {t("Change the settings", "Modifier les réglages")}
          </button>
        </div>
      ) : null}
      <p className="note" role="status">
        {message}
      </p>

      {!perPhoto && rows.length === 1 && rows[0]?.url ? (
        <figure className="result-hero">
          <img src={rows[0].url} alt={rows[0].file?.name ?? ""} />
        </figure>
      ) : null}

      <ul className="result-rows">
        {rows.map((r) => {
          const src = r.outcome.inputs[0];
          const inSize = perPhoto ? (src?.bytes.length ?? 0) : 0;
          const note = r.file ? notes.get(src?.name ?? "") : undefined;
          return (
            <li key={r.key} className="result-row" data-error={r.outcome.error ? "" : undefined}>
              <div className="window window-sm">{r.url ? <img src={r.url} alt="" loading="lazy" /> : src?.thumb ? <img src={src.thumb} alt="" loading="lazy" /> : <Icon name="image" />}</div>
              <div className="result-text">
                <p className="result-name">
                  {perPhoto && src ? <span className="accession">{accession(src.no)}</span> : null} {r.file?.name ?? src?.name}
                </p>
                {r.outcome.error ? (
                  <p className="error-text">{errorText(r.outcome.error.code, r.outcome.error.message)}</p>
                ) : r.file ? (
                  <p className="label-line num">
                    {perPhoto ? (
                      <>
                        {bytes(inSize, lang)} → <strong>{bytes(r.file.bytes.length, lang)}</strong>{" "}
                        <span className={r.file.bytes.length < inSize ? "gain" : r.file.bytes.length > inSize ? "loss" : ""}>{delta(inSize, r.file.bytes.length, lang)}</span>
                      </>
                    ) : (
                      bytes(r.file.bytes.length, lang)
                    )}
                    {note ? <span className="muted"> · {t(...NOTES[note])}</span> : null}
                  </p>
                ) : null}
              </div>
              {r.file ? (
                <div className="result-buttons">
                  <button type="button" className="secondary small" onClick={() => (download(r.file!), files.length === 1 && setSaved(true))}>
                    <Icon name="download" size={16} /> <span className="sr-only-narrow">{t("Download", "Télécharger")}</span>
                  </button>
                  <button type="button" className="link small" disabled={kept.has(r.key)} onClick={() => keep(r)}>
                    {kept.has(r.key) ? t("In your photos", "Dans vos photos") : perPhoto ? t("Use this version", "Utiliser cette version") : t("Add to your photos", "Ajouter à vos photos")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
