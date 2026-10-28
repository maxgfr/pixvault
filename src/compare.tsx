// Before and after on one picture: drag the divider (or use the arrow keys)
// to wipe between them.

import { useEffect, useState } from "react";
import { useLang } from "./i18n.ts";

export function Compare({ before, after, alt }: { before: string; after?: string; alt: string }) {
  const { t } = useLang();
  const [at, setAt] = useState(50);
  useEffect(() => setAt(50), [before]);
  if (!after) {
    return (
      <figure className="compare">
        <div className="compare-frame">
          <img src={before} alt={alt} />
        </div>
      </figure>
    );
  }
  return (
    <figure className="compare">
      <div className="compare-frame" style={{ "--at": `${at}%` } as React.CSSProperties}>
        <img src={after} alt={alt} />
        <img src={before} alt="" className="compare-before" />
        <span className="compare-divider" />
        <span className="compare-tag compare-tag-before">{t("Before", "Avant")}</span>
        <span className="compare-tag compare-tag-after">{t("After", "Après")}</span>
        <input
        className="compare-handle"
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={at}
        onChange={(e) => setAt(Number(e.currentTarget.value))}
          aria-label={t("Before and after divider", "Séparation avant / après")}
        />
      </div>
    </figure>
  );
}
