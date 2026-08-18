import { describe, expect, it } from "vitest";
import { alignTranscript, type TranscriptWord } from "./align";

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
});

