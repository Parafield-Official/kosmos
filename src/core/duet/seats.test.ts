import { describe, expect, it } from "vitest";
import { assignPickupSeats, assignSpanSeat, filterSpansForSeat, seatPackChapterSubset } from "./seats";

describe("duet seat script filtering", () => {
  const spans = [
    { text: "Narration", seat: "narration" as const, style: [] },
    { text: " her line", seat: "N1" as const, style: ["italic" as const] },
    { text: " his line", seat: "N2" as const, style: ["bold" as const] },
  ];

  it("keeps narration with the configured primary seat and preserves styles", () => {
    expect(filterSpansForSeat(spans, "N1")).toEqual([
      { text: "Narration", seat: "narration", style: [] },
      { text: " her line", seat: "N1", style: ["italic"] },
    ]);
    expect(filterSpansForSeat(spans, "N2")).toEqual([
      { text: " his line", seat: "N2", style: ["bold"] },
    ]);
  });

  it("assigns one span without mutating the source styles", () => {
    const next = assignSpanSeat(spans, 2, "N1");
    expect(next[2]).toMatchObject({ text: " his line", seat: "N1" });
    expect(spans[2].seat).toBe("N2");
    expect(next[2].style).not.toBe(spans[2].style);
  });

  it("attributes pickups to the speaking seat by timestamp", () => {
    const pickup = {
      id: "p1",
      chapter_id: "ch01",
      t_start: 2.1,
      t_end: 2.3,
      expected: "line",
      heard: "",
      kind: "skip" as const,
      seat: "narration" as const,
      status: "open" as const,
      confidence: 0.8,
    };
    expect(assignPickupSeats([pickup], [
      { start: 0, end: 2, seat: "N1" },
      { start: 2, end: 4, seat: "N2" },
    ])[0].seat).toBe("N2");
  });

  it("assigns a handoff-boundary pickup to the next narrator", () => {
    const pickup = {
      id: "handoff",
      chapter_id: "ch01",
      t_start: 2,
      t_end: 2.1,
      expected: "line",
      heard: "",
      kind: "skip" as const,
      seat: "narration" as const,
      status: "open" as const,
      confidence: 0.8,
    };
    expect(assignPickupSeats([pickup], [
      { start: 0, end: 2, seat: "N1" },
      { start: 2, end: 4, seat: "N2" },
    ])[0].seat).toBe("N2");
  });

  it("clears seat-pack audio references that are not copied into the subset", () => {
    const chapter = {
      id: "ch01",
      index: 1,
      title: "One",
      text_path: "manuscript/chapters/01.json",
      audio_path: "audio/mix.wav",
      raw_audio_path: "audio/raw.wav",
      edited_audio_path: "audio/edited.wav",
      bed_audio_path: "audio/bed.wav",
      overdub_audio_path: "audio/overdub.wav",
      duet_mix_path: "audio/mix.wav",
      n1_stem_path: "audio/N1.wav",
      n2_stem_path: "audio/N2.wav",
      acx_traffic_light: "green" as const,
      open_pickups: 2,
      notes_path: "notes/ch01.md",
      author_status: "draft" as const,
    };

    expect(seatPackChapterSubset(chapter)).toMatchObject({
      bed_audio_path: "audio/bed.wav",
      audio_path: undefined,
      raw_audio_path: undefined,
      edited_audio_path: undefined,
      overdub_audio_path: undefined,
      duet_mix_path: undefined,
      n1_stem_path: undefined,
      n2_stem_path: undefined,
      acx_traffic_light: undefined,
      open_pickups: undefined,
      notes_path: undefined,
    });
  });
});
