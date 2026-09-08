import { describe, expect, it } from "vitest";
import { matchLiveWindow, type LiveMatchState } from "./live";
import { placeWindowOnTake } from "./window-clock";

const expected = "Amber birds cross quiet rivers before dawn".split(" ").map((text, index) => ({ text, index, lineIndex: 0 }));
const clip = (text: string) => text.split(" ").map((text, index) => ({
  text, start: index * 0.5, end: index * 0.5 + 0.4, confidence: 1,
}));
function follow(text: string, start: number, state: LiveMatchState) {
  return matchLiveWindow({ chapterId: "test", expected, state,
    transcript: placeWindowOnTake(clip(text), start), flagsEnabled: false, haltOnMismatch: false });
}

describe("clip-based teleprompter clock", () => {
  it("keeps following across successive clips whose timestamps restart at zero", () => {
    const first = follow("Amber birds cross", 0, { cursor: 0, lastHeardEnd: 0 });
    expect(first.state.cursor).toBe(3);
    const second = follow("quiet rivers", 4, first.state);
    expect(second.state.cursor).toBe(5);
    const third = follow("before dawn", 8, second.state);
    expect(third.state.cursor).toBe(7);
    expect(third.confirmed[0].start).toBe(8);
  });

  it("uses captured audio time after a failed or silent window and a punch-in", () => {
    const result = follow("quiet rivers", 12, { cursor: 3, lastHeardEnd: 6 });
    expect(result.state.cursor).toBe(5);
    expect(result.confirmed[0].start).toBe(12);
    expect(result.state.lastHeardEnd).toBe(12.9);
  });

  it("ignores queued speech before a manually selected position, then follows new speech", () => {
    const selected = { cursor: 5, lastHeardEnd: 8, recentHeard: [] };
    const queued = follow("quiet rivers", 4, selected);
    expect(queued.state.cursor).toBe(5);
    expect(follow("before dawn", 8, queued.state).state.cursor).toBe(7);
  });
});
