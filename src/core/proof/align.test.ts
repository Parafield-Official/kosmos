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
    });
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
});
