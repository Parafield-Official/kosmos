export function BrandMark() {
  return (
    <button
      type="button"
      className="brand-mark"
      aria-label="Kosmos"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
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
