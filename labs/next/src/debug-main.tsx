import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PLACES, placeLabel, type Place } from "./flow";
import "./debug.css";

function jump(place: Place) {
  void window.kosmosNext?.jump?.(place);
}

async function resetAccess() {
  try {
    await window.kosmosNext?.resetAccess?.();
  } catch {
    // Older Electron builds may not have the handler yet.
  }
}

function DebugPalette() {
  const [place, setPlace] = useState<Place>("mark");

  useEffect(() => {
    return window.kosmosNext?.onPlace?.((next) => {
      setPlace(next);
    });
  }, []);

  return (
    <div className="debug-palette">
      <p className="debug-palette-drag">debug</p>
      <div className="debug-list" role="group" aria-label="Jump">
        {PLACES.map((item) => (
          <button
            key={item}
            type="button"
            className={item === place ? "on" : undefined}
            aria-current={item === place ? "page" : undefined}
            onClick={() => jump(item)}
          >
            {placeLabel(item)}
          </button>
        ))}
      </div>
      <div className="debug-dev" role="group" aria-label="Dev tools">
        <button type="button" className="debug-dev-action" onClick={() => void resetAccess()}>
          reset access
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Debug root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <DebugPalette />
  </StrictMode>,
);
