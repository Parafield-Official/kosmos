import { useEffect, useState } from "react";
import {
  applyGlassLook,
  GLASS_LOOK_OPTIONS,
  lookFromValues,
  readStoredGlassLook,
  subscribeGlassTuning,
  type GlassLookId,
} from "./glass-tuning";

export function GlassLookSwitch({ compact = false }: { compact?: boolean }) {
  const [look, setLook] = useState<GlassLookId>(readStoredGlassLook);

  useEffect(() => {
    return subscribeGlassTuning((values) => {
      setLook(lookFromValues(values));
    });
  }, []);

  function choose(id: GlassLookId) {
    setLook(id);
    applyGlassLook(id);
  }

  return (
    <div className={compact ? "glass-look compact" : "glass-look"} role="group" aria-label="Glass">
      {GLASS_LOOK_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={look === option.id ? "on" : undefined}
          aria-pressed={look === option.id}
          onClick={() => choose(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
