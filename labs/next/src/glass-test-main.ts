/// <reference path="./glass-test.d.ts" />
import "./glass-test.css";

const pane = document.getElementById("pane");
const tintInput = document.getElementById("tint") as HTMLInputElement | null;
const tintValue = document.getElementById("tint-value");
const osBlurInput = document.getElementById("os-blur") as HTMLInputElement | null;

if (!pane || !tintInput || !tintValue || !osBlurInput) {
  throw new Error("Pure glass test markup is missing");
}

function apply() {
  const alpha = Number(tintInput.value);
  tintValue.textContent = alpha.toFixed(2);
  pane.style.background = `rgba(0, 0, 0, ${alpha})`;
  void window.glassTest?.setMaterial({
    vibrancy: osBlurInput.checked ? "popover" : null,
    visualEffectState: osBlurInput.checked ? "active" : "inactive",
  });
}

tintInput.addEventListener("input", apply);
osBlurInput.addEventListener("change", apply);
apply();
