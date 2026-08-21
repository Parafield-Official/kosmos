import { describe, expect, it } from "vitest";
import {
  buildPacketHtml,
  buildPacketWorkbookParts,
  columnName,
  planPacketClips,
  type PacketClip,
} from "./packet";
import type { Pickup } from "../project/types";

function pickup(overrides: Partial<Pickup> & { id: string }): Pickup {
  return {
    chapter_id: "ch01",
    t_start: 10,
    t_end: 10.4,
    expected: "dawn",
    heard: "down",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.82,
    ...overrides,
  };
}

describe("planPacketClips", () => {
  it("keeps context either side of a flag", () => {
    const [clip] = planPacketClips([pickup({ id: "a", t_start: 30, t_end: 30.5 })], { padSeconds: 2 });
    expect(clip.start).toBeCloseTo(28, 5);
    expect(clip.end).toBeCloseTo(32.5, 5);
    expect(clip.pickupIds).toEqual(["a"]);
  });

  it("never starts before the recording or runs past its end", () => {
    const clips = planPacketClips(
      [
        pickup({ id: "a", t_start: 0.4, t_end: 0.9 }),
        pickup({ id: "b", t_start: 59.5, t_end: 59.9 }),
      ],
      { padSeconds: 3, durationSeconds: 60 },
    );
    expect(clips[0].start).toBe(0);
    expect(clips[1].end).toBeCloseTo(60, 5);
  });

  it("shares one clip between flags that sit on top of each other", () => {
    const clips = planPacketClips(
      [
        pickup({ id: "a", t_start: 10, t_end: 10.3 }),
        pickup({ id: "b", t_start: 11, t_end: 11.2 }),
        pickup({ id: "c", t_start: 40, t_end: 40.2 }),
      ],
      { padSeconds: 2 },
    );
    expect(clips).toHaveLength(2);
    expect(clips[0].pickupIds).toEqual(["a", "b"]);
    expect(clips[1].pickupIds).toEqual(["c"]);
  });

  it("stops merging rather than growing one clip without limit", () => {
    const dense = Array.from({ length: 40 }, (_, index) => pickup({
      id: `p${index}`,
      t_start: index * 1.5,
      t_end: index * 1.5 + 0.3,
    }));
    const clips = planPacketClips(dense, { padSeconds: 2, maxClipSeconds: 12 });
    expect(clips.length).toBeGreaterThan(1);
    for (const clip of clips) {
      expect(clip.end - clip.start).toBeLessThanOrEqual(12.001);
    }
    expect(clips.flatMap((clip) => clip.pickupIds)).toHaveLength(dense.length);
  });

  it("orders clips by time whatever order the flags arrive in", () => {
    const clips = planPacketClips([
      pickup({ id: "late", t_start: 90, t_end: 90.2 }),
      pickup({ id: "early", t_start: 5, t_end: 5.2 }),
    ], { padSeconds: 1 });
    expect(clips.map((clip) => clip.pickupIds[0])).toEqual(["early", "late"]);
    expect(clips[0].fileName.startsWith("001_")).toBe(true);
    expect(clips[1].fileName.startsWith("002_")).toBe(true);
  });

  it("gives every clip a distinct file name", () => {
    const clips = planPacketClips(
      Array.from({ length: 12 }, (_, index) => pickup({
        id: `p${index}`,
        t_start: index * 30,
        t_end: index * 30 + 0.4,
      })),
      { padSeconds: 1 },
    );
    expect(new Set(clips.map((clip) => clip.fileName)).size).toBe(clips.length);
    for (const clip of clips) {
      expect(clip.fileName).toMatch(/^\d{3}_\d{2}m\d{2}s\d\.mp3$/);
    }
  });

  it("drops a flag with impossible timing instead of writing a broken clip", () => {
    const clips = planPacketClips([
      pickup({ id: "bad", t_start: Number.NaN, t_end: Number.NaN }),
      pickup({ id: "good", t_start: 12, t_end: 12.3 }),
    ], { padSeconds: 1 });
    expect(clips).toHaveLength(1);
    expect(clips[0].pickupIds).toEqual(["good"]);
  });
});

describe("buildPacketHtml", () => {
  const clips: PacketClip[] = [
    { fileName: "001_00m08s0.mp3", start: 8, end: 12, pickupIds: ["a"] },
  ];

  it("puts a player beside every flag that has a clip", () => {
    const html = buildPacketHtml({
      chapterIndex: 3,
      chapterTitle: "The Pier",
      pickups: [pickup({ id: "a", t_start: 10, t_end: 10.4 })],
      clips,
    });
    expect(html).toContain("src=\"clips/001_00m08s0.mp3\"");
    expect(html).toContain("Chapter 3: The Pier");
    expect(html).toContain("dawn");
    expect(html).toContain("down");
  });

  it("says so plainly when a flag has no clip", () => {
    const html = buildPacketHtml({
      chapterIndex: 1,
      chapterTitle: "One",
      pickups: [pickup({ id: "orphan" })],
      clips: [],
    });
    expect(html).toContain("No clip");
    expect(html).not.toContain("<audio");
  });

  it("escapes script text so a manuscript cannot break the page", () => {
    const html = buildPacketHtml({
      chapterIndex: 1,
      chapterTitle: "<script>alert(1)</script>",
      pickups: [pickup({ id: "a", expected: "a < b & c", heard: "<b>bold</b>", note: "\"quoted\"" })],
      clips,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("escapes a clip path used as an attribute", () => {
    const html = buildPacketHtml({
      chapterIndex: 1,
      chapterTitle: "One",
      pickups: [pickup({ id: "a" })],
      clips: [{ fileName: "he\"llo.mp3", start: 8, end: 12, pickupIds: ["a"] }],
      clipFolder: "clips",
    });
    expect(html).toContain("src=\"clips/he&quot;llo.mp3\"");
  });

  it("counts what is still open in the header", () => {
    const html = buildPacketHtml({
      chapterIndex: 1,
      chapterTitle: "One",
      generatedAt: "2026-08-20T00:00:00.000Z",
      pickups: [
        pickup({ id: "a" }),
        pickup({ id: "b", status: "done" }),
        pickup({ id: "c", status: "ignored" }),
      ],
      clips: [],
    });
    expect(html).toContain("1 open of 3 flagged");
    expect(html).toContain("2026-08-20T00:00:00.000Z");
  });

  it("says a clean chapter is clean rather than printing an empty table", () => {
    const html = buildPacketHtml({ chapterIndex: 1, chapterTitle: "One", pickups: [], clips: [] });
    expect(html).toContain("Nothing was flagged");
    expect(html).not.toContain("<tbody>");
  });

  it("lists flags in time order", () => {
    const html = buildPacketHtml({
      chapterIndex: 1,
      chapterTitle: "One",
      pickups: [
        pickup({ id: "late", t_start: 80, t_end: 80.2, expected: "later" }),
        pickup({ id: "early", t_start: 4, t_end: 4.2, expected: "sooner" }),
      ],
      clips: [],
    });
    expect(html.indexOf("sooner")).toBeLessThan(html.indexOf("later"));
  });
});

describe("buildPacketWorkbookParts", () => {
  const input = {
    chapterIndex: 2,
    chapterTitle: "The Pier",
    pickups: [
      pickup({ id: "a", t_start: 10.25, t_end: 10.75, note: "say it again" }),
      pickup({ id: "b", t_start: 42, t_end: 42.5, kind: "pause" as const, expected: "", heard: "" }),
    ],
    clips: [{ fileName: "001_00m08s0.mp3", start: 8, end: 13, pickupIds: ["a", "b"] }],
  };

  it("writes the parts a spreadsheet reader expects", () => {
    const parts = buildPacketWorkbookParts(input);
    expect(parts.map((part) => part.path)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
    for (const part of parts) {
      expect(part.contents.startsWith("<?xml version=\"1.0\"")).toBe(true);
    }
  });

  it("puts a header row and one row per flag on the sheet", () => {
    const sheet = buildPacketWorkbookParts(input)
      .find((part) => part.path === "xl/worksheets/sheet1.xml")?.contents ?? "";
    expect(sheet).toContain("<row r=\"1\">");
    expect(sheet).toContain("Timecode");
    expect(sheet).toContain("<row r=\"2\">");
    expect(sheet).toContain("<row r=\"3\">");
    expect(sheet).not.toContain("<row r=\"4\">");
    expect(sheet).toContain("say it again");
    expect(sheet).toContain("Chapter 2: The Pier");
  });

  it("stores times and confidence as numbers a spreadsheet can sort", () => {
    const sheet = buildPacketWorkbookParts(input)
      .find((part) => part.path === "xl/worksheets/sheet1.xml")?.contents ?? "";
    expect(sheet).toContain("<c r=\"C2\"><v>10.25</v></c>");
    expect(sheet).toContain("<c r=\"D2\"><v>10.75</v></c>");
    expect(sheet).toContain("<c r=\"I2\"><v>0.82</v></c>");
  });

  it("escapes spreadsheet text and leaves blank cells empty", () => {
    const parts = buildPacketWorkbookParts({
      ...input,
      pickups: [pickup({ id: "a", expected: "Smith & <Jones>", heard: "", note: "" })],
    });
    const sheet = parts.find((part) => part.path === "xl/worksheets/sheet1.xml")?.contents ?? "";
    expect(sheet).toContain("Smith &amp; &lt;Jones&gt;");
    expect(sheet).toContain("<c r=\"G2\"/>");
    expect(sheet).toContain("<c r=\"J2\"/>");
  });

  it("names spreadsheet columns past Z", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(11)).toBe("L");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(27)).toBe("AB");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
  });
});
