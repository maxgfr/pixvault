// One tool at work on the selected photos: a stage on the left (live
// before/after, or the crop and redact editors, then the results) and the
// settings on the right, ending with the one red button that runs it.

import { useEffect, useMemo, useRef, useState } from "react";
import { modelFor } from "./ai/catalog.ts";
import { useDownloaded, useGpu } from "./ai/download.ts";
import { Compare } from "./compare.tsx";
import { BrushEditor } from "./editors/brush-editor.tsx";
import { ModelGate } from "./editors/model-gate.tsx";
import { type PRect, RectEditor } from "./editors/rect-editor.tsx";
import { parseRatio, ratioRect } from "./engine/ops/crop.ts";
import { formatRegions, parseRegions } from "./engine/ops/redact.ts";
import { FieldList, missing } from "./fields.tsx";
import { DropMat } from "./home.tsx";
import { bytes, delta, errorText, photos as nPhotos, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { JobError, Previewer, runBatch } from "./pool.ts";
import { Reports } from "./reports.tsx";
import { Results } from "./results.tsx";
import { useRunner } from "./run.ts";
import { selection, useSelection } from "./selection.ts";
import { OUTPUT_FIELDS, type OptionValue, type Options, type ToolDef, withDefaults } from "./tools/types.ts";
import { accession, type Photo, usePhotos } from "./workspace.ts";

/** Settings survive switching tools during the session. */
const remembered = new Map<string, Options>();

const NATIVE = new Set(["jpeg", "png", "webp", "gif", "avif", "bmp"]);
const blobURL = (b: Uint8Array, mime: string) => URL.createObjectURL(new Blob([b as BlobPart], { type: mime }));

interface PreviewState {
  before?: string;
  after?: string;
  size?: number;
  busy: boolean;
  error?: string;
}

function usePreview(tool: ToolDef, photo: Photo | undefined, options: Options, modelReady: boolean): PreviewState {
  const previewer = useRef<Previewer | null>(null);
  const [state, setState] = useState<PreviewState>({ busy: false });
  // Upscaling is too slow to preview live; erase previews only its source.
  const kind = tool.id === "upscale" || tool.id === "erase" ? "plain" : tool.step ? "step" : (tool.id === "compress" || tool.id === "convert") && tool.input === "image" ? "encode" : tool.editor ? "plain" : null;
  // A plain preview shows the photo itself: settings (a painted mask…) must not reload it.
  const key = kind === "plain" ? "" : JSON.stringify(options, (_, v) => (v instanceof Uint8Array ? `bytes:${v.length}` : v));

  useEffect(() => {
    previewer.current = new Previewer();
    return () => previewer.current?.dispose();
  }, []);

  useEffect(() => {
    if (!photo || !kind || (tool.model && !modelReady && kind !== "plain")) {
      setState({ busy: false });
      return;
    }
    let urls: string[] = [];
    let live = true;
    setState((s) => ({ ...s, busy: true, error: undefined }));
    const timer = setTimeout(
      async () => {
        try {
          const input = { name: photo.name, bytes: photo.bytes };
          if (kind === "encode") {
            const r = await previewer.current!.request({ kind: "tool", tool: tool.id, inputs: [input], options });
            if (!r || !live) return;
            const out = r.files[0];
            const before = photo.format && NATIVE.has(photo.format) ? blobURL(photo.bytes, "image/" + photo.format) : photo.thumb;
            const after = out && /^image\/(jpeg|png|webp|gif|avif)$/.test(out.mime) ? blobURL(out.bytes, out.mime) : undefined;
            urls = [before, after].filter((u): u is string => Boolean(u) && u !== photo.thumb);
            setState({ before, after, size: out?.bytes.length, busy: false });
          } else {
            const steps = kind === "step" ? [{ tool: tool.id, options }] : [];
            const r = await previewer.current!.request({ kind: "preview", steps, input, maxSide: 1400, key: `${photo.key}:${photo.bytes.length}:1400` });
            if (!r || !live) return;
            const before = r.before ? blobURL(r.before.bytes, r.before.mime) : undefined;
            const after = kind === "step" && r.files[0] ? blobURL(r.files[0].bytes, r.files[0].mime) : undefined;
            urls = [before, after].filter((u): u is string => Boolean(u));
            setState({ before, after, busy: false });
          }
        } catch (e) {
          if (live) setState({ busy: false, error: e instanceof JobError ? errorText(e.code, e.message) : String(e) });
        }
      },
      kind === "encode" ? 450 : 60,
    );
    return () => {
      live = false;
      clearTimeout(timer);
      // Keep the previous images on screen until the next ones arrive.
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 4000);
    };
    // A plain preview shows the photo itself: it must not reload (and clear a brush) when the model arrives.
  }, [photo?.key, photo?.bytes, kind, key, tool.id, kind === "plain" ? false : modelReady]);
  return state;
}

export function ToolView({ tool }: { tool: ToolDef }) {
  const { l, t, lang } = useLang();
  const all = usePhotos();
  const sel = useSelection(all);
  const [options, setOptions] = useState<Options>(() => remembered.get(tool.id) ?? withDefaults(tool, {}));
  const [focus, setFocus] = useState<string | null>(null);
  const runner = useRunner();
  const fields = useMemo(() => [...tool.fields, ...(tool.output ? OUTPUT_FIELDS : [])], [tool]);
  const photo = sel.find((p) => p.key === focus) ?? sel[0];
  const gpu = useGpu();
  // Until the device is known, the model is not chosen and nothing runs.
  const modelId = tool.model && gpu ? modelFor(tool.id, options, gpu) : null;
  const haveModel = useDownloaded(modelId);
  const needsModel = Boolean(tool.model) && !(tool.id === "describe" && options.engine === "api");
  const modelReady = !needsModel || (modelId !== null && haveModel === true);
  const preview = usePreview(tool, runner.outcomes ? undefined : photo, options, modelReady);
  const [asking, setAsking] = useState(false);
  const viaApi = tool.id === "describe" && options.engine === "api";
  // The provider code (AI SDK, llm-connect) loads only when someone picks it.
  const [providerReady, setProviderReady] = useState(false);

  useEffect(() => {
    if (!viaApi) return;
    void import("./ai/byok.ts").then(async (b) => {
      await b.loadLlm();
      setProviderReady(Boolean(b.savedSettings()));
    });
  }, [viaApi]);

  /** "Describe" with the user's provider: the page asks it, then the worker writes the results. */
  async function run() {
    if (!viaApi) return runner.run({ tool, options }, sel);
    setAsking(true);
    try {
      const { describeWithApi } = await import("./ai/byok.ts");
      const small = await runBatch(
        sel.map((p) => ({ kind: "preview" as const, steps: [], input: { name: p.name, bytes: p.bytes }, maxSide: 1024 })),
        { workers: 2 },
      );
      const captions = new Map<string, string>();
      for (const [i, p] of sel.entries()) {
        const r = small[i];
        if (!r || r instanceof JobError || !r.before) continue;
        const d = await describeWithApi(r.before.bytes, options.detail === "long" ? "long" : "short", String(options.language ?? "auto"));
        captions.set(p.key, JSON.stringify([d]));
      }
      await runner.run({ tool, options, perPhoto: (p) => ({ captions: captions.get(p.key) }) }, sel);
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    remembered.set(tool.id, options);
  }, [tool.id, options]);

  const set = (name: string, v: OptionValue) => setOptions((o) => ({ ...o, [name]: v }));
  const lacking = missing(fields, options);
  const tooFew = tool.min && sel.length < tool.min;
  const aspect = photo?.width && photo.height ? photo.width / photo.height : 1.5;

  // Crop: the frame drawn in the editor, or a centred one at the chosen ratio.
  const ratio = parseRatio(String(options.ratio ?? ""));
  const cropRect: PRect | null =
    tool.editor === "crop"
      ? typeof options.w === "number" && typeof options.h === "number"
        ? { x: Number(options.x ?? 0), y: Number(options.y ?? 0), w: options.w, h: options.h }
        : (() => {
            const r = ratioRect(1000 * aspect, 1000, ratio ?? aspect, "center");
            return { x: (r.x / (1000 * aspect)) * 100, y: r.y / 10, w: (r.width / (1000 * aspect)) * 100, h: r.height / 10 };
          })()
      : null;

  if (!all.length) {
    return (
      <div className="tool-view">
        <ToolHead tool={tool} />
        <DropMat compact />
      </div>
    );
  }

  const label = `${l(tool.title)} · ${nPhotos(sel.length, lang)}`;

  return (
    <div className="tool-view">
      <ToolHead tool={tool} />
      <div className="tool-body">
        <div className="stage" aria-live="polite">
          {runner.outcomes ? (
            <>
              <Reports
                tool={tool.id}
                outcomes={runner.outcomes}
                onSelectNames={(names) => selection.only(all.filter((p) => !names.includes(p.name)).map((p) => p.key))}
              />
              <Results tool={tool} outcomes={runner.outcomes} onBack={runner.reset} />
              {tool.report && !runner.outcomes.some((o) => o.files.length) ? (
                <button type="button" className="link" onClick={runner.reset}>
                  {t("Back to the settings", "Retour aux réglages")}
                </button>
              ) : null}
            </>
          ) : modelId && haveModel === false ? (
            <ModelGate id={modelId} />
          ) : photo && tool.editor === "erase" && preview.before ? (
            <BrushEditor src={preview.before} onMask={(m) => set("mask", m)} />
          ) : photo && (tool.editor === "crop" || tool.editor === "redact") && preview.before ? (
            <RectEditor
              src={preview.before}
              aspect={aspect}
              multiple={tool.editor === "redact"}
              shade={tool.editor === "crop"}
              ratio={tool.editor === "crop" ? ratio : null}
              rects={tool.editor === "crop" ? (cropRect ? [cropRect] : []) : parseRegions(String(options.regions ?? ""))}
              onChange={(rs) => {
                if (tool.editor === "redact") set("regions", formatRegions(rs));
                else if (rs[0]) setOptions((o) => ({ ...o, x: +rs[0]!.x.toFixed(2), y: +rs[0]!.y.toFixed(2), w: +rs[0]!.w.toFixed(2), h: +rs[0]!.h.toFixed(2) }));
              }}
            />
          ) : photo && (preview.before || photo.thumb) && (tool.step || tool.id === "compress" || tool.id === "convert") && tool.id !== "erase" ? (
            <div className="preview">
              <Compare before={preview.before ?? photo.thumb!} after={preview.after} alt={photo.name} />
              <p className="preview-line num" data-busy={preview.busy ? "" : undefined}>
                {preview.busy ? t("Updating the preview…", "Mise à jour de l'aperçu…") : preview.error ? <span className="error-text">{preview.error}</span> : null}
                {!preview.busy && preview.size !== undefined ? (
                  <>
                    {t("This photo: ", "Cette photo : ")}
                    {bytes(photo.bytes.length, lang)} → <strong>{bytes(preview.size, lang)}</strong>{" "}
                    <span className={preview.size < photo.bytes.length ? "gain" : "loss"}>{delta(photo.bytes.length, preview.size, lang)}</span>
                  </>
                ) : null}
                {tool.id === "upscale" ? t("Upscaling runs tile by tile: it can take a few minutes without WebGPU.", "L'agrandissement se fait tuile par tuile : comptez quelques minutes sans WebGPU.") : null}
              </p>
            </div>
          ) : (
            <SelectedSheet photos={sel} />
          )}
          {!runner.outcomes && sel.length > 1 && (tool.step || tool.editor || tool.id === "compress" || tool.id === "convert") ? <Filmstrip photos={sel} current={photo?.key} onPick={setFocus} /> : null}
        </div>

        <aside className="options" aria-label={t("Settings", "Réglages")}>
          <FieldList fields={fields} options={options} onChange={set} />
          {tool.editor === "crop" && typeof options.w === "number" ? (
            <button type="button" className="link small" onClick={() => setOptions((o) => ({ ...o, x: undefined, y: undefined, w: undefined, h: undefined }))}>
              {t("Reset the frame", "Réinitialiser le cadre")}
            </button>
          ) : null}
          <div className="run">
            {runner.running ? (
              <>
                <Progress p={runner.progress!} />
                <button type="button" className="secondary" onClick={runner.cancel}>
                  <Icon name="stop" /> {t("Stop", "Arrêter")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary run-button"
                disabled={!sel.length || lacking.length > 0 || Boolean(tooFew) || asking || (!modelReady && !viaApi) || (tool.id === "erase" && !options.mask) || (viaApi && !providerReady)}
                onClick={() => void run()}
              >
                {asking ? t("Asking your AI provider…", "Interrogation de votre fournisseur d'IA…") : label}
              </button>
            )}
            <p className="note">
              {viaApi && !providerReady ? (
                <a href="#/ai">{t("Set up your AI provider first", "Configurez d'abord votre fournisseur d'IA")}</a>
              ) : !sel.length
                ? t("Select at least one photo.", "Sélectionnez au moins une photo.")
                : tooFew
                  ? t(`Select at least ${tool.min} photos.`, `Sélectionnez au moins ${tool.min} photos.`)
                  : lacking.length
                    ? `${t("Fill in", "À renseigner")} : ${lacking.map((f) => l(f.label)).join(", ")}`
                    : t("Your originals stay untouched until you choose to replace them.", "Vos originaux restent intacts tant que vous ne choisissez pas de les remplacer.")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ToolHead({ tool }: { tool: ToolDef }) {
  const { l, t } = useLang();
  return (
    <header className="tool-head">
      <a href="#/" className="back">
        <Icon name="back" size={18} /> {t("Your photos", "Vos photos")}
      </a>
      <h1>{l(tool.title)}</h1>
      <p className="lede">{l(tool.summary)}</p>
    </header>
  );
}

function Progress({ p }: { p: { done: number; total: number; label?: string } }) {
  const { t, lang } = useLang();
  const fraction = p.total ? p.done / p.total : 0;
  return (
    <div className="progress" role="status">
      <div className="progress-bar" data-indeterminate={p.done === 0 ? "" : undefined}>
        <span style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <p className="num">
        {p.total > 1 ? t(`${Math.floor(p.done)} of ${p.total} done`, `${Math.floor(p.done)} sur ${p.total} terminées`) : t("Working…", "En cours…")}
        {p.label ? <span className="muted"> · {p.label}</span> : null}
        <span className="sr-only">{lang === "fr" ? "Traitement en cours" : "Processing"}</span>
      </p>
    </div>
  );
}

/** Small mats of the selected photos, for tools without a live preview. */
function SelectedSheet({ photos }: { photos: Photo[] }) {
  const { t, lang } = useLang();
  return (
    <div className="sheet">
      <p className="sheet-title">{t(`Will run on ${nPhotos(photos.length, lang)}`, `S'appliquera à ${nPhotos(photos.length, lang)}`)}</p>
      <ul className="sheet-grid">
        {photos.slice(0, 48).map((p) => (
          <li key={p.key} className="mat mat-sm">
            <div className="window">{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : null}</div>
            <span className="accession">{accession(p.no)}</span>
          </li>
        ))}
      </ul>
      {photos.length > 48 ? <p className="note">{t(`and ${photos.length - 48} more`, `et ${photos.length - 48} de plus`)}</p> : null}
    </div>
  );
}

function Filmstrip({ photos, current, onPick }: { photos: Photo[]; current?: string; onPick: (k: string) => void }) {
  const { t } = useLang();
  return (
    <div className="filmstrip" role="listbox" aria-label={t("Photo shown in the preview", "Photo affichée dans l'aperçu")}>
      {photos.map((p) => (
        <button key={p.key} type="button" role="option" aria-selected={p.key === current} className="film-frame" onClick={() => onPick(p.key)} title={p.name}>
          {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <Icon name="image" />}
          <span className="accession">{accession(p.no)}</span>
        </button>
      ))}
    </div>
  );
}
