import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GlassTuner } from "./GlassTuner";
import "./tuner.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Glass tuner root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <GlassTuner standalone />
  </StrictMode>,
);
