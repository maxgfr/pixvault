// How the promise is kept, and what pixvault cannot do.

import { useLang } from "./i18n.ts";

const CREDITS: [string, string, string][] = [
  ["MozJPEG, libwebp, libavif, libjxl, OxiPNG, QOI, resize", "Squoosh / jSquash", "Apache-2.0"],
  ["libheif", "struktur AG (libheif-js)", "LGPL-3.0"],
  ["UTIF", "Photopea (utif2)", "MIT"],
  ["exifr", "Mike Kovařík", "MIT"],
  ["gifenc, omggif", "Matt DesLauriers, Dean McNamee", "MIT"],
  ["pdf-lib", "Andrew Dillon", "MIT"],
  ["fflate", "Arjun Barrett", "MIT"],
  ["React", "Meta", "MIT"],
];

export function Privacy() {
  const { t } = useLang();
  return (
    <article className="prose">
      <h1>{t("Privacy", "Confidentialité")}</h1>
      <section>
        <h2>{t("Nothing is uploaded", "Rien n'est envoyé")}</h2>
        <p>
          {t(
            "pixvault is a static page. Your photos are read by this browser tab and processed by WebAssembly code running in it; the results are made in memory and handed back to you. There is no server that could receive them, and no account.",
            "pixvault est une page statique. Vos photos sont lues par cet onglet et traitées par du code WebAssembly qui y tourne ; les résultats sont fabriqués en mémoire et vous sont rendus. Il n'existe aucun serveur qui pourrait les recevoir, ni de compte.",
          )}
        </p>
      </section>
      <section>
        <h2>{t("The browser enforces it", "Le navigateur y veille")}</h2>
        <p>
          {t(
            "The page ships a Content Security Policy that only allows connections to its own address, and Trusted Types for scripts. Every build is checked in CI: it fails if any bundle contains an outside address it could call. The deployed files carry a signed build provenance attestation.",
            "La page embarque une politique de sécurité de contenu (CSP) qui n'autorise que les connexions vers sa propre adresse, et des Trusted Types pour les scripts. Chaque build est vérifié en intégration continue : il échoue si un fichier contient une adresse extérieure qu'il pourrait appeler. Les fichiers déployés portent une attestation de provenance signée.",
          )}
        </p>
      </section>
      <section>
        <h2>{t("Works offline", "Marche hors ligne")}</h2>
        <p>{t("After the first visit, the app and its everyday codecs are cached; you can install it and use it in airplane mode.", "Après la première visite, l'application et ses codecs courants sont en cache : vous pouvez l'installer et l'utiliser en mode avion.")}</p>
      </section>
      <section>
        <h2>{t("What stays on this device", "Ce qui reste sur cet appareil")}</h2>
        <p>
          {t(
            "Your photos are kept in memory only and disappear when you close or reload the tab. pixvault remembers your language and saved recipes in this browser's storage, and AI models you chose to download in its cache, until you remove them.",
            "Vos photos ne sont gardées qu'en mémoire et disparaissent quand vous fermez ou rechargez l'onglet. pixvault retient votre langue et vos recettes dans le stockage de ce navigateur, et les modèles d'IA que vous avez choisi de télécharger dans son cache, jusqu'à ce que vous les supprimiez.",
          )}
        </p>
      </section>
      <section>
        <h2>{t("Limits", "Limites")}</h2>
        <ul>
          <li>{t("RAW files are read through the full-size JPEG preview the camera embeds in them, not by developing the sensor data.", "Les fichiers RAW sont lus via l'aperçu JPEG pleine taille que l'appareil y intègre, sans développer les données du capteur.")}</li>
          <li>{t("Re-encoded photos keep their details (date, camera, optionally location) in JPEG, PNG and WebP; AVIF and JPEG XL outputs carry none.", "Les photos ré-encodées gardent leurs infos (date, appareil, éventuellement position) en JPEG, PNG et WebP ; les sorties AVIF et JPEG XL n'en portent aucune.")}</li>
          <li>{t("Very large images (over 160 megapixels) are refused: a browser tab does not have the memory for them.", "Les très grandes images (plus de 160 mégapixels) sont refusées : un onglet n'a pas la mémoire nécessaire.")}</li>
          <li>{t("Colours are converted to sRGB when a photo is re-encoded.", "Les couleurs sont converties en sRGB quand une photo est ré-encodée.")}</li>
        </ul>
      </section>
      <section>
        <h2>{t("Open source", "Code source ouvert")}</h2>
        <p>
          {t("pixvault is MIT-licensed. ", "pixvault est sous licence MIT. ")}
          <a href="https://github.com/maxgfr/pixvault" rel="noopener noreferrer">
            github.com/maxgfr/pixvault
          </a>
        </p>
        <table className="credits">
          <thead>
            <tr>
              <th>{t("Component", "Composant")}</th>
              <th>{t("By", "Par")}</th>
              <th>{t("Licence", "Licence")}</th>
            </tr>
          </thead>
          <tbody>
            {CREDITS.map(([what, who, lic]) => (
              <tr key={what}>
                <td>{what}</td>
                <td>{who}</td>
                <td>{lic}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </article>
  );
}
