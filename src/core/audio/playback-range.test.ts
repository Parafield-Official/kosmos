import { describe, expect, it } from "vitest";
import {
  contextPlaybackRange,
  leadInPlaybackRange,
  playbackReachedEnd,
  selectedPlaybackRange,
} from "./playback-range";

describe("exact selected-word playback", () => {
  it("plays only the stored first-word start through last-word end", () => {
    expect(selectedPlaybackRange(2.32, 5.52)).toEqual({ start: 2.32, end: 5.52 });
  });

  it("keeps contextual padding out of selected-only playback", () => {
    expect(contextPlaybackRange(2.32, 5.52, 0.5)).toEqual({ start: 1.82, end: 6.02 });
    expect(selectedPlaybackRange(2.32, 5.52)).not.toEqual(contextPlaybackRange(2.32, 5.52, 0.5));
  });

  it("keeps the narrator lead-in separate and stops where the selection begins", () => {
    expect(leadInPlaybackRange(2.32, 3)).toEqual({ start: 0, end: 2.32 });
    expect(leadInPlaybackRange(8.4, 3)).toEqual({ start: 5.4, end: 8.4 });
  });

  it("normalizes invalid or reversed ranges without playing outside the recording", () => {
    expect(selectedPlaybackRange(-1, 3)).toEqual({ start: 0, end: 3 });
    expect(selectedPlaybackRange(5, 4)).toEqual({ start: 5, end: 5 });
  });

  it("stops at the selected endpoint within a few milliseconds", () => {
    expect(playbackReachedEnd(5.514, 5.52)).toBe(false);
    expect(playbackReachedEnd(5.516, 5.52)).toBe(true);
    expect(playbackReachedEnd(5.8, 5.52)).toBe(true);
  });
});
