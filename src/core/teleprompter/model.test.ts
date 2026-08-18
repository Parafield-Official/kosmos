import { describe, expect, it } from "vitest";
import {
  buildPromptLines,
  clampFontSize,
  createLiveFlagsState,
  recordLiveFlag,
  dismissLiveFlag,
  type PromptSegment,
} from "./model";

describe("teleprompter model", () => {
  it("keeps styles, seats, glossary links, and manual line breaks", () => {
    const spans: PromptSegment[] = [
      { text: "Elena", seat: "N1", style: ["italic"], glossary_id: "elena" },
      { text: " walked.\n", seat: "N1", style: [], },
      { text: "Kael", seat: "N2", style: ["bold", "highlight"], glossary_id: "kael" },
    ];

    const lines = buildPromptLines(spans);

    expect(lines.map((line) => line.text)).toEqual(["Elena walked.", "Kael"]);
    expect(lines[0].segments[0]).toMatchObject({ text: "Elena", seat: "N1", glossary_id: "elena" });
    expect(lines[0].segments[0].style).toEqual(["italic"]);
    expect(lines[1].segments[0]).toMatchObject({ text: "Kael", seat: "N2", glossary_id: "kael" });
  });

  it("preserves intentional blank paragraphs instead of collapsing them", () => {
    const lines = buildPromptLines([
      { text: "first\n\nsecond", seat: "narration", style: [] },
    ]);

    expect(lines.map((line) => line.text)).toEqual(["first", "", "second"]);
  });

  it("clamps readable font sizes", () => {
    expect(clampFontSize(4)).toBe(20);
    expect(clampFontSize(48)).toBe(48);
    expect(clampFontSize(200)).toBe(96);
  });

  it("keeps live flags off by default and auto-dims after three false alarms", () => {
    let state = createLiveFlagsState();
    expect(state.enabled).toBe(false);
    state = { ...state, enabled: true };
    state = recordLiveFlag(state, { id: "a", isTrueMismatch: false });
    state = recordLiveFlag(state, { id: "b", isTrueMismatch: false });
    state = recordLiveFlag(state, { id: "c", isTrueMismatch: false });
    expect(state.dimmed).toBe(true);
    expect(state.falseAlarmCount).toBe(3);
    state = dismissLiveFlag(state, "a");
    expect(state.dismissedIds).toContain("a");
  });
});
