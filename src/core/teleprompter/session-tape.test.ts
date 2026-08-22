import { describe, expect, it } from "vitest";
import { pickupFromLiveFlag, type LiveMismatch } from "./live";
import {
  audioSourceForPickup,
  concatLiveTape,
  isLiveCaughtPickup,
  listenDisabledReason,
  shouldKeepLiveTape,
} from "./session-tape";
import type { Pickup } from "../project/types";

const liveFlag: LiveMismatch = {
  id: "live-ch01-18-this",
  expected: "the",
  heard: "this",
  expectedIndex: 18,
  lineIndex: 0,
  start: 8.15,
  end: 8.45,
  confidence: 0.9,
};

const proofPickup: Pickup = {
  id: "proof-1",
  chapter_id: "ch01",
  t_start: 8.15,
  t_end: 8.45,
  expected: "the",
  heard: "this",
  kind: "sub",
  seat: "narration",
  status: "open",
  confidence: 0.9,
};

describe("live session tape", () => {
  it("treats an auto-filed live flag as a booth-tape pickup", () => {
    const pickup = pickupFromLiveFlag(liveFlag, "ch01");
    expect(isLiveCaughtPickup(pickup)).toBe(true);
    expect(isLiveCaughtPickup(proofPickup)).toBe(false);
  });

  it("plays a live flag from the booth tape, never from a later chapter take", () => {
    const pickup = pickupFromLiveFlag(liveFlag, "ch01");
    expect(audioSourceForPickup(pickup, {
      audio_path: "audio/01_recorded.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    })).toEqual({
      relativePath: "audio/live/ch01_session.wav",
      start: 8.15,
      end: 8.45,
      kind: "live",
    });
  });

  it("does not pretend Listen can play a live flag when no booth tape exists", () => {
    const pickup = pickupFromLiveFlag(liveFlag, "ch01");
    expect(audioSourceForPickup(pickup, { audio_path: "audio/01_recorded.wav" })).toBeNull();
    expect(listenDisabledReason(pickup, { audio_path: "audio/01_recorded.wav" }))
      .toMatch(/booth tape/i);
  });

  it("plays a proof pickup from the chapter take, not the booth tape", () => {
    expect(audioSourceForPickup(proofPickup, {
      audio_path: "audio/01_recorded.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    })).toEqual({
      relativePath: "audio/01_recorded.wav",
      start: 8.15,
      end: 8.45,
      kind: "take",
    });
    expect(listenDisabledReason(proofPickup, { live_audio_path: "audio/live/ch01_session.wav" }))
      .toMatch(/take/i);
  });

  it("keeps a usable booth tape and drops a tap or an overlong session", () => {
    expect(shouldKeepLiveTape(16_000, 16_000)).toBe(true);
    expect(shouldKeepLiveTape(100, 16_000)).toBe(false);
    expect(shouldKeepLiveTape(16_000 * 60 * 60 * 3, 16_000)).toBe(false);
    expect(concatLiveTape([
      Float32Array.from([0.1, 0.2]),
      Float32Array.from([0.3]),
    ])).toEqual(Float32Array.from([0.1, 0.2, 0.3]));
    expect(concatLiveTape([])).toEqual(new Float32Array(0));
  });
});
