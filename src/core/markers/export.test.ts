import { describe, expect, it } from "vitest";
import { audacityLabels, markerFileSet, reaperMarkers } from "./export";
import type { Pickup } from "../project/types";

const pickups: Pickup[] = [
  {
    id: "b",
    chapter_id: "ch01",
    t_start: 12.3456,
    t_end: 13.1,
    expected: "Leominster",
    heard: "Lemster",
    kind: "sub",
    seat: "N1",
    status: "open",
    confidence: 0.9,
  },
  {
    id: "a",
    chapter_id: "ch01",
    t_start: 2,
    t_end: 3,
    expected: "",
    heard: "extra word",
    kind: "insert",
    seat: "narration",
    status: "ignored",
    confidence: 0.7,
  },
];

describe("DAW marker export", () => {
  it("writes deterministic Audacity labels and skips ignored pickups by default", () => {
    expect(audacityLabels(pickups)).toBe("12.346\t13.100\tLeominster → Lemster [sub]\n");
    expect(audacityLabels(pickups, { includeIgnored: true })).toContain("2.000\t3.000\t— → extra word [insert]");
  });

  it("writes escaped Reaper CSV rows and a named marker file set", () => {
    const csv = reaperMarkers(pickups);
    expect(csv).toContain("#\tName\tStart\tEnd");
    expect(csv).toContain("1\tLeominster → Lemster [sub]\t12.346\t13.100");
    expect(markerFileSet("01_chapter_01", pickups).map((file) => file.fileName)).toEqual([
      "01_chapter_01_audacity_labels.txt",
      "01_chapter_01_reaper_markers.tsv",
      "01_chapter_01_MARKERS_README.txt",
    ]);
  });
});
