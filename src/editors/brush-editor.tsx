// Paint over what to erase. The strokes become a mask image (white where
// painted) that the worker scales to the photo.

import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n.ts";

export function BrushEditor({ src, onMask }: { src: string; onMask: (png: Uint8Array | undefined) => void }) {
  const { t } = useLang();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(4);
  const [painted, setPainted] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = canvas.current;
      // The same photo again (a refreshed preview): keep what was painted.
      if (!c || (c.width === img.naturalWidth && c.height === img.naturalHeight)) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      setPainted(false);
      onMask(undefined);
    };
    img.src = src;
  }, [src]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const b = c.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height };
  };
  const stroke = (to: { x: number; y: number }) => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "rgb(255 255 255)";
    ctx.fillStyle = "rgb(255 255 255)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = (size / 100) * Math.max(c.width, c.height);
    const from = last.current ?? to;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    last.current = to;
  };
  const finish = () => {
    last.current = null;
    canvas.current?.toBlob(async (b) => b && onMask(new Uint8Array(await b.arrayBuffer())), "image/png");
  };

  return (
    <div className="brush-editor">
      <div className="brush-stage">
        <img src={src} alt="" draggable={false} />
        <canvas
          ref={canvas}
          aria-label={t("Paint over what to erase", "Peignez sur ce qu'il faut effacer")}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setPainted(true);
            stroke(point(e));
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) stroke(point(e));
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
      <div className="row">
        <label className="field brush-size">
          <span>{t("Brush", "Pinceau")}</span>
          <input type="range" min={1} max={15} step={0.5} value={size} onChange={(e) => setSize(Number(e.currentTarget.value))} />
        </label>
        <button
          type="button"
          className="link small"
          disabled={!painted}
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setPainted(false);
            onMask(undefined);
          }}
        >
          {t("Start over", "Recommencer")}
        </button>
      </div>
      <p className="note">{t("Paint over a passer-by, a wire or a blemish, a little wider than the object, then run Erase.", "Peignez sur un passant, un câble ou une imperfection, un peu plus large que l'objet, puis lancez Effacer.")}</p>
    </div>
  );
}
