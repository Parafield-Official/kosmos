import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyGlassTuning, applyNativeMaterial, readStoredGlassLook, subscribeGlassTuning, valuesForLook } from "./glass-tuning";
import "./ui/liquid.css";
import "./styles.css";

document.documentElement.dataset.shell = window.kosmosNext ? "native" : "hosted";
try {
  const look = readStoredGlassLook();
  document.documentElement.dataset.glassLook = look;
  const bootValues = valuesForLook(look);
  applyGlassTuning(bootValues);
  applyNativeMaterial(bootValues);
  subscribeGlassTuning((values) => {
    applyGlassTuning(values);
    applyNativeMaterial(values);
  });
} catch (error) {
  console.warn("[kosmos-next] glass boot failed", error);
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Kosmos Next root element is missing");
}

// Explicitly-typed const so the non-null narrowing survives into the closures below.
const root: HTMLElement = rootElement;

function showBootError(message: string) {
  if (root.childElementCount > 0) {
    return;
  }
  root.innerHTML = `<p style="margin:24% 1.5rem 0;color:#fff;font:500 15px/1.4 -apple-system,sans-serif;text-align:center">${message}</p>`;
}

window.addEventListener("error", (event) => {
  showBootError(event.message || "Kosmos Next failed to load.");
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  showBootError(reason instanceof Error ? reason.message : "Kosmos Next failed to load.");
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
