import { useEffect, useState } from "react";
import {
  applyGlassLook,
  DEFAULT_GLASS_LOOK,
  formatGlassTuningExport,
  GLASS_TUNING_GROUPS,
  publishGlassTuning,
  readStoredGlassTuning,
  subscribeGlassTuning,
  syncMaterialFields,
  type GlassTuningValues,
  type TuningField,
} from "./glass-tuning";
import { GlassLookSwitch } from "./GlassLookSwitch";

export function GlassTuner({ standalone = false }: { standalone?: boolean }) {
  const [values, setValues] = useState<GlassTuningValues>(() => syncMaterialFields(readStoredGlassTuning()));
  const [copied, setCopied] = useState(false);
  const native = Boolean(window.kosmosNext);

  useEffect(() => {
    return subscribeGlassTuning((next) => {
      setValues(syncMaterialFields(next));
    });
  }, []);

  function setField(id: string, value: string) {
    setValues((current) => {
      const next = id === "glassBlur" ? syncMaterialFields({ ...current, [id]: value }) : { ...current, [id]: value };
      publishGlassTuning(next);
      return next;
    });
  }

  function resetDefaults() {
    applyGlassLook(DEFAULT_GLASS_LOOK);
  }

  async function copyValues() {
    const text = formatGlassTuningExport(values);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const panel = (
    <>
      <header className={standalone ? "tuner-shell-head" : "tuner-head"}>
        <strong>Glass</strong>
        <div className="tuner-actions">
          <button type="button" onClick={resetDefaults}>
            Reset
          </button>
          <button type="button" onClick={() => void copyValues()}>
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
      </header>

      {standalone ? (
        <p className="tuner-shell-note">
          Author looks: Frosted is max etch (48px). Transparent is clear liquid glass with edge refraction.
        </p>
      ) : null}

      <div className="tuner-look">
        <GlassLookSwitch compact />
      </div>

      <div className="tuner-scroll">
        {GLASS_TUNING_GROUPS.map((group) => (
          <section key={group.id} className="tuner-group">
            <h3>{group.title}</h3>
            {group.description ? <p className="tuner-group-desc">{group.description}</p> : null}
            {group.fields.map((field) => {
              if (field.kind === "select" && field.electronOnly && !native) {
                return null;
              }
              if ("hostedOnly" in field && field.hostedOnly && native) {
                return null;
              }
              if ("nativeOnly" in field && field.nativeOnly && !native) {
                return null;
              }
              return (
                <FieldRow
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? field.default}
                  onChange={(value) => setField(field.id, value)}
                />
              );
            })}
          </section>
        ))}
      </div>
    </>
  );

  if (standalone) {
    return <div className="tuner-shell">{panel}</div>;
  }

  return (
    <div className="tuner open">
      <div className="tuner-panel" role="region" aria-label="Glass tuning">
        {panel}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: TuningField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === "select") {
    return (
      <label className="tuner-field">
        <span className="tuner-name">{field.label}</span>
        {"hint" in field && field.hint ? <span className="tuner-hint">{field.hint}</span> : null}
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="tuner-field">
      <span className="tuner-name">{field.label}</span>
      {"hint" in field && field.hint ? <span className="tuner-hint">{field.hint}</span> : null}
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="tuner-value">
        {value}
        {field.unit ?? ""}
      </span>
    </label>
  );
}
