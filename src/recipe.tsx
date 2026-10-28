// A recipe chains per-photo steps (resize, then watermark, then strip the
// location…) and writes one file per photo. Recipes are kept in this
// browser and can be shared as a link whose #fragment carries the steps.

import { useEffect, useState } from "react";
import { DropMat } from "./home.tsx";
import { FieldList } from "./fields.tsx";
import { bytes as fmtBytes, photos as nPhotos, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { Results } from "./results.tsx";
import { useRunner } from "./run.ts";
import { useSelection } from "./selection.ts";
import { toolById, tools } from "./tools/index.ts";
import { OUTPUT_FIELDS, type Options, type ToolDef, withDefaults } from "./tools/types.ts";
import { usePhotos } from "./workspace.ts";

interface Step {
  tool: string;
  options: Options;
}
interface Recipe {
  name: string;
  steps: Step[];
  output: Options;
}

const KEY = "pixvault-recipes";
const STEP_TOOLS = tools.filter((t) => t.step && !t.model);

const STARTERS: Recipe[] = [
  {
    name: "Web-ready",
    steps: [
      { tool: "resize", options: { by: "long", size: 2048 } },
      { tool: "auto-enhance", options: { strength: 50, whiteBalance: true } },
    ],
    output: { format: "webp", quality: 80, metadata: "strip" },
  },
  {
    name: "Share safely",
    steps: [{ tool: "resize", options: { by: "long", size: 1600 } }],
    output: { format: "jpeg", quality: 82, metadata: "strip" },
  },
];

function load(): Recipe[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Recipe[];
  } catch {
    return [];
  }
}

const encode = (r: Recipe) => btoa(unescape(encodeURIComponent(JSON.stringify(r)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decode(s: string): Recipe | null {
  try {
    const r = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))) as Recipe;
    return Array.isArray(r.steps) && r.steps.every((x) => STEP_TOOLS.some((t) => t.id === x.tool)) ? r : null;
  } catch {
    return null;
  }
}

export function RecipePage() {
  const { l, t, lang } = useLang();
  const all = usePhotos();
  const sel = useSelection(all);
  const runner = useRunner();
  const [saved, setSaved] = useState<Recipe[]>(load);
  const [recipe, setRecipe] = useState<Recipe>(() => {
    const shared = new URLSearchParams(location.hash.split("?")[1] ?? "").get("r");
    return (shared && decode(shared)) || { name: "", steps: [{ tool: "resize", options: withDefaults(toolById.get("resize")!, {}) }], output: { format: "keep", quality: 85, metadata: "no-gps" } };
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => localStorage.setItem(KEY, JSON.stringify(saved)), [saved]);

  const setStep = (i: number, s: Step) => setRecipe((r) => ({ ...r, steps: r.steps.map((x, j) => (j === i ? s : x)) }));
  const moveStep = (i: number, by: number) =>
    setRecipe((r) => {
      const steps = [...r.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + by, 0, s!);
      return { ...r, steps };
    });

  const runPlan = () => runner.run({ recipe: recipe.steps.map((s) => ({ tool: s.tool, options: withDefaults(toolById.get(s.tool)!, s.options) })), output: recipe.output }, sel);
  const recipeTool: ToolDef = { id: "recipe", title: { en: "Recipe", fr: "Recette" }, summary: { en: "", fr: "" }, category: "transform", input: "image", fields: [] };

  return (
    <div className="tool-view">
      <header className="tool-head">
        <a href="#/" className="back">
          <Icon name="back" size={18} /> {t("Your photos", "Vos photos")}
        </a>
        <h1>{t("Recipe", "Recette")}</h1>
        <p className="lede">{t("Chain several steps and apply them to every selected photo in one go.", "Enchaînez plusieurs étapes et appliquez-les à toutes les photos sélectionnées d'un coup.")}</p>
      </header>
      <div className="tool-body">
        <div className="stage">
          {runner.outcomes ? (
            <Results tool={recipeTool} outcomes={runner.outcomes} onBack={runner.reset} />
          ) : (
            <ol className="steps">
              {recipe.steps.map((s, i) => {
                const def = toolById.get(s.tool)!;
                return (
                  <li key={i} className="step">
                    <div className="step-head">
                      <span className="step-no num">{i + 1}</span>
                      <select value={s.tool} onChange={(e) => setStep(i, { tool: e.currentTarget.value, options: withDefaults(toolById.get(e.currentTarget.value)!, {}) })} aria-label={t(`Step ${i + 1}`, `Étape ${i + 1}`)}>
                        {STEP_TOOLS.map((x) => (
                          <option key={x.id} value={x.id}>
                            {l(x.title)}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="icon-button" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label={t("Move up", "Monter")}>
                        <Icon name="back" size={17} />
                      </button>
                      <button type="button" className="icon-button" disabled={i === recipe.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label={t("Move down", "Descendre")}>
                        <Icon name="next" size={17} />
                      </button>
                      <button type="button" className="icon-button" onClick={() => setRecipe((r) => ({ ...r, steps: r.steps.filter((_, j) => j !== i) }))} aria-label={t("Remove this step", "Retirer cette étape")}>
                        <Icon name="trash" size={17} />
                      </button>
                    </div>
                    <FieldList fields={def.fields} options={withDefaults(def, s.options)} onChange={(n, v) => setStep(i, { ...s, options: { ...s.options, [n]: v } })} />
                  </li>
                );
              })}
              <li>
                <button type="button" className="secondary" onClick={() => setRecipe((r) => ({ ...r, steps: [...r.steps, { tool: "watermark", options: withDefaults(toolById.get("watermark")!, {}) }] }))}>
                  <Icon name="plus" /> {t("Add a step", "Ajouter une étape")}
                </button>
              </li>
            </ol>
          )}
        </div>
        <aside className="options">
          <h2 className="options-title">{t("Then save each photo", "Puis enregistrer chaque photo")}</h2>
          <div className="fields">
            <FieldList fields={OUTPUT_FIELDS.map((f) => ({ ...f, advanced: false }))} options={recipe.output} onChange={(n, v) => setRecipe((r) => ({ ...r, output: { ...r.output, [n]: v } }))} />
          </div>
          <div className="run">
            {all.length ? (
              <button type="button" className="primary run-button" disabled={!sel.length || !recipe.steps.length || runner.running} onClick={runPlan}>
                {t("Run the recipe", "Lancer la recette")} · {nPhotos(sel.length, lang)}
              </button>
            ) : (
              <DropMat compact />
            )}
            {runner.progress ? <p className="num note">{t(`${runner.progress.done} of ${runner.progress.total} done`, `${runner.progress.done} sur ${runner.progress.total} terminées`)}</p> : null}
            {sel.length ? <p className="note num">{fmtBytes(sel.reduce((n, p) => n + p.size, 0), lang)}</p> : null}
          </div>
          <div className="recipe-save">
            <label className="field">
              <span>{t("Recipe name", "Nom de la recette")}</span>
              <input type="text" value={recipe.name} onChange={(e) => setRecipe({ ...recipe, name: e.currentTarget.value })} />
            </label>
            <div className="row">
              <button type="button" className="secondary small" disabled={!recipe.name.trim()} onClick={() => setSaved((s) => [...s.filter((x) => x.name !== recipe.name), recipe])}>
                {t("Save", "Enregistrer")}
              </button>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  await navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/recipe?r=${encode(recipe)}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Icon name="copy" size={16} /> {copied ? t("Link copied", "Lien copié") : t("Copy a link", "Copier un lien")}
              </button>
            </div>
            <ul className="saved-recipes">
              {[...STARTERS, ...saved].map((r) => (
                <li key={r.name}>
                  <button type="button" className="link small" onClick={() => setRecipe(r)}>
                    {r.name}
                  </button>
                  <span className="muted small"> {r.steps.map((s) => l(toolById.get(s.tool)?.title ?? { en: s.tool, fr: s.tool })).join(" → ")}</span>
                  {saved.includes(r) ? (
                    <button type="button" className="icon-button" onClick={() => setSaved((s) => s.filter((x) => x !== r))} aria-label={t(`Delete ${r.name}`, `Supprimer ${r.name}`)}>
                      <Icon name="x" size={15} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
