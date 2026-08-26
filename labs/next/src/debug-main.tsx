import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PLACES, type Place } from "./flow";
import "./debug.css";

function jump(place: Place) {
  window.kosmosNext?.jump?.(place);
}

function DebugPalette() {
  return (
    <div className="debug-palette">
      <p className="debug-palette-drag">debug</p>
      <div className="debug-list" role="group" aria-label="Jump">
        {PLACES.map((item) => (
          <button key={item} type="button" onClick={() => jump(item)}>
            {item === "app" ? "main app" : item === "welcome" ? "video" : item}
          </button>
        ))}
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
