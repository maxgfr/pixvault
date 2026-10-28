// What report tools found, drawn from the data the engine returns.

import { useState } from "react";
import type { DescribeReport } from "./engine/run/ai.ts";
import type { InspectReport, RiskCode } from "./engine/meta/read.ts";
import type { Base64Report, DuplicatesReport, HistogramReport, PaletteReport } from "./engine/run/analyze.ts";
import type { EditReport, StripReport } from "./engine/run/metadata.ts";
import { bytes, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import type { Outcome } from "./run.ts";
import { reportsOf } from "./run.ts";
import { accession } from "./workspace.ts";

const RISKS: Record<RiskCode, [string, string]> = {
  location: ["Where it was taken (GPS)", "Le lieu de prise de vue (GPS)"],
  serial: ["Your camera's serial number", "Le numéro de série de votre appareil"],
  owner: ["The owner's name", "Le nom du propriétaire"],
  timestamp: ["The exact date and time", "La date et l'heure exactes"],
  device: ["The device that took it", "L'appareil utilisé"],
  software: ["The software that edited it", "Le logiciel qui l'a modifiée"],
  thumbnail: ["A hidden thumbnail, which may show the uncropped original", "Une miniature cachée, qui peut montrer l'original non recadré"],
  history: ["An edit history", "Un historique de retouches"],
};

const REMOVED: Record<string, [string, string]> = {
  gps: ["location", "position"],
  serial: ["serial numbers", "numéros de série"],
  owner: ["owner", "propriétaire"],
  "maker-note": ["maker notes", "notes du fabricant"],
  exif: ["EXIF", "EXIF"],
  xmp: ["XMP", "XMP"],
  iptc: ["IPTC", "IPTC"],
  comment: ["comments", "commentaires"],
  thumbnail: ["thumbnail", "miniature"],
  details: ["details", "détails"],
  app: ["app data", "données d'application"],
  text: ["text chunks", "blocs de texte"],
  time: ["timestamp", "horodatage"],
};

const GROUPS: Record<string, [string, string]> = {
  camera: ["Camera", "Appareil"],
  lens: ["Lens", "Objectif"],
  settings: ["Settings", "Réglages"],
  date: ["Date", "Date"],
  location: ["Location", "Position"],
  author: ["Author and rights", "Auteur et droits"],
  software: ["Software", "Logiciel"],
  image: ["Image", "Image"],
  other: ["Other details", "Autres infos"],
};

function Inspect({ r, no }: { r: InspectReport; no?: number }) {
  const { l, t } = useLang();
  return (
    <article className="report-inspect">
      <header>
        <h3>
          {no ? <span className="accession">{accession(no)}</span> : null} {r.name}
        </h3>
        <p className="label-line num">
          {r.format?.toUpperCase()} · {r.width && r.height ? `${r.width}×${r.height}` : "?"} · {bytes(r.size)}
          {r.icc ? ` · ${t("colour profile", "profil couleur")}` : ""}
        </p>
      </header>
      {r.risks.length ? (
        <div className="risks" role="note">
          <h4>{t("What this file gives away", "Ce que ce fichier révèle")}</h4>
          <ul>
            {r.risks.map((k) => (
              <li key={k.code} data-level={k.level}>
                {t(...RISKS[k.code])}
              </li>
            ))}
          </ul>
          {r.gps ? (
            <p className="num">
              <Icon name="pin" size={16} /> {r.gps.lat.toFixed(5)}, {r.gps.lon.toFixed(5)}
              {r.gps.alt !== undefined ? ` · ${Math.round(r.gps.alt)} m` : ""}
            </p>
          ) : null}
          <p>
            <a href="#/strip">{t("Remove it without re-compressing", "Le retirer sans recompresser")}</a>
          </p>
        </div>
      ) : (
        <p className="ok-line">
          <Icon name="check" size={16} /> {t("No personal details found in this file.", "Aucune info personnelle trouvée dans ce fichier.")}
        </p>
      )}
      <div className="groups">
        {r.groups
          .filter((g) => g.entries.length)
          .map((g) => (
            <section key={g.id}>
              <h4>{t(...(GROUPS[g.id] ?? [g.id, g.id]))}</h4>
              <dl>
                {g.entries.map((e) => (
                  <div key={e.key}>
                    <dt>{l(e.label)}</dt>
                    <dd>{e.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </article>
  );
}

function Palette({ r }: { r: PaletteReport }) {
  const { t } = useLang();
  const [copied, setCopied] = useState("");
  const copy = async (text: string, what: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };
  const css = r.colors.map((c, i) => `  --color-${i + 1}: ${c.hex};`).join("\n");
  return (
    <article className="report-palette">
      <h3>{r.name}</h3>
      <ol className="swatches">
        {r.colors.map((c) => (
          <li key={c.hex}>
            <button type="button" className="swatch" style={{ background: c.hex }} onClick={() => copy(c.hex, c.hex)} aria-label={t(`Copy ${c.hex}`, `Copier ${c.hex}`)} />
            <code>{c.hex}</code>
            <span className="num muted">
              {Math.round(c.share * 100)} %
            </span>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="secondary small" onClick={() => copy(`:root {\n${css}\n}`, "css")}>
          <Icon name="copy" size={16} /> {copied === "css" ? t("Copied", "Copié") : t("Copy as CSS", "Copier en CSS")}
        </button>
        <button type="button" className="secondary small" onClick={() => copy(JSON.stringify(r.colors.map((c) => c.hex)), "json")}>
          <Icon name="copy" size={16} /> {copied === "json" ? t("Copied", "Copié") : t("Copy as JSON", "Copier en JSON")}
        </button>
      </div>
    </article>
  );
}

function Histogram({ r }: { r: HistogramReport & { name: string } }) {
  const { t } = useLang();
  const max = Math.max(1, ...r.luma.slice(1, 255));
  const path = (bins: number[]) => `M0,100 ${bins.map((v, i) => `L${(i / 255) * 256},${100 - Math.min(100, (v / max) * 100)}`).join(" ")} L256,100 Z`;
  const hints: Record<string, [string, string]> = {
    balanced: ["Well exposed", "Bien exposée"],
    under: ["Underexposed: try Auto enhance or raise Exposure", "Sous-exposée : essayez Amélioration auto ou montez l'exposition"],
    over: ["Overexposed: lower Exposure or Highlights", "Surexposée : baissez l'exposition ou les hautes lumières"],
    "low-contrast": ["Low contrast: try Auto enhance", "Peu contrastée : essayez Amélioration auto"],
  };
  return (
    <article className="report-histogram">
      <h3>{r.name}</h3>
      <svg viewBox="0 0 256 100" preserveAspectRatio="none" className="histogram" role="img" aria-label={t("Histogram", "Histogramme")}>
        <path d={path(r.r)} className="h-r" />
        <path d={path(r.g)} className="h-g" />
        <path d={path(r.b)} className="h-b" />
        <path d={path(r.luma)} className="h-l" />
      </svg>
      <dl className="stats num">
        <div>
          <dt>{t("Average brightness", "Luminosité moyenne")}</dt>
          <dd>{Math.round((r.mean / 255) * 100)} %</dd>
        </div>
        <div>
          <dt>{t("Blocked shadows", "Ombres bouchées")}</dt>
          <dd>{(r.clippedShadows * 100).toFixed(1)} %</dd>
        </div>
        <div>
          <dt>{t("Burnt highlights", "Hautes lumières brûlées")}</dt>
          <dd>{(r.clippedHighlights * 100).toFixed(1)} %</dd>
        </div>
      </dl>
      <p>{t(...(hints[r.hint] ?? hints.balanced!))}</p>
    </article>
  );
}

function Duplicates({ r, onSelect }: { r: DuplicatesReport; onSelect?: (names: string[]) => void }) {
  const { t } = useLang();
  if (!r.groups.length) return <p className="ok-line">{t("No duplicates among these photos.", "Aucun doublon parmi ces photos.")}</p>;
  return (
    <article className="report-dupes">
      <h3>{t(`${r.groups.length} group(s) of similar photos`, `${r.groups.length} groupe(s) de photos similaires`)}</h3>
      <ol>
        {r.groups.map((g, i) => (
          <li key={i}>
            <span className="num">{Math.round(g.similarity * 100)} %</span>{" "}
            {g.indices.map((k) => r.photos[k]?.name).join(" · ")}
            {onSelect ? (
              <button type="button" className="link small" onClick={() => onSelect(g.indices.slice(1).map((k) => r.photos[k]!.name))}>
                {t("Select all but the first", "Sélectionner tout sauf la première")}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </article>
  );
}

function Base64({ r }: { r: Base64Report }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <article className="report-base64">
      <h3>{r.name}</h3>
      {r.large ? <p className="warn">{t("Over 1 MB: a data URI this large slows pages down.", "Plus de 1 Mo : une data URI aussi lourde ralentit les pages.")}</p> : null}
      <textarea readOnly rows={5} value={r.dataUri} aria-label="Data URI" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="secondary small"
        onClick={async () => {
          await navigator.clipboard?.writeText(r.dataUri);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name="copy" size={16} /> {copied ? t("Copied", "Copié") : t("Copy", "Copier")} <span className="num muted">{bytes(r.base64Length)}</span>
      </button>
    </article>
  );
}

function Describe({ r }: { r: DescribeReport }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <article className="report-describe">
      <h3>{r.name}</h3>
      <p className="caption-text">{r.caption}</p>
      {r.keywords.length ? (
        <ul className="chips">
          {r.keywords.map((k) => (
            <li key={k} className="chip">
              {k}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="secondary small"
        onClick={async () => {
          await navigator.clipboard?.writeText(r.caption);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name="copy" size={16} /> {copied ? t("Copied", "Copié") : t("Copy the text", "Copier le texte")}
      </button>
    </article>
  );
}

/** The report section for a finished run, when the tool has one worth showing. */
export function Reports({ tool, outcomes, onSelectNames }: { tool: string; outcomes: Outcome[]; onSelectNames?: (names: string[]) => void }) {
  const { t } = useLang();
  switch (tool) {
    case "inspect":
      return (
        <div className="reports">
          {outcomes.map((o, i) => (o.report ? <Inspect key={i} r={o.report as InspectReport} no={o.inputs[0]?.no} /> : null))}
        </div>
      );
    case "palette":
      return <div className="reports">{reportsOf<PaletteReport>(outcomes).map((r, i) => <Palette key={i} r={r} />)}</div>;
    case "histogram":
      return <div className="reports">{reportsOf<HistogramReport & { name: string }>(outcomes).map((r, i) => <Histogram key={i} r={r} />)}</div>;
    case "duplicates":
      return <div className="reports">{reportsOf<DuplicatesReport>(outcomes).map((r, i) => <Duplicates key={i} r={r} onSelect={onSelectNames} />)}</div>;
    case "describe":
      return <div className="reports">{reportsOf<DescribeReport>(outcomes).map((r, i) => <Describe key={i} r={r} />)}</div>;
    case "base64":
      return <div className="reports">{reportsOf<Base64Report>(outcomes).map((r, i) => <Base64 key={i} r={r} />)}</div>;
    case "strip": {
      const all = reportsOf<StripReport>(outcomes);
      const removed = [...new Set(all.flatMap((r) => r.removed))];
      return (
        <p className="ok-line">
          <Icon name="check" size={16} />{" "}
          {removed.length
            ? t(`Removed: ${removed.map((k) => REMOVED[k]?.[0] ?? k).join(", ")}. Pixels unchanged.`, `Retiré : ${removed.map((k) => REMOVED[k]?.[1] ?? k).join(", ")}. Pixels inchangés.`)
            : t("Nothing to remove: these files were already clean.", "Rien à retirer : ces fichiers étaient déjà propres.")}
        </p>
      );
    }
    case "edit-meta": {
      const all = reportsOf<EditReport>(outcomes);
      return all.length ? <p className="ok-line"><Icon name="check" size={16} /> {t("Details updated, pixels unchanged.", "Infos mises à jour, pixels inchangés.")}</p> : null;
    }
    default:
      return null;
  }
}
