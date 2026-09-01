import { describe, expect, it } from "vitest";
import { applyLiveVisualRows, matchLiveWindow, type LiveExpectedWord, type LiveMatchState, type LiveMismatch } from "./live";
import { promptTextTokens } from "./model";
import { LINE_FOLLOW_MANUSCRIPT } from "../../../scripts/line-follow-stress-cases";

function expectedWords(lines: readonly string[] = LINE_FOLLOW_MANUSCRIPT): LiveExpectedWord[] {
  let index = 0;
  return lines.flatMap((text, lineIndex) => promptTextTokens(text)
    .filter((token) => token.isWord)
    .map((token) => ({ index: index++, lineIndex, text: token.text })));
}

function spokenWords(text: string): string[] {
  return promptTextTokens(text).filter((token) => token.isWord).map((token) => token.text);
}

function follow(
  expected: LiveExpectedWord[],
  startCursor: number,
  spoken: readonly string[],
): { state: LiveMatchState; halt?: LiveMismatch; backtracked: boolean } {
  let state: LiveMatchState = { cursor: startCursor, lastHeardEnd: 0 };
  let halt: LiveMismatch | undefined;
  let backtracked = false;
  for (const [offset, text] of spoken.entries()) {
    const before = state.cursor;
    const result = matchLiveWindow({
      chapterId: "line-stress",
      expected,
      transcript: [{ text, start: offset * 0.32, end: offset * 0.32 + 0.24, confidence: 0.98 }],
      state,
      flagsEnabled: false,
      haltOnMismatch: true,
    });
    state = result.state;
    backtracked ||= !result.halt && state.cursor < before;
    if (result.halt) {
      halt = result.halt;
      break;
    }
  }
  return { state, halt, backtracked };
}

describe("line-aware live follow recovery", () => {
  const expected = expectedWords();

  it("follows a narrator who restarts the current line", () => {
    // Cursor 11 is after "Beyond the window winter" on line 1.
    const result = follow(expected, 11, spokenWords(LINE_FOLLOW_MANUSCRIPT[1]));
    expect(result.halt).toBeUndefined();
    expect(result.backtracked).toBe(true);
    expect(result.state.cursor).toBe(14);
  });

  it("allows a natural editing phrase before a line restart", () => {
    const result = follow(expected, 11, [
      "sorry", "start", "again",
      ...spokenWords(LINE_FOLLOW_MANUSCRIPT[1]),
    ]);
    expect(result.halt).toBeUndefined();
    expect(result.backtracked).toBe(true);
    expect(result.state.cursor).toBe(14);
  });

  it("follows a repeated previous line and rejoins forward reading", () => {
    const result = follow(expected, 14, [
      ...spokenWords(LINE_FOLLOW_MANUSCRIPT[0]),
      ...spokenWords(LINE_FOLLOW_MANUSCRIPT[1]),
      ...spokenWords(LINE_FOLLOW_MANUSCRIPT[2]),
    ]);
    expect(result.halt).toBeUndefined();
    expect(result.backtracked).toBe(true);
    expect(result.state.cursor).toBe(21);
  });

  it("stops on the first unread line when one whole line is skipped", () => {
    const result = follow(expected, 7, spokenWords(LINE_FOLLOW_MANUSCRIPT[2]));
    expect(result.halt).toMatchObject({ expectedIndex: 7, lineIndex: 1, expected: "Beyond" });
    expect(result.state.cursor).toBe(7);
  });

  it("stops on the first unread line when two whole lines are skipped", () => {
    const result = follow(expected, 7, spokenWords(LINE_FOLLOW_MANUSCRIPT[3]));
    expect(result.halt).toMatchObject({ expectedIndex: 7, lineIndex: 1, expected: "Beyond" });
    expect(result.state.cursor).toBe(7);
  });

  it("stops where continuity broke after a partial line", () => {
    const result = follow(expected, 11, spokenWords(LINE_FOLLOW_MANUSCRIPT[3]));
    expect(result.halt).toMatchObject({ expectedIndex: 11, lineIndex: 1, expected: "rain" });
    expect(result.state.cursor).toBe(11);
  });

  it("stops when a narrator skips a wrapped visual row inside one paragraph", () => {
    const paragraph = applyLiveVisualRows(expectedWords([
      "Amber lanterns marked the harbor while copper pennants crossed the quiet avenue.",
    ]), [{ from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 11 }]);
    const result = follow(paragraph, 2, ["copper", "pennants"]);
    expect(result.halt).toMatchObject({ expectedIndex: 2, expected: "marked" });
    expect(result.state.cursor).toBe(2);
  });

  it("does not stop when ASR loses only the final word before the next line", () => {
    const result = follow(expected, 13, ["A", "copper"]);
    expect(result.halt).toBeUndefined();
    expect(result.state.cursor).toBe(16);
  });

  it("still lets a narrator omit a one-word heading", () => {
    const heading = expectedWords(["Leaflets", "At dusk they pour from the sky."]);
    const result = follow(heading, 0, ["At", "dusk"]);
    expect(result.halt).toBeUndefined();
    expect(result.state.cursor).toBe(3);
  });
});
