import { useEffect, type ReactNode } from "react";

/** Glass sheet over the chapter booth. Escape and the scrim both close it. */
export function BoothSheet({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="booth-sheet-scrim" onClick={onClose} role="presentation">
      <div
        className={`booth-sheet${wide ? " is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booth-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="booth-sheet-head">
          <h2 id="booth-sheet-title">{title}</h2>
          <button type="button" className="booth-sheet-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="booth-sheet-body">{children}</div>
      </div>
    </div>
  );
}
