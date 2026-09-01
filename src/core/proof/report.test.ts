import { describe, expect, it } from "vitest";
import { buildProofReportFiles } from "./report";

describe("proof report packet", () => {
  it("builds a readable report and escaped pickup CSV", () => {
    const files = buildProofReportFiles({
      chapterIndex: 2,
      chapterTitle: "The, House",
      audioPath: "audio/02_edited.wav",
      audioDurationSeconds: 93.25,
      generatedAt: "2026-08-18T12:00:00.000Z",
      transcript: [
        { text: "hello", start: 0, end: 0.5 },
        { text: "world", start: 0.6, end: 1.1 },
      ],
      pickups: [{
        id: "pickup-1",
        chapter_id: "ch02",
        t_start: 12.345,
        t_end: 13.2,
        expected: "say, this",
        heard: "say this",
        kind: "sub",
        seat: "narration",
        status: "open",
        confidence: 0.82,
        note: "Check, comma and breath",
      }],
    });

    expect(files.report).toContain("# Proof report — Chapter 2: The, House");
    expect(files.report).toContain("1 open pickup");
    expect(files.report).toContain("00:12.345");
    expect(files.report).toContain("Check, comma and breath");
    expect(files.csv).toContain('"say, this"');
    expect(files.csv).toContain('"Check, comma and breath"');
    expect(files.csv.split("\n")).toHaveLength(3);
  });

  it("does not claim findings when a chapter is clean", () => {
    const files = buildProofReportFiles({
      chapterIndex: 1,
      chapterTitle: "Clean",
      transcript: [],
      pickups: [],
      generatedAt: "2026-08-18T12:00:00.000Z",
    });
    expect(files.report).toContain("No word changes or long pauses were found.");
    expect(files.csv).toContain("id,chapter,time_start,time_end,type,status,confidence,expected,heard,note");
  });
});
