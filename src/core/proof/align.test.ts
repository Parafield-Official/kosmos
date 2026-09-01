import { describe, expect, it } from "vitest";
import { alignTranscript, preservePickupWorkflow, type TranscriptWord } from "./align";
import type { Pickup } from "../project/types";

function words(items: Array<[string, number, number]>): TranscriptWord[] {
  return items.map(([text, start, end]) => ({ text, start, end, confidence: 0.98 }));
}

describe("alignTranscript", () => {
  it("finds an on → in substitution near the spoken timestamp", () => {
    const result = alignTranscript({
      chapterId: "ch01",
      manuscript: "The fox jumped on the mat.",
      transcript: words([
        ["The", 0.1, 0.25],
        ["fox", 0.3, 0.5],
        ["jumped", 0.55, 0.8],
        ["in", 0.9, 1.05],
        ["the", 1.1, 1.2],
        ["mat", 1.25, 1.5],
      ]),
      durationSeconds: 2,
    });

    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0]).toMatchObject({
      kind: "sub",
      expected: "on",
      heard: "in",
      t_start: expect.closeTo(0.9, 0.001),
      line_text: "The fox jumped on the mat.",
    });
    expect(result.pickups[0].line_start).toBeLessThan(result.pickups[0].t_start);
    expect(result.pickups[0].line_end).toBeGreaterThan(result.pickups[0].t_end);
  });

  it("uses the sentence's measured word times so a slow read is not cut off", () => {
    const result = alignTranscript({
      chapterId: "ch-slow-line",
      manuscript: "The Bridgertons are by far the most prolific family in society.",
      transcript: words([
        ["The", 5, 5.2],
        ["Bridget", 5.4, 5.7],
        ["kinds", 5.75, 6],
        ["are", 6.2, 6.4],
        ["by", 7, 7.2],
        ["far", 7.5, 7.7],
        ["the", 8, 8.2],
        ["most", 9, 9.2],
        ["prolific", 10.5, 11],
        ["family", 12, 12.5],
        ["in", 13, 13.2],
        ["society", 14, 14.5],
      ]),
      durationSeconds: 20,
      silences: [
        { start: 0, end: 4.8 },
        { start: 14.7, end: 20 },
      ],
    });

    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0]).toMatchObject({
      expected: "Bridgertons",
      heard: "Bridget kinds",
      line_start: expect.closeTo(5, 0.001),
      line_end: expect.closeTo(14.5, 0.001),
    });
  });

  it("does not start a pickup line inside measured opening room tone", () => {
    const result = alignTranscript({
      chapterId: "ch-leading-room",
      manuscript: "Bridgertons gathered quietly.",
      transcript: words([
        ["Bridget", 0, 0.2],
        ["kinds", 0.2, 0.4],
        ["gathered", 5.2, 5.6],
        ["quietly", 6, 6.4],
      ]),
      durationSeconds: 8,
      silences: [{ start: 0, end: 4.8 }],
    });

    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0].t_start).toBe(0);
    expect(result.pickups[0].line_start).toBeCloseTo(4.8, 3);
    expect(result.pickups[0].line_end).toBe(6.4);
  });

  it("groups a skipped sentence into one pickup", () => {
    const result = alignTranscript({
      chapterId: "ch01",
      manuscript: "One. This sentence is missing. Three.",
      transcript: words([
        ["One", 0.1, 0.3],
        ["Three", 1.8, 2.0],
      ]),
      durationSeconds: 2.2,
    });

    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0].kind).toBe("skip");
    expect(result.pickups[0].expected).toContain("This sentence is missing");
    expect(result.pickups[0].heard).toBe("");
  });

  it("flags words the narrator added between two manuscript words", () => {
    const result = alignTranscript({
      chapterId: "ch-added-word",
      manuscript: "The fox jumped.",
      transcript: words([
        ["The", 0.1, 0.3],
        ["quick", 0.35, 0.55],
        ["fox", 0.6, 0.8],
        ["jumped", 0.85, 1.1],
      ]),
      durationSeconds: 1.3,
    });

    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0]).toMatchObject({
      kind: "insert",
      expected: "",
      heard: "quick",
    });
  });

  it("gives an added word the measured sentence range for Listen", () => {
    const result = alignTranscript({
      chapterId: "ch-added-line",
      manuscript: "Such industriousness is commendable.",
      transcript: words([
        ["Such", 5, 5.3],
        ["industriousness", 5.5, 6.2],
        ["only", 6.4, 6.7],
        ["is", 6.9, 7.1],
        ["commendable", 8, 8.6],
      ]),
      durationSeconds: 10,
    });

    expect(result.pickups).toHaveLength(1);
    expect(result.pickups[0]).toMatchObject({
      kind: "insert",
      heard: "only",
      line_text: "Such industriousness is commendable.",
      line_start: expect.closeTo(5, 0.001),
      line_end: expect.closeTo(8.6, 0.001),
    });
  });

  it("flags a long mid-sentence pause but ignores a sentence-boundary gap", () => {
    const result = alignTranscript({
      chapterId: "ch01",
      manuscript: "The fox, after waiting, jumped on the mat. Then it slept.",
      transcript: words([
        ["The", 0.1, 0.3],
        ["fox", 0.35, 0.55],
        ["after", 0.6, 0.8],
        ["waiting", 5.1, 5.4],
        ["jumped", 5.5, 5.8],
        ["on", 5.9, 6.1],
        ["the", 6.2, 6.4],
        ["mat", 6.5, 6.7],
        ["Then", 11.0, 11.2],
        ["it", 11.3, 11.5],
        ["slept", 11.6, 11.8],
      ]),
      durationSeconds: 12,
    });

    expect(result.pickups.filter((pickup) => pickup.kind === "pause")).toHaveLength(1);
    expect(result.pickups.find((pickup) => pickup.kind === "pause")).toMatchObject({
      expected: "Pause > 4s",
      t_start: 0.8,
      t_end: 5.1,
    });
  });

  it("flags a pause the recogniser's timings hid, using the measured silence", () => {
    // whisper.cpp spreads a segment's words evenly across its span, so a five
    // second stop mid-sentence comes back as a tenth of a second between words.
    const transcript = words([
      ["The", 0.1, 0.4],
      ["fox", 0.5, 0.8],
      ["waited", 0.9, 1.2],
      ["then", 1.3, 1.6],
      ["jumped", 1.7, 2.0],
    ]);
    const withoutAudio = alignTranscript({
      chapterId: "ch-hidden-pause",
      manuscript: "The fox waited then jumped.",
      transcript,
      durationSeconds: 8,
    });
    expect(withoutAudio.pickups.filter((pickup) => pickup.kind === "pause")).toHaveLength(0);

    const withAudio = alignTranscript({
      chapterId: "ch-hidden-pause",
      manuscript: "The fox waited then jumped.",
      transcript,
      durationSeconds: 8,
      silences: [{ start: 1.25, end: 6.4 }],
    });
    const pauses = withAudio.pickups.filter((pickup) => pickup.kind === "pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toMatchObject({ t_start: 1.25, t_end: 6.4 });
  });

  it("keeps a measured pause when the word beside it was misrecognised", () => {
    // Real Whisper timestamps stretched the words before a silent interval,
    // placing the measured gap beside a low-confidence name substitution.
    // The nearest matched words still prove this happened mid-sentence.
    const result = alignTranscript({
      chapterId: "ch-name-before-pause",
      manuscript: "The Bridgertons are by far the most prolific family in the upper echelons of society.",
      transcript: words([
        ["The", 0.02, 1.38],
        ["Brejertens", 1.38, 3.37],
        ["are", 3.67, 4.06],
        ["by", 4.06, 4.32],
        ["far", 4.32, 4.71],
        ["the", 4.71, 5.1],
        ["most", 5.1, 5.62],
        ["prolific", 5.62, 6.66],
        ["family", 6.66, 7.44],
        ["in", 7.44, 7.7],
        ["the", 7.7, 8.09],
        ["upper", 8.8, 8.8],
        ["echelons", 8.82, 9.39],
        ["of", 9.39, 9.49],
        ["society", 9.55, 9.99],
      ]),
      durationSeconds: 10.2,
      silences: [{ start: 3.38, end: 8.82 }],
    });

    expect(result.pickups.filter((pickup) => pickup.kind === "pause")).toHaveLength(1);
  });

  it("ignores room tone before the first word and after the last", () => {
    const result = alignTranscript({
      chapterId: "ch-room-tone",
      manuscript: "The fox jumped.",
      transcript: words([
        ["The", 6.0, 6.3],
        ["fox", 6.4, 6.7],
        ["jumped", 6.8, 7.1],
      ]),
      durationSeconds: 14,
      silences: [
        { start: 0, end: 5.9 },
        { start: 7.2, end: 14 },
      ],
    });
    expect(result.pickups.filter((pickup) => pickup.kind === "pause")).toHaveLength(0);
  });

  it("keeps ignoring a measured silence that lands on a sentence boundary", () => {
    const result = alignTranscript({
      chapterId: "ch-measured-boundary",
      manuscript: "The fox jumped. Then it slept.",
      transcript: words([
        ["The", 0.1, 0.4],
        ["fox", 0.5, 0.8],
        ["jumped", 0.9, 1.2],
        ["Then", 1.3, 1.6],
        ["it", 1.7, 2.0],
        ["slept", 2.1, 2.4],
      ]),
      durationSeconds: 10,
      silences: [{ start: 1.25, end: 7.0 }],
    });
    expect(result.pickups.filter((pickup) => pickup.kind === "pause")).toHaveLength(0);
  });

  it("prefers the measured silence over the recogniser's own gaps", () => {
    // The transcript claims a gap the audio says was filled; only the real
    // silence should be flagged.
    const result = alignTranscript({
      chapterId: "ch-measured-wins",
      manuscript: "The fox waited quietly, then it jumped over.",
      transcript: words([
        ["The", 0.1, 0.4],
        ["fox", 0.5, 0.8],
        ["waited", 0.9, 1.2],
        ["quietly", 9.0, 9.3],
        ["then", 9.4, 9.7],
        ["it", 9.8, 10.1],
        ["jumped", 10.2, 10.5],
        ["over", 10.6, 10.9],
      ]),
      durationSeconds: 16,
      silences: [{ start: 9.9, end: 15.0 }],
    });
    const pauses = result.pickups.filter((pickup) => pickup.kind === "pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toMatchObject({ t_start: 9.9, t_end: 15.0 });
  });

  it("carries a human's done/ignored state into a re-proof", () => {
    const previous: Pickup[] = [{
      id: "old-id",
      chapter_id: "ch01",
      t_start: 1,
      t_end: 2,
      expected: "on",
      heard: "in",
      kind: "sub",
      seat: "narration",
      status: "ignored",
      confidence: 0.4,
      note: "Dialect is intentional.",
    }];
    const next: Pickup[] = [{
      ...previous[0],
      id: "new-id",
      t_start: 3,
      t_end: 4,
      status: "open",
      note: undefined,
    }];
    expect(preservePickupWorkflow(previous, next)[0]).toMatchObject({
      id: "new-id",
      status: "ignored",
      note: "Dialect is intentional.",
    });
  });

  it("ignores transcript words with invalid timing so pickups never contain NaN timestamps", () => {
    const result = alignTranscript({
      chapterId: "ch01",
      manuscript: "alpha beta",
      transcript: [
        { text: "alpha", start: Number.NaN, end: Number.NaN },
        { text: "beta", start: 1, end: 1.2 },
      ],
      durationSeconds: 2,
    });

    expect(result.transcript_words).toHaveLength(1);
    expect(result.pickups.every((pickup) => Number.isFinite(pickup.t_start) && Number.isFinite(pickup.t_end))).toBe(true);
  });

  it("ignores transcript words with negative timing before saving an alignment", () => {
    const result = alignTranscript({
      chapterId: "ch-negative-time",
      manuscript: "alpha beta",
      transcript: [
        { text: "alpha", start: -0.2, end: 0.1 },
        { text: "beta", start: 0.2, end: 0.4 },
      ],
      durationSeconds: 1,
    });

    expect(result.transcript_words).toHaveLength(1);
    expect(result.transcript_words[0].text).toBe("beta");
  });

  it("clamps ASR timestamps to the measured chapter duration", () => {
    const result = alignTranscript({
      chapterId: "ch-duration",
      manuscript: "alpha beta",
      transcript: [
        { text: "alpha", start: 1, end: 2 },
        { text: "beta", start: 9, end: 10 },
      ],
      durationSeconds: 5,
    });

    expect(result.transcript_words).toEqual([
      expect.objectContaining({ text: "alpha", start: 1, end: 2 }),
    ]);
    expect(result.pickups.every((pickup) => pickup.t_end <= 5)).toBe(true);
  });

  it("normalizes malformed ASR confidence values", () => {
    const result = alignTranscript({
      chapterId: "ch-confidence",
      manuscript: "one two",
      transcript: [
        { text: "zero", start: 0, end: 0.5, confidence: Number.NaN },
      ],
      durationSeconds: 1,
    });
    expect(result.pickups.every((pickup) => Number.isFinite(pickup.confidence))).toBe(true);
  });

  it("keeps a long-pause pickup separate from a nearby word mismatch", () => {
    const result = alignTranscript({
      chapterId: "ch-pause-boundary",
      manuscript: "The fox jumped on the mat.",
      transcript: words([
        ["The", 0, 0.2],
        ["fox", 0.3, 0.5],
        ["jumped", 1.0, 1.05],
        ["in", 1.1, 1.2],
        ["the", 1.3, 1.5],
        ["mat", 1.6, 1.8],
      ]),
      durationSeconds: 2,
      pauseThresholdSeconds: 0.4,
      mergeWindowSeconds: 0.4,
    });

    // The mismatch is close enough to the gap to exercise the merge window;
    // the pause must remain a distinct workflow item.
    expect(result.pickups.some((pickup) => pickup.kind === "sub")).toBe(true);
    expect(result.pickups.some((pickup) => pickup.kind === "pause")).toBe(true);
    expect(result.pickups).toHaveLength(2);
  });
});
