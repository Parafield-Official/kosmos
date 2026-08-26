export type Place = "mark" | "intro" | "brand" | "welcome" | "app";

export interface FrameSize {
  width: number;
  height: number;
}

export const STORAGE_KEY = "kosmos-next-onboarding";

export const INTRO_TAGLINE =
  "you’re creating an audiobook, but you’re paying softwares for recording, teleprompter, and sound mastering.";
export const INTRO_HEADLINE = "Introducing Kosmos:";
export const INTRO_STUDIO = "audiobook recording and mastering in one place.";
export const INTRO_COPYRIGHT = "© Parafield Inc.";
export const INTRO_DISCORD = "https://discord.gg/parafield";
export const WELCOME_VIDEO = "/welcome.mp4";
export const WELCOME_PLACEHOLDER_S = 12;

export const INTRO_CHAR_MS = 28;
export const STATEMENT_MS = 5200;
export const INTRO_PAUSE_MS = Math.max(1400, STATEMENT_MS - INTRO_TAGLINE.length * INTRO_CHAR_MS);
export const MARK_MS = 1120;

export const MARK_SIZE: FrameSize = { width: 600, height: 490 };
export const INTRO_SIZE: FrameSize = MARK_SIZE;
export const BRAND_SIZE: FrameSize = MARK_SIZE;
export const WELCOME_SIZE: FrameSize = { width: 720, height: 560 };
export const APP_SIZE: FrameSize = { width: 1180, height: 760 };

export const PLACES: Place[] = ["mark", "intro", "brand", "welcome", "app"];

export function sizeFor(place: Place): FrameSize {
  if (place === "app") {
    return APP_SIZE;
  }
  if (place === "welcome") {
    return WELCOME_SIZE;
  }
  return MARK_SIZE;
}

export function sameSize(left: FrameSize, right: FrameSize): boolean {
  return left.width === right.width && left.height === right.height;
}

export function readStoredPlace(): Place {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (value === "mark" || value === "intro" || value === "brand" || value === "welcome" || value === "app") {
      return value;
    }
  } catch {
    // Private windows can refuse storage; start from the first card.
  }
  return "mark";
}

export function storePlace(place: Place) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, place);
  } catch {
    // Welcome still works if storage is unavailable.
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
