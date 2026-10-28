// One form control per catalog field kind, labelled in the current language.

import { useId, useRef } from "react";
import type { Field, OptionValue, Options } from "./tools/types.ts";
import { useLang } from "./i18n.ts";

export const visible = (f: Field, o: Options) => !f.when || f.when.is.includes(o[f.when.field] as string | number | boolean);

export function FieldInput({ field: f, value, onChange }: { field: Field; value: OptionValue; onChange: (v: OptionValue) => void }) {
  const { l, t } = useLang();
  const id = useId();
  const help = f.help ? <p className="help" id={`${id}-help`}>{l(f.help)}</p> : null;
  const described = f.help ? `${id}-help` : undefined;
  const fileName = useRef<string>("");

  if (f.kind === "boolean") {
    return (
      <div className="field field-check">
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.currentTarget.checked)} aria-describedby={described} />
        <label htmlFor={id}>{l(f.label)}</label>
        {help}
      </div>
    );
  }

  let control: React.ReactNode;
  switch (f.kind) {
    case "select":
      control = (
        <select id={id} value={String(value ?? f.default)} onChange={(e) => onChange(e.currentTarget.value)} aria-describedby={described}>
          {f.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {l(c.label)}
            </option>
          ))}
        </select>
      );
      break;
    case "range": {
      const v = typeof value === "number" ? value : f.default;
      control = (
        <div className="range">
          <input
            id={id}
            type="range"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.currentTarget.value))}
            onDoubleClick={() => onChange(f.default)}
            aria-describedby={described}
            aria-valuetext={`${v}${f.unit ?? ""}`}
          />
          <output htmlFor={id} className="num">
            {v > 0 && f.min < 0 ? "+" : ""}
            {v}
            {f.unit ? <span className="unit">{f.unit}</span> : null}
          </output>
        </div>
      );
      break;
    }
    case "number":
      control = (
        <div className="with-unit">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={typeof value === "number" ? value : ""}
            placeholder={f.placeholder ? l(f.placeholder) : undefined}
            onChange={(e) => onChange(e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value))}
            aria-describedby={described}
          />
          {f.unit ? <span className="unit">{f.unit}</span> : null}
        </div>
      );
      break;
    case "color":
      control = (
        <div className="color">
          <input id={id} type="color" value={String(value ?? f.default)} onChange={(e) => onChange(e.currentTarget.value)} aria-describedby={described} />
          <code>{String(value ?? f.default)}</code>
        </div>
      );
      break;
    case "textarea":
      control = <textarea id={id} rows={3} value={String(value ?? "")} placeholder={f.placeholder ? l(f.placeholder) : undefined} onChange={(e) => onChange(e.currentTarget.value)} aria-describedby={described} />;
      break;
    case "file":
      control = (
        <div className="file-field">
          <input
            id={id}
            type="file"
            accept={f.accept}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              fileName.current = file?.name ?? "";
              onChange(file ? new Uint8Array(await file.arrayBuffer()) : undefined);
            }}
            aria-describedby={described}
          />
          {value instanceof Uint8Array ? <span className="note">{t("Loaded", "Chargé")}</span> : null}
        </div>
      );
      break;
    default:
      control = <input id={id} type="text" value={String(value ?? "")} placeholder={f.placeholder ? l(f.placeholder) : undefined} onChange={(e) => onChange(e.currentTarget.value)} aria-describedby={described} />;
  }
  return (
    <div className={`field field-${f.kind}`}>
      <label htmlFor={id}>{l(f.label)}</label>
      {control}
      {help}
    </div>
  );
}

/** The fields of a tool: the main ones, then "More options". */
export function FieldList({ fields, options, onChange }: { fields: Field[]; options: Options; onChange: (name: string, v: OptionValue) => void }) {
  const { t } = useLang();
  const shown = fields.filter((f) => visible(f, options));
  const main = shown.filter((f) => !f.advanced);
  const more = shown.filter((f) => f.advanced);
  return (
    <>
      {main.length ? (
        <div className="fields">
          {main.map((f) => (
            <FieldInput key={f.name} field={f} value={options[f.name]} onChange={(v) => onChange(f.name, v)} />
          ))}
        </div>
      ) : null}
      {more.length ? (
        <details className="more">
          <summary>{t("More options", "Plus d'options")}</summary>
          <div className="fields">
            {more.map((f) => (
              <FieldInput key={f.name} field={f} value={options[f.name]} onChange={(v) => onChange(f.name, v)} />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

/** Required fields still empty, by label. */
export function missing(fields: Field[], o: Options): Field[] {
  return fields.filter((f) => visible(f, o) && "required" in f && f.required && (o[f.name] === undefined || o[f.name] === ""));
}
