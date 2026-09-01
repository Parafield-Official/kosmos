import { describe, expect, it } from "vitest";
import {
  audacityLabels,
  auditionMarkerCsv,
  markerFileSet,
  pickupCsv,
  reaperRegionCsv,
  subtitleSrt,
} from "./export";
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

/** A label with a comma is the case a tab-delimited writer used to get wrong. */
const commaPickup: Pickup = {
  id: "c",
  chapter_id: "ch01",
  t_start: 3725.5,
  t_end: 3725.5,
  expected: "yes, of course",
  heard: "yes of course",
  kind: "sub",
  seat: "narration",
  status: "open",
  confidence: 0.42,
  note: "author says\nleave it",
};

describe("DAW marker export", () => {
  it("writes deterministic Audacity labels and skips ignored pickups by default", () => {
    expect(audacityLabels(pickups)).toBe("12.346\t13.100\tLeominster → Lemster [sub]\n");
    expect(audacityLabels(pickups, { includeIgnored: true })).toContain("2.000\t3.000\t— → extra word [insert]");
  });

  it("writes Reaper regions as comma-separated rows with a length column", () => {
    const csv = reaperRegionCsv(pickups);
    expect(csv.split("\n")[0]).toBe("#,Name,Start,End,Length,Color");
    expect(csv).toContain("R1,Leominster → Lemster [sub],12.346,13.100,0.754,");
  });

  it("quotes Reaper and pickup fields that contain a comma", () => {
    expect(reaperRegionCsv([commaPickup])).toContain('"yes, of course → yes of course [sub]"');
    expect(pickupCsv([commaPickup])).toContain('"yes, of course"');
  });

  it("writes Audition markers as a tab-delimited table with decimal times", () => {
    const csv = auditionMarkerCsv(pickups);
    expect(csv.split("\n")[0]).toBe("Name\tStart\tDuration\tTime Format\tType\tDescription");
    expect(csv).toContain("Leominster → Lemster [sub]\t0:12.346\t0:00.754\tdecimal\tCue\t");
  });

  it("widens Audition times past an hour and flattens a multi-line note", () => {
    const csv = auditionMarkerCsv([commaPickup]);
    expect(csv).toContain("\t1:02:05.500\t0:00.000\tdecimal\tCue\tauthor says leave it");
  });

  it("gives every subtitle cue a visible duration", () => {
    const srt = subtitleSrt([commaPickup]);
    expect(srt).toContain("01:02:05,500 --> 01:02:06,000");
    expect(subtitleSrt(pickups)).toContain("00:00:12,346 --> 00:00:13,100");
  });

  it("names one file per editor plus a README", () => {
    expect(markerFileSet("01_chapter_01", pickups).map((file) => file.fileName)).toEqual([
      "01_chapter_01_audacity_labels.txt",
      "01_chapter_01_reaper_regions.csv",
      "01_chapter_01_audition_markers.csv",
      "01_chapter_01_pickups.csv",
      "01_chapter_01_pickups.srt",
      "01_chapter_01_MARKERS_README.txt",
    ]);
  });

  it("tells the reader that Pro Tools needs a converter", () => {
    const readme = markerFileSet("01", pickups).find((file) => file.fileName.endsWith("README.txt"));
    expect(readme?.contents).toContain("Pro Tools cannot import text or CSV markers");
  });
});
