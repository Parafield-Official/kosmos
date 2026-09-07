import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readBoothFontPx, readPromptHighlight, readPromptLineSpacing,
  writePromptHighlight, writePromptLineSpacing,
} from "./reading-prefs";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
}

afterEach(() => vi.unstubAllGlobals());

describe("shared teleprompter preferences", () => {
  it("uses the intended first-use size and line indicator without saved settings", () => {
    storage();
    expect(readBoothFontPx()).toBe(28);
    expect(readPromptHighlight()).toBe("line");
    expect(readPromptLineSpacing()).toBe(1.55);
  });

  it("reads existing recording preferences in either booth view", () => {
    storage({ "kosmos-booth-highlight": "paragraph", "kosmos-booth-spacing": "1.8" });
    expect(readPromptHighlight()).toBe("paragraph");
    expect(readPromptLineSpacing()).toBe(1.8);
    writePromptHighlight("line");
    writePromptLineSpacing(1.35);
    expect(readPromptHighlight()).toBe("line");
    expect(readPromptLineSpacing()).toBe(1.35);
  });

  it("falls back for corrupt preferences and clamps saved font sizes", () => {
    storage({ "kosmos-booth-highlight": "sentence", "kosmos-booth-spacing": "NaN", "kosmos-booth-font-px": "" });
    expect(readPromptHighlight()).toBe("line");
    expect(readPromptLineSpacing()).toBe(1.55);
    expect(readBoothFontPx()).toBe(28);
    storage({ "kosmos-booth-font-px": "100" });
    expect(readBoothFontPx()).toBe(48);
  });

  it("remains usable when storage is blocked", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("blocked"); } });
    expect(readPromptHighlight()).toBe("line");
    expect(readPromptLineSpacing()).toBe(1.55);
    expect(() => writePromptHighlight("word")).not.toThrow();
    expect(() => writePromptLineSpacing(1.8)).not.toThrow();
  });
});
