export type Place = "mark" | "intro" | "brand" | "welcome" | "access" | "community" | "theme" | "app";

export interface FrameSize {
  width: number;
  height: number;
}

export const STORAGE_KEY = "kosmos-next-onboarding";
/** Persists across quits: once true, launches skip straight to the main app. */
export const ONBOARDED_KEY = "kosmos-onboarded";
/** Set after the first-run pigment panel; returning users never see it again. */
export const PIGMENT_KEY = "kosmos-pigment-chosen";
const PIGMENT_OFFER_KEY = "kosmos-force-pigment";
export const PIGMENT_OFFER_EVENT = "kosmos-pigment-offer";

export const INTRO_TAGLINE =
  "you’re creating an audiobook, but you’re paying softwares for recording, teleprompter, and sound mastering.";
export const INTRO_HEADLINE = "Introducing Kosmos:";
export const INTRO_STUDIO = "audiobook recording and mastering in one place.";
export const INTRO_COPYRIGHT = "© Parafield Inc.";
export const INTRO_DISCORD = "https://discord.gg/g4aVz59mQ9";
export const INTRO_DISCORD_APP = "discord://-/invite/g4aVz59mQ9";
export const INTRO_GITHUB = "https://github.com/Manishram-ai/kosmos";
export const WELCOME_VIDEO = "/welcome.mov?v=0";
export const WELCOME_VIDEO_GAIN = 1.45;
export const WELCOME_PLACEHOLDER_S = 12;

export const INTRO_CHAR_MS = 28;
export const STATEMENT_MS = 5200;
export const INTRO_PAUSE_MS = Math.max(1400, STATEMENT_MS - INTRO_TAGLINE.length * INTRO_CHAR_MS);
export const MARK_MS = 1120;

export const MARK_SIZE: FrameSize = { width: 600, height: 490 };
export const INTRO_SIZE: FrameSize = MARK_SIZE;
export const BRAND_SIZE: FrameSize = MARK_SIZE;
export const WELCOME_SIZE: FrameSize = { width: 600, height: 410 };
export const APP_SIZE: FrameSize = { width: 1180, height: 760 };

export const PLACES: Place[] = ["mark", "intro", "brand", "welcome", "community", "access", "theme", "app"];

export function isRoomPlace(place: Place): boolean {
  return place === "app" || place === "theme";
}

export function hasChosenPigment(): boolean {
  try {
    return window.localStorage.getItem(PIGMENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPigmentChosen() {
  try {
    window.localStorage.setItem(PIGMENT_KEY, "1");
    window.sessionStorage.removeItem(PIGMENT_OFFER_KEY);
  } catch {
    // Non-fatal; the panel may appear once more next launch.
  }
}

/** Debug dock / access → app: show the pigment glass on the live vault. */
export function offerPigment() {
  try {
    window.sessionStorage.setItem(PIGMENT_OFFER_KEY, "1");
  } catch {
    // Non-fatal.
  }
  window.dispatchEvent(new Event(PIGMENT_OFFER_EVENT));
}

export function shouldOfferPigment(): boolean {
  try {
    if (window.sessionStorage.getItem(PIGMENT_OFFER_KEY) === "1") {
      return true;
    }
    if (window.localStorage.getItem(PIGMENT_KEY) === "1") {
      return false;
    }
    // Users who finished the old flow already picked a colour in Settings.
    if (isOnboarded()) {
      window.localStorage.setItem(PIGMENT_KEY, "1");
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function placeLabel(place: Place): string {
  if (place === "app") return "main app";
  if (place === "welcome") return "video";
  if (place === "theme") return "pigment";
  return place;
}

export function sizeFor(place: Place): FrameSize {
  if (isRoomPlace(place)) {
    return APP_SIZE;
  }
  if (place === "welcome") {
    return WELCOME_SIZE;
  }
  return MARK_SIZE;
}

export const ACCESS_HEADING = "Let\u2019s get everything set up.";
export const ACCESS_MIC_TITLE = "Allow Kosmos to record audio";
export const ACCESS_MIC_DESC = "Kosmos uses your microphone to capture narration and voice-over for your audiobooks.";
export const ACCESS_MIC_DENIED = "Microphone access is blocked in System Settings.";
export const ACCESS_MIC_PROMPT = "Tap to allow Kosmos to use your microphone.";
export const ACCESS_MIC_PENDING = "Waiting for the system microphone prompt…";
export const ACCESS_MIC_GRANTED = "Microphone access allowed.";
export const ACCESS_OPEN_MIC_SETTINGS = "Open Microphone Settings";
export const ACCESS_SPEECH_TITLE = "Download speech model";
export const ACCESS_SPEECH_PROMPT = "For proofreading imported audio.";
export const ACCESS_SPEECH_PENDING = "Downloading";
export const ACCESS_SPEECH_GRANTED = "Ready.";
export const ACCESS_SPEECH_DENIED = "Download failed. Tap to retry.";
export const ACCESS_FOLDER_TITLE = "Choose your workspace";
export const ACCESS_FOLDER_PROMPT = "Pick a folder for your Kosmos projects.";
export const ACCESS_FOLDER_PENDING = "Waiting for the folder picker\u2026";
export const ACCESS_FOLDER_GRANTED = "Workspace set.";
export const ACCESS_FOLDER_DENIED = "No workspace chosen.";
export const ACCESS_BRIDGE_MISSING = "Restart the Electron app to enable system permission dialogs.";
export const DEBUG_RESET_ACCESS = "reset access";
export const COMMUNITY_HEADING = "Join our community";
export const THEME_HEADING = "Choose a colour for the room.";
export const THEME_LEAD = "The canvas stays white. Pigment tints atmosphere, light, and selected controls.";
export const COMMUNITY_POINT_1_TITLE = "Connect with creators";
export const COMMUNITY_POINT_1_BODY = "A place for authors, narrators, and audiobook lovers to connect and engage in conversations.";
export const COMMUNITY_POINT_2_TITLE = "Make Kosmos better";
export const COMMUNITY_POINT_2_BODY = "Report any bugs or suggest features to the team behind Kosmos and make the project better together.";

export function sameSize(left: FrameSize, right: FrameSize): boolean {
  return left.width === right.width && left.height === right.height;
}

export function isOnboarded(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboarded() {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // Storage can be refused; onboarding simply repeats next launch.
  }
}

export function clearOnboarded() {
  try {
    window.localStorage.removeItem(ONBOARDED_KEY);
    window.localStorage.removeItem(PIGMENT_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(PIGMENT_OFFER_KEY);
  } catch {
    // Non-fatal.
  }
}

export function readStoredPlace(): Place {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (
      value === "mark" ||
      value === "intro" ||
      value === "brand" ||
      value === "welcome" ||
      value === "access" ||
      value === "community" ||
      value === "theme" ||
      value === "app"
    ) {
      if (value === "theme") {
        try {
          window.sessionStorage.setItem(PIGMENT_OFFER_KEY, "1");
        } catch {
          // Non-fatal.
        }
        return "app";
      }
      return value;
    }
    // Returning, already-onboarded users land in the main app (Xcode-style).
    if (isOnboarded()) {
      return "app";
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
