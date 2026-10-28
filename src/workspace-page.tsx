// The photos you dropped, each in its mat with its accession label, and
// beside them what you can do with the selection.

import { useState } from "react";
import { moreActions, quickActions } from "./actions.ts";
import { filesFromDrop } from "./files.ts";
import { addFiles } from "./home.tsx";
import { bytes, errorText, photos as nPhotos, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { selection, useSelection } from "./selection.ts";
import { CATEGORIES } from "./tools/index.ts";
import { accession, type Photo, usePhotos, workspace } from "./workspace.ts";

const hasGps = (p: Photo) => Boolean(p.info?.gps);

function Mat({ p, selected, index, count }: { p: Photo; selected: boolean; index: number; count: number }) {
  const { t, lang } = useLang();
  const fmt = p.format === "jpeg" ? "JPEG" : p.format?.toUpperCase() ?? "?";
  return (
    <li className="mat" data-selected={selected ? "" : undefined} data-problem={p.problem ? "" : undefined}>
      <label className="mat-pick">
        <input type="checkbox" checked={selected} disabled={Boolean(p.problem)} onChange={() => selection.toggle(p.key)} />
        <span className="sr-only">{t(`Select ${p.name}`, `Sélectionner ${p.name}`)}</span>
      </label>
      <div className="window">{p.thumb ? <img src={p.thumb} alt={p.name} loading="lazy" /> : p.problem ? <Icon name="x" /> : <span className="window-wait" aria-label={t("Reading…", "Lecture…")} />}</div>
      <div className="label">
        <p className="label-top">
          <span className="accession">{accession(p.no)}</span>
          {hasGps(p) ? (
            <span className="badge badge-gps" title={t("This photo records where it was taken", "Cette photo indique où elle a été prise")}>
              <Icon name="pin" size={13} /> GPS
            </span>
          ) : null}
          {p.unsaved ? <span className="badge">{t("Changed", "Modifiée")}</span> : null}
        </p>
        <p className="label-name" title={p.name}>
          {p.name}
        </p>
        {p.problem ? (
          <p className="error-text">{errorText(p.problem.code, p.problem.message)}</p>
        ) : (
          <p className="label-line num">
            {fmt}
            {p.width ? ` · ${p.width}×${p.height}` : ""} · {bytes(p.bytes.length, lang)}
          </p>
        )}
      </div>
      <div className="mat-tools">
        <a
          href="#/inspect"
          className="icon-button"
          onClick={() => selection.only([p.key])}
          aria-label={t(`Details of ${p.name}`, `Infos de ${p.name}`)}
          title={t("See details", "Voir les infos")}
        >
          <Icon name="info" size={17} />
        </a>
        {p.previous ? (
          <button type="button" className="icon-button" onClick={() => workspace.restore(p.key)} aria-label={t("Restore the original", "Restaurer l'original")} title={t("Restore the original", "Restaurer l'original")}>
            <Icon name="undo" size={17} />
          </button>
        ) : null}
        <button type="button" className="icon-button" disabled={index === 0} onClick={() => workspace.move(p.key, -1)} aria-label={t("Move earlier", "Avancer")} title={t("Move earlier", "Avancer")}>
          <Icon name="back" size={17} />
        </button>
        <button type="button" className="icon-button" disabled={index === count - 1} onClick={() => workspace.move(p.key, 1)} aria-label={t("Move later", "Reculer")} title={t("Move later", "Reculer")}>
          <Icon name="next" size={17} />
        </button>
        <button type="button" className="icon-button" onClick={() => workspace.remove(p.key)} aria-label={t(`Remove ${p.name}`, `Retirer ${p.name}`)} title={t("Remove", "Retirer")}>
          <Icon name="trash" size={17} />
        </button>
      </div>
    </li>
  );
}

export function WorkspacePage() {
  const { l, t, lang } = useLang();
  const photos = usePhotos();
  const sel = useSelection(photos);
  const [over, setOver] = useState(false);
  const quick = quickActions(sel);
  const more = moreActions(sel, quick);
  const total = photos.reduce((n, p) => n + p.bytes.length, 0);
  const located = sel.filter(hasGps).length;
  const reading = photos.filter((p) => !p.thumb && !p.problem).length;

  return (
    <div
      className="workspace"
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
        setOver(false);
        void filesFromDrop(e.dataTransfer).then(addFiles);
      }}
    >
      <section className="collection" aria-labelledby="collection-title">
        <header className="collection-head">
          <h1 id="collection-title">{t("Your photos", "Vos photos")}</h1>
          <p className="num muted">
            {nPhotos(photos.length, lang)} · {bytes(total, lang)}
            {reading ? ` · ${t(`reading ${reading}…`, `lecture de ${reading}…`)}` : ""} · {t("never uploaded", "jamais envoyées")}
          </p>
          <div className="collection-tools">
            {photos.length > 1 ? (
              <button type="button" className="link small" onClick={() => (sel.length ? selection.none() : selection.all())}>
                {sel.length ? t("Select none", "Tout désélectionner") : t("Select all", "Tout sélectionner")}
              </button>
            ) : null}
            <label className="button secondary small">
              <Icon name="plus" size={16} /> {t("Add photos", "Ajouter des photos")}
              <input type="file" hidden multiple accept="image/*,.heic,.heif,.jxl,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.tif,.tiff,.svg" onChange={(e) => {
                const list = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = "";
                void addFiles(list);
              }} />
            </label>
            <button type="button" className="link small" onClick={() => workspace.clear()}>
              {t("Clear all", "Tout retirer")}
            </button>
          </div>
        </header>
        <ol className="mats">
          {photos.map((p, i) => (
            <Mat key={p.key} p={p} index={i} count={photos.length} selected={selection.has(p.key) && !p.problem} />
          ))}
        </ol>
        <p className="note drop-hint">{t("Drop more photos anywhere on this page, or paste them.", "Déposez d'autres photos n'importe où sur la page, ou collez-les.")}</p>
      </section>

      <aside className="actions" aria-labelledby="actions-title">
        <h2 id="actions-title">
          {sel.length
            ? t(`What to do with ${nPhotos(sel.length, "en")}?`, `Que faire de ${nPhotos(sel.length, "fr")} ?`)
            : t("Select photos to see what you can do", "Sélectionnez des photos pour voir les actions")}
        </h2>
        {located ? (
          <p className="gps-warning">
            <Icon name="pin" size={16} />{" "}
            {t(`${located} of them record where they were taken.`, `${located} d'entre elles indiquent où elles ont été prises.`)}{" "}
            <a href="#/strip">{t("Remove the location", "Retirer la position")}</a>
          </p>
        ) : null}
        <ul className="quick">
          {quick.map((x) => (
            <li key={x.id}>
              <a className="quick-action" href={`#/${x.id}`}>
                <Icon name={x.category} />
                <span>
                  <strong>{l(x.title)}</strong>
                  <small>{l(x.summary)}</small>
                </span>
              </a>
            </li>
          ))}
        </ul>
        {more.length ? (
          <div className="all-actions">
            <h3>{t("All tools for this selection", "Tous les outils pour cette sélection")}</h3>
            {more.map((g) => (
              <div key={g.id} className="chip-group">
                <h4>{l(CATEGORIES.find((c) => c.id === g.id)!.title)}</h4>
                <ul className="chips">
                  {g.tools.map((x) => (
                    <li key={x.id}>
                      <a className="chip" href={`#/${x.id}`}>
                        {l(x.title)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p>
              <a className="chip chip-recipe" href="#/recipe">
                <Icon name="layers" size={16} /> {t("Chain several steps (recipe)", "Enchaîner plusieurs étapes (recette)")}
              </a>
            </p>
          </div>
        ) : null}
      </aside>
      {over ? (
        <div className="drop-veil" aria-hidden="true">
          <p>{t("Drop to add them", "Déposez pour les ajouter")}</p>
        </div>
      ) : null}
    </div>
  );
}

