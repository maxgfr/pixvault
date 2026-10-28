import { lazy, Suspense, useEffect, useState } from "react";
import { takeShared } from "./files.ts";
import { Home, usePaste } from "./home.tsx";
import { setLang, useLang } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { Privacy } from "./privacy.tsx";
import { RecipePage } from "./recipe.tsx";
import { ToolView } from "./tool-view.tsx";
import { toolById } from "./tools/index.ts";
import { usePhotos, workspace } from "./workspace.ts";

// The AI settings page carries the provider SDKs: loaded only when opened.
const AiPage = lazy(() => import("./ai-page.tsx").then((m) => ({ default: m.AiPage })));

function useRoute(): string {
  const get = () => location.hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
      document.getElementById("main")?.focus({ preventScroll: true });
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

function useOffline(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.ready.then(() => setReady(true));
  }, []);
  return ready;
}

export function App() {
  const route = useRoute();
  const { l, t, lang } = useLang();
  const photos = usePhotos();
  const offline = useOffline();
  const tool = toolById.get(route);
  usePaste();

  useEffect(() => {
    if (location.hash.includes("shared")) void takeShared().then((files) => (files.length ? workspace.add(files) : undefined));
  }, []);

  useEffect(() => {
    const name = tool ? l(tool.title) : route === "privacy" ? t("Privacy", "Confidentialité") : route === "recipe" ? t("Recipe", "Recette") : route === "ai" ? t("AI", "IA") : "";
    document.title = name ? `${name} · pixvault` : t("pixvault: private photo tools", "pixvault : outils photo privés");
  }, [tool, route, lang]);

  return (
    <>
      <a className="skip" href="#main">
        {t("Skip to content", "Aller au contenu")}
      </a>
      <header className="bar">
        <a href="#/" className="brand" aria-label={t("pixvault, your photos", "pixvault, vos photos")}>
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <rect x="2" y="2" width="28" height="28" rx="3" className="brand-mat" />
            <path d="M9 9h14v14H9z" className="brand-window" />
            <path d="M9 9l3 3h8l3-3M9 23l3-3h8l3 3M9 9l3 3v8l-3 3M23 9l-3 3v8l3 3" className="brand-bevel" />
          </svg>
          <span>pixvault</span>
        </a>
        <nav aria-label={t("Main", "Principale")}>
          <a href="#/" aria-current={route === "" ? "page" : undefined}>
            <Icon name="image" size={18} /> <span className="nav-label">{t("Your photos", "Vos photos")}</span>
            {photos.length ? <span className="count num">{photos.length}</span> : null}
          </a>
          <a href="#/recipe" aria-current={route === "recipe" ? "page" : undefined}>
            <Icon name="layers" size={18} /> <span className="nav-label">{t("Recipes", "Recettes")}</span>
          </a>
          <a href="#/ai" aria-current={route === "ai" ? "page" : undefined}>
            <Icon name="ai" size={18} /> <span className="nav-label">{t("AI", "IA")}</span>
          </a>
          <a href="#/privacy" aria-current={route === "privacy" ? "page" : undefined}>
            <Icon name="shield" size={18} /> <span className="nav-label">{t("Privacy", "Confidentialité")}</span>
          </a>
          <div className="lang" role="group" aria-label={t("Language", "Langue")}>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">
              EN
            </button>
            <button type="button" aria-pressed={lang === "fr"} onClick={() => setLang("fr")} lang="fr">
              FR
            </button>
          </div>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {tool ? <ToolView key={tool.id} tool={tool} /> : route === "privacy" ? <Privacy /> : route === "recipe" ? <RecipePage /> : route === "ai" ? (
          <Suspense fallback={<p className="note">…</p>}>
            <AiPage />
          </Suspense>
        ) : (
          <Home />
        )}
      </main>
      <footer className="foot">
        <p>
          <Icon name="shield" size={16} /> {t("Your photos stay on this device.", "Vos photos restent sur cet appareil.")}
          {offline ? <span className="pill">{t("Available offline", "Disponible hors ligne")}</span> : null}
        </p>
        <p>
          <a href="https://github.com/maxgfr/pixvault" rel="noopener noreferrer">
            {t("Source code", "Code source")}
          </a>{" "}
          · MIT · {t("Sibling of", "Cousin de")}{" "}
          <a href="https://maxgfr.github.io/pdfvault/" rel="noopener noreferrer">
            pdfvault
          </a>
        </p>
      </footer>
    </>
  );
}
