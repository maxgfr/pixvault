// Before an AI tool runs the first time: what will be downloaded, from
// where, how big, under which licence, and the user's go-ahead.

import { useState } from "react";
import { MODELS, type ModelId, modelBytes } from "../ai/catalog.ts";
import { download } from "../ai/download.ts";
import { bytes, useLang } from "../i18n.ts";
import { Icon } from "../icons.tsx";

export function ModelGate({ id }: { id: ModelId }) {
  const { l, t, lang } = useLang();
  const m = MODELS[id];
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const size = bytes(modelBytes(m), lang);
  return (
    <div className="model-gate">
      <Icon name="ai" size={28} />
      <h2>{t("This tool runs an AI model on your device", "Cet outil fait tourner un modèle d'IA sur votre appareil")}</h2>
      <p>
        <strong>{l(m.label)}</strong> · {m.licence} · {m.credit}
      </p>
      <p className="note">
        {m.host === "site"
          ? t(`${size}, downloaded once from this site and kept in this browser. Your photos never leave the device.`, `${size}, téléchargé une fois depuis ce site et gardé dans ce navigateur. Vos photos ne quittent jamais l'appareil.`)
          : t(`${size}, downloaded once from Hugging Face (the model's official host) and kept in this browser. Your photos never leave the device.`, `${size}, téléchargé une fois depuis Hugging Face (l'hébergeur officiel du modèle) et gardé dans ce navigateur. Vos photos ne quittent jamais l'appareil.`)}
      </p>
      {progress !== null ? (
        <div className="progress" role="status">
          <div className="progress-bar">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="num">
            {t("Downloading", "Téléchargement")} · {Math.round(progress * 100)} %
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="primary"
          onClick={async () => {
            setError("");
            setProgress(0);
            try {
              await download(id, (d, n) => setProgress(d / n));
            } catch (e) {
              setError(t(`The download failed (${(e as Error).message}). Check your connection and try again.`, `Le téléchargement a échoué (${(e as Error).message}). Vérifiez votre connexion et réessayez.`));
            }
            setProgress(null);
          }}
        >
          <Icon name="download" /> {t(`Download ${size} and continue`, `Télécharger ${size} et continuer`)}
        </button>
      )}
      {error ? <p className="error-text">{error}</p> : null}
      <p className="note">
        <a href="#/ai">{t("Manage AI models", "Gérer les modèles d'IA")}</a>
      </p>
    </div>
  );
}
