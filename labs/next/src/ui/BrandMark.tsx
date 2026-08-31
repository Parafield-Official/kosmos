import { useState } from "react";

export function BrandMark() {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      className="brand-mark"
      data-open={open ? "true" : "false"}
      aria-label="Kosmos"
      aria-expanded={open}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className="brand-mark-glass" aria-hidden="true">
        <span className="brand-mark-fill" />
        <span className="liquid-refract" />
        <span className="liquid-spec" />
        <span className="brand-mark-rim" />
      </span>
      <span className="brand-mark-content">
        <span className="brand-mark-logo" aria-hidden="true" />
        <span className="brand-mark-name">Kosmos</span>
      </span>
    </button>
  );
}
