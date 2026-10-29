// Before and after on one picture: drag anywhere on it (or use the arrow keys)
// to wipe between them.

import { useEffect, useRef, useState } from "react";
import { useLang } from "./i18n.ts";

export function Compare({ before, after, alt }: { before: string; after?: string; alt: string }) {
  const { t } = useLang();
  const [at, setAt] = useState(50);
  const handle = useRef<HTMLInputElement>(null);
  useEffect(() => setAt(50), [before]);
  // The divider follows the pointer from wherever the drag starts; the range input under it is for the keyboard.
  const follow = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.querySelector("img")!.getBoundingClientRect();
    setAt(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
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
      <div
        className="compare-frame compare-live"
        style={{ "--at": `${at}%` } as React.CSSProperties}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          handle.current?.focus({ preventScroll: true });
          follow(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && follow(e)}
      >
        <img src={after} alt={alt} draggable={false} />
        <img src={before} alt="" className="compare-before" draggable={false} />
        <span className="compare-divider" />
        <span className="compare-tag compare-tag-before">{t("Before", "Avant")}</span>
        <span className="compare-tag compare-tag-after">{t("After", "Après")}</span>
        <input
          ref={handle}
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
