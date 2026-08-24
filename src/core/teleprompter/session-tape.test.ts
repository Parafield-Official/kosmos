import { describe, expect, it } from "vitest";
import { pickupFromLiveFlag, type LiveMismatch } from "./live";
import {
  audioSourceForPickup,
  availableProofSources,
  chapterWithBoothTapeAsTake,
  concatLiveTape,
  isLiveCaughtPickup,
  listenDisabledReason,
  proofAudioSource,
  punchDisabledReason,
  resolveProofSource,
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

describe("pickup playback covers the line", () => {
  const withLine: Pickup = { ...proofPickup, line_start: 6.4, line_end: 11.2, line_text: "Down the upper edge of the sky" };

  it("plays the whole line, so the word-timestamp error cannot play the neighbour", () => {
    const source = audioSourceForPickup(withLine, { audio_path: "audio/ch01.wav" });
    expect(source).toMatchObject({ start: 6.4, end: 11.2, wordOnly: false });
    // The word alone is 0.3s, less than the alignment error it is subject to.
    expect(withLine.t_end - withLine.t_start).toBeLessThan(0.35);
    expect((source!.end - source!.start)).toBeGreaterThan(4);
  });

  it("falls back to the word for pickups filed before lines were recorded", () => {
    const source = audioSourceForPickup(proofPickup, { audio_path: "audio/ch01.wav" });
    expect(source).toMatchObject({ start: 8.15, end: 8.45, wordOnly: true });
  });

  it("ignores a line range that is not a range", () => {
    const broken = { ...withLine, line_start: 9, line_end: 9 };
    expect(audioSourceForPickup(broken, { audio_path: "audio/ch01.wav" })).toMatchObject({
      start: 8.15,
      wordOnly: true,
    });
  });

  it("carries the line from a live flag onto the pickup it files", () => {
    const flagged = pickupFromLiveFlag(
      { ...liveFlag, lineStart: 6.4, lineEnd: 11.2, lineText: "Down the upper edge of the sky" },
      "ch01",
    );
    expect(flagged).toMatchObject({
      t_start: 8.15,
      t_end: 8.45,
      manuscript_index: 18,
      line_start: 6.4,
      line_end: 11.2,
      line_text: "Down the upper edge of the sky",
    });
  });
});

describe("punching a pickup", () => {
  it("keeps a narrator-selected redo on the recording that supplied its timing", () => {
    const liveSelection = { ...proofPickup, source_kind: "live" as const };
    expect(audioSourceForPickup(liveSelection, {
      audio_path: "audio/imported.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    })?.relativePath).toBe("audio/live/ch01_session.wav");
    expect(punchDisabledReason(liveSelection, {
      audio_path: "audio/imported.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    })).toMatch(/uploaded take/i);
    expect(punchDisabledReason(liveSelection, {
      live_audio_path: "audio/live/ch01_session.wav",
    })).toBeNull();
  });

  it("will not splice a booth-tape flag into a take it was never timed against", () => {
    const live = pickupFromLiveFlag(liveFlag, "ch01");
    expect(punchDisabledReason(live, {
      audio_path: "audio/01_recorded.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    })).toMatch(/Check chapter/i);
  });

  it("punches a proof pickup, which is already timed on the take", () => {
    expect(punchDisabledReason(proofPickup, { audio_path: "audio/01_recorded.wav" })).toBeNull();
    expect(punchDisabledReason(proofPickup, {})).toMatch(/take/i);
  });

  it("lets Record pickup run when Check chapter used the booth tape", () => {
    expect(punchDisabledReason(proofPickup, {
      live_audio_path: "audio/live/ch01_session.wav",
    })).toBeNull();
  });
});

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
      wordOnly: true,
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
      wordOnly: true,
    });
  });

  it("plays a proof pickup from the booth tape when Check chapter had no take", () => {
    expect(audioSourceForPickup(proofPickup, {
      live_audio_path: "audio/live/ch01_session.wav",
    })).toEqual({
      relativePath: "audio/live/ch01_session.wav",
      start: 8.15,
      end: 8.45,
      kind: "live",
      wordOnly: true,
    });
    expect(listenDisabledReason(proofPickup, { live_audio_path: "audio/live/ch01_session.wav" }))
      .toBeNull();
  });

  it("keeps the booth tape as the take so a punch can splice the same file", () => {
    expect(chapterWithBoothTapeAsTake({
      live_audio_path: "audio/live/ch01_session.wav",
    })).toEqual({
      live_audio_path: "audio/live/ch01_session.wav",
      audio_path: "audio/live/ch01_session.wav",
      raw_audio_path: "audio/live/ch01_session.wav",
    });
    expect(chapterWithBoothTapeAsTake({
      audio_path: "audio/01_recorded.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    }).audio_path).toBe("audio/01_recorded.wav");
    expect(chapterWithBoothTapeAsTake({})).toEqual({});
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

  it("lets Check chapter use the booth tape when there is no chapter take", () => {
    expect(proofAudioSource({ live_audio_path: "audio/live/ch01_session.wav" })).toEqual({
      relativePath: "audio/live/ch01_session.wav",
      start: 0,
      end: 0,
      kind: "live",
    });
    expect(proofAudioSource({
      audio_path: "audio/01_recorded.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    })).toEqual({
      relativePath: "audio/01_recorded.wav",
      start: 0,
      end: 0,
      kind: "take",
    });
    expect(proofAudioSource({})).toBeNull();
  });

  it("lets Review pick the booth tape even when a take is already attached", () => {
    const both = {
      audio_path: "audio/01_recorded.wav",
      live_audio_path: "audio/live/ch01_session.wav",
    };
    expect(availableProofSources(both)).toEqual({
      take: { relativePath: "audio/01_recorded.wav", start: 0, end: 0, kind: "take" },
      live: { relativePath: "audio/live/ch01_session.wav", start: 0, end: 0, kind: "live" },
    });
    expect(resolveProofSource(both, "live")?.kind).toBe("live");
    expect(resolveProofSource(both, "take")?.kind).toBe("take");
    expect(resolveProofSource({ live_audio_path: both.live_audio_path }, "take")?.kind).toBe("live");
  });
});
