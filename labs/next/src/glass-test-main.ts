/// <reference path="./glass-test.d.ts" />
import "./glass-test.css";

const paneMaybe = document.getElementById("pane");
const tintInputMaybe = document.getElementById("tint") as HTMLInputElement | null;
const tintValueMaybe = document.getElementById("tint-value");
const osBlurInputMaybe = document.getElementById("os-blur") as HTMLInputElement | null;

if (!paneMaybe || !tintInputMaybe || !tintValueMaybe || !osBlurInputMaybe) {
  throw new Error("Pure glass test markup is missing");
}

// Non-null consts so the narrowing survives into the apply() closure below.
const pane: HTMLElement = paneMaybe;
const tintInput: HTMLInputElement = tintInputMaybe;
const tintValue: HTMLElement = tintValueMaybe;
const osBlurInput: HTMLInputElement = osBlurInputMaybe;

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
