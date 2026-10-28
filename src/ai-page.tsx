// AI settings: the on-device models (download, size, licence, remove) and,
// optionally, the user's own AI provider for descriptions.

import "./ai/zod-jitless.ts";
import { useLlmSettings } from "llm-connect/react";
import { useEffect, useState } from "react";
import { llm, loadLlm } from "./ai/byok.ts";
import { backgroundModel, MODELS, type ModelId, modelBytes } from "./ai/catalog.ts";
import { download, removeModel, useDownloaded, useGpu } from "./ai/download.ts";
import { bytes, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";

function ModelRow({ id }: { id: ModelId }) {
  const { l, t, lang } = useLang();
  const m = MODELS[id];
  const have = useDownloaded(id);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  return (
    <li className="model-row">
      <div>
        <p className="result-name">{l(m.label)}</p>
        <p className="label-line num">
          {bytes(modelBytes(m), lang)} · {m.licence} · {m.credit} · {m.host === "site" ? t("served by this site", "servi par ce site") : "Hugging Face"}
        </p>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
      <div className="row">
        {progress !== null ? (
          <span className="num note">{Math.round(progress * 100)} %</span>
        ) : have ? (
          <>
            <span className="ok-line small">
              <Icon name="check" size={16} /> {t("On this device", "Sur cet appareil")}
            </span>
            <button type="button" className="link small" onClick={() => void removeModel(id)}>
              {t("Remove", "Supprimer")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary small"
            onClick={async () => {
              setError("");
              setProgress(0);
              try {
                await download(id, (d, n) => setProgress(d / n));
              } catch (e) {
                setError(t(`Download failed: ${(e as Error).message}`, `Échec du téléchargement : ${(e as Error).message}`));
              }
              setProgress(null);
            }}
          >
            <Icon name="download" size={16} /> {t("Download", "Télécharger")}
          </button>
        )}
      </div>
    </li>
  );
}

function Provider() {
  const { t } = useLang();
  const s = useLlmSettings(llm);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void loadLlm().then(() => llm.open());
  }, []);
  const providers = [...s.providers.recommended, ...s.providers.others];
  return (
    <section className="provider">
      <h2>{t("Your AI provider (optional)", "Votre fournisseur d'IA (facultatif)")}</h2>
      <p className="note">
        {t(
          "Only for “Describe and tag”, as an alternative to the model on your device. With a key, each photo you describe is sent, reduced to 1024 px, to the provider you choose, and nothing else. The key is encrypted in this browser.",
          "Uniquement pour « Décrire et étiqueter », à la place du modèle sur votre appareil. Avec une clé, chaque photo décrite est envoyée, réduite à 1024 px, au fournisseur choisi, et rien d'autre. La clé est chiffrée dans ce navigateur.",
        )}
      </p>
      <div className="fields">
        <label className="field">
          <span>{t("Provider", "Fournisseur")}</span>
          <select value={s.draft.providerId} onChange={(e) => llm.selectProvider(e.currentTarget.value)}>
            <option value="">{t("Choose…", "Choisir…")}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {s.provider ? (
          <label className="field">
            <span>{t("Model", "Modèle")}</span>
            <select value={s.draft.model} onChange={(e) => llm.selectModel(e.currentTarget.value)}>
              {s.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("API key", "Clé d'API")}</span>
          <input type="password" autoComplete="off" spellCheck={false} value={s.apiKey} onChange={(e) => llm.setApiKey(e.currentTarget.value)} />
        </label>
        <div className="field-check field">
          <input id="remember-key" type="checkbox" checked={s.draft.rememberKey} onChange={(e) => llm.setRememberKey(e.currentTarget.checked)} />
          <label htmlFor="remember-key">{t("Remember the key on this device (encrypted)", "Retenir la clé sur cet appareil (chiffrée)")}</label>
        </div>
      </div>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={!s.canTest || s.testing}
          onClick={async () => {
            const r = await llm.test();
            setStatus(r.ok ? t("The connection works.", "La connexion fonctionne.") : t(`Connection failed: ${r.message ?? r.reason}`, `Échec de la connexion : ${r.message ?? r.reason}`));
          }}
        >
          {s.testing ? t("Testing…", "Test…") : t("Test", "Tester")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!s.canSave}
          onClick={async () => {
            const r = await llm.save();
            setStatus(r.ok ? t("Saved.", "Enregistré.") : t("Some settings are missing or invalid.", "Des réglages manquent ou sont invalides."));
          }}
        >
          {t("Save", "Enregistrer")}
        </button>
        {s.saved ? (
          <button type="button" className="link" onClick={() => void llm.clear().then(() => setStatus(t("Removed.", "Supprimé.")))}>
            {t("Forget this provider", "Oublier ce fournisseur")}
          </button>
        ) : null}
      </div>
      <p className="note" role="status">
        {status}
      </p>
    </section>
  );
}

export function AiPage() {
  const { t } = useLang();
  const gpu = useGpu();
  const webgpu = gpu ? gpu.f16 : null;
  return (
    <article className="prose ai-page">
      <h1>{t("AI on your device", "IA sur votre appareil")}</h1>
      <p>
        {t(
          "The AI tools run open models in this tab. Each one is downloaded once, when you first use it, checked against its fingerprint and kept in this browser until you remove it.",
          "Les outils d'IA font tourner des modèles ouverts dans cet onglet. Chacun est téléchargé une fois, à la première utilisation, vérifié par son empreinte et gardé dans ce navigateur jusqu'à ce que vous le supprimiez.",
        )}
      </p>
      <p className="note">
        {webgpu === null
          ? ""
          : webgpu
            ? t("This browser has full WebGPU: the models run on the graphics card.", "Ce navigateur a WebGPU complet : les modèles tournent sur la carte graphique.")
            : t("This browser lacks full WebGPU (with half precision): the models run on the processor, more slowly.", "Ce navigateur n'a pas WebGPU complet (demi-précision) : les modèles tournent sur le processeur, plus lentement.")}{" "}
        {gpu && backgroundModel(gpu) === "background-lite"
          ? t("Background removal uses MODNet here (best on people): BiRefNet needs a graphics card this browser does not expose.", "Le détourage utilise ici MODNet (idéal pour les personnes) : BiRefNet demande une carte graphique que ce navigateur n'expose pas.")
          : ""}
      </p>
      <ul className="model-rows">
        {(Object.keys(MODELS) as ModelId[]).map((id) => (
          <ModelRow key={id} id={id} />
        ))}
      </ul>
      <Provider />
    </article>
  );
}
