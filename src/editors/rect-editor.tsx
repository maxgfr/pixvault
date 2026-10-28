// Draw, move and resize rectangles over a photo, in percent of its size so
// the same areas apply to every photo of a batch. Crop uses one rectangle
// (optionally held to a ratio); redact uses as many as needed.

import { useRef, useState } from "react";
import { useLang } from "../i18n.ts";

export interface PRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Drag = { mode: "new" | "move" | "nw" | "ne" | "sw" | "se"; index: number; start: { x: number; y: number }; orig: PRect };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Keep a rectangle inside 0–100 and, when asked, at `ratio` (width/height in pixels). */
function fit(r: PRect, ratio: number | null, aspect: number, anchor: "nw" | "ne" | "sw" | "se" = "se"): PRect {
  let { x, y, w, h } = r;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  if (ratio) {
    // In percent units a pixel ratio becomes ratio / aspect.
    const pr = ratio / aspect;
    if (w / h > pr) w = h * pr;
    else h = w / pr;
    if (anchor === "nw" || anchor === "sw") x = r.x + r.w - w;
    if (anchor === "nw" || anchor === "ne") y = r.y + r.h - h;
  }
  w = clamp(w, 1, 100);
  h = clamp(h, 1, 100);
  return { x: clamp(x, 0, 100 - w), y: clamp(y, 0, 100 - h), w, h };
}

export function RectEditor({
  src,
  aspect,
  rects,
  onChange,
  multiple,
  ratio,
  shade,
}: {
  src: string;
  /** The photo's width / height. */
  aspect: number;
  rects: PRect[];
  onChange: (r: PRect[]) => void;
  multiple: boolean;
  ratio: number | null;
  /** Darken outside the rectangle (crop) instead of tinting inside (redact). */
  shade: boolean;
}) {
  const { t } = useLang();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [active, setActive] = useState(0);

  const at = (e: React.PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - b.left) / b.width) * 100, 0, 100), y: clamp(((e.clientY - b.top) / b.height) * 100, 0, 100) };
  };

  const down = (e: React.PointerEvent, mode: Drag["mode"], index: number) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = at(e);
    if (mode === "new") {
      const next = multiple ? [...rects, { x: p.x, y: p.y, w: 0.01, h: 0.01 }] : [{ x: p.x, y: p.y, w: 0.01, h: 0.01 }];
      index = next.length - 1;
      onChange(next);
      setDrag({ mode, index, start: p, orig: next[index]! });
    } else setDrag({ mode, index, start: p, orig: rects[index]! });
    setActive(index);
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = at(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const o = drag.orig;
    let r: PRect;
    switch (drag.mode) {
      case "move":
        r = { ...o, x: clamp(o.x + dx, 0, 100 - o.w), y: clamp(o.y + dy, 0, 100 - o.h) };
        break;
      case "new":
      case "se":
        r = fit({ x: o.x, y: o.y, w: o.w + dx, h: o.h + dy }, ratio, aspect, "se");
        break;
      case "nw":
        r = fit({ x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy }, ratio, aspect, "nw");
        break;
      case "ne":
        r = fit({ x: o.x, y: o.y + dy, w: o.w + dx, h: o.h - dy }, ratio, aspect, "ne");
        break;
      case "sw":
        r = fit({ x: o.x + dx, y: o.y, w: o.w - dx, h: o.h + dy }, ratio, aspect, "sw");
        break;
    }
    onChange(rects.map((x, i) => (i === drag.index ? r : x)));
  };

  const up = () => {
    if (drag?.mode === "new") {
      const r = rects[drag.index];
      // A click without a drag draws nothing.
      if (r && (r.w < 1.5 || r.h < 1.5)) onChange(rects.filter((_, i) => i !== drag.index));
    }
    setDrag(null);
  };

  const key = (e: React.KeyboardEvent, i: number) => {
    const r = rects[i]!;
    const step = e.altKey ? 0.2 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (d[e.key]) {
      e.preventDefault();
      const [dx, dy] = d[e.key]!;
      const next = e.shiftKey ? fit({ ...r, w: r.w + dx, h: r.h + dy }, ratio, aspect) : { ...r, x: clamp(r.x + dx, 0, 100 - r.w), y: clamp(r.y + dy, 0, 100 - r.h) };
      onChange(rects.map((x, j) => (j === i ? next : x)));
    } else if ((e.key === "Delete" || e.key === "Backspace") && multiple) {
      e.preventDefault();
      onChange(rects.filter((_, j) => j !== i));
    }
  };

  return (
    <div className="rect-editor" data-shade={shade ? "" : undefined}>
      <div ref={box} className="rect-stage" style={{ aspectRatio: String(aspect), "--aspect": String(aspect) } as React.CSSProperties} onPointerDown={(e) => down(e, "new", -1)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={src} alt="" draggable={false} />
        {shade && rects[0] ? <div className="rect-shade" style={{ "--x": `${rects[0].x}%`, "--y": `${rects[0].y}%`, "--w": `${rects[0].w}%`, "--h": `${rects[0].h}%` } as React.CSSProperties} /> : null}
        {rects.map((r, i) => (
          <div
            key={i}
            className="rect"
            data-active={i === active ? "" : undefined}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
            tabIndex={0}
            role="group"
            aria-label={t(`Area ${i + 1}: arrows move, Shift+arrows resize${multiple ? ", Delete removes" : ""}`, `Zone ${i + 1} : flèches pour déplacer, Maj+flèches pour redimensionner${multiple ? ", Suppr pour retirer" : ""}`)}
            onKeyDown={(e) => key(e, i)}
            onFocus={() => setActive(i)}
            onPointerDown={(e) => down(e, "move", i)}
          >
            {(["nw", "ne", "sw", "se"] as const).map((h) => (
              <span key={h} className={`handle handle-${h}`} onPointerDown={(e) => down(e, h, i)} />
            ))}
          </div>
        ))}
      </div>
      <p className="note">
        {multiple
          ? t("Drag on the photo to draw an area to hide. The same areas apply to every selected photo.", "Glissez sur la photo pour tracer une zone à masquer. Les mêmes zones s'appliquent à toutes les photos sélectionnées.")
          : t("Drag to draw the frame, then move or resize it. It applies to every selected photo, in proportion.", "Glissez pour tracer le cadre, puis déplacez-le ou redimensionnez-le. Il s'applique à toutes les photos sélectionnées, en proportion.")}
        {multiple && rects.length ? (
          <button type="button" className="link small" onClick={() => onChange([])}>
            {t("Clear all areas", "Effacer toutes les zones")}
          </button>
        ) : null}
      </p>
    </div>
  );
}
