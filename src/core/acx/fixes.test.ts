import { describe, expect, it } from "vitest";
import {
  CHECK_DEFINITIONS,
  checkValue,
  compareReports,
  exportSettles,
  summarizeExportFixes,
  type CheckKey,
} from "./fixes";
import {
  formatChannels,
  formatDb,
  formatLength,
  formatLufs,
  formatRoomTone,
  formatSampleRate,
} from "./format";
import type { AcxReport } from "./measure";
import type { ReportEntry } from "./export";
import { trafficLight, type CheckStatus } from "./spec";

describe("what mastering settled", () => {
  it("reads a rough take as fixed rather than as failures", () => {
    const changes = compareReports(mastered(), roughTake());
    expect(outcome(changes, "sample_rate")).toBe("fixed");
    expect(outcome(changes, "true_peak")).toBe("fixed");
    expect(outcome(changes, "head_room_tone")).toBe("fixed");
    expect(outcome(changes, "tail_room_tone")).toBe("fixed");
    expect(find(changes, "sample_rate")).toMatchObject({
      before: "16.0 kHz",
      after: "44.1 kHz",
      detail: "Resampled to 44.1 kHz.",
    });
    expect(find(changes, "tail_room_tone").detail).toContain("Tail padded with room tone");
  });

  it("still reports a level the target already accepted, because the number moved", () => {
    const changes = compareReports(mastered(), roughTake());
    expect(find(changes, "channels")).toMatchObject({
      outcome: "adjusted",
      before: "Stereo",
      after: "Mono",
      detail: "Mixed down to mono.",
    });
    expect(find(changes, "format")).toMatchObject({
      outcome: "adjusted",
      before: "WAV",
      after: "MP3 192 kbps CBR",
      detail: "Encoded to MP3 192 kbps CBR.",
    });
  });

  it("says nothing happened when nothing happened", () => {
    const change = find(compareReports(mastered(), mastered()), "rms");
    expect(change.outcome).toBe("held");
    expect(change.detail).toBe("Already inside the target, and left alone.");
  });

  it("describes a floor from the numbers, not from the pipeline", () => {
    const gated = find(compareReports(mastered({ noise_floor_dbfs: -80 }), roughTake({ noise_floor_dbfs: -64 })), "noise_floor");
    expect(gated.detail).toBe("Steady background noise was reduced automatically.");
    const lifted = find(compareReports(mastered({ noise_floor_dbfs: -64 }), roughTake({ noise_floor_dbfs: -80 })), "noise_floor");
    expect(lifted.detail).toBe("Still under the limit after the level lift.");
  });

  it("hands back the remedy for a dimension mastering cannot settle", () => {
    const changes = compareReports(
      mastered({ noise_floor_dbfs: -52, checks: { noise_floor: "fail" } }),
      roughTake(),
    );
    const floor = find(changes, "noise_floor");
    expect(floor.outcome).toBe("outstanding");
    expect(floor.detail).toContain("Treat the room or use a cleaner take");
  });

  it("claims no fix for a file that was never measured beforehand", () => {
    const changes = compareReports(mastered());
    expect(changes.every((change) => change.before === undefined)).toBe(true);
    expect(changes.some((change) => change.outcome === "fixed")).toBe(false);
    expect(changes.some((change) => change.outcome === "adjusted")).toBe(false);
  });

  it("leaves an unspecified target unjudged instead of passing it", () => {
    expect(outcome(compareReports(mastered(), roughTake()), "loudness")).toBe("unjudged");
  });
});

describe("the delivery checklist", () => {
  it("groups every chapter into one row per dimension", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake()),
      entry("02_chapter_02.mp3", mastered(), roughTake({ sample_rate: 22050, true_peak_dbfs: -0.4 })),
    ]);

    expect(summary.ready).toBe(true);
    expect(summary.measuredFiles).toBe(2);
    expect(summary.fixed.map((row) => row.key)).toEqual([
      "sample_rate",
      "true_peak",
      "head_room_tone",
      "tail_room_tone",
    ]);
    expect(summary.adjusted.map((row) => row.key)).toEqual(["channels", "rms", "format", "duration"]);
    expect(summary.completed.map((row) => row.key)).toEqual([
      "sample_rate",
      "channels",
      "rms",
      "true_peak",
      "head_room_tone",
      "tail_room_tone",
      "format",
      "duration",
    ]);
    expect(summary.adjusted.find((row) => row.key === "duration")).toMatchObject({
      before: "7 min 14 s",
      after: "7 min 17 s",
      detail: "Longer by the room tone pads.",
    });
    expect(summary.held).toEqual(["Noise floor"]);
    expect(summary.unjudged).toEqual(["Loudness"]);
  });

  it("shows a range when the chapters disagree and one reading when they agree", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake({ sample_rate: 16000 })),
      entry("02_chapter_02.mp3", mastered(), roughTake({ sample_rate: 22050 })),
    ]);
    const rate = summary.fixed.find((row) => row.key === "sample_rate");
    expect(rate).toMatchObject({ before: "16.0 to 22.1 kHz", after: "44.1 kHz", fileCount: 2 });
  });

  it("lists channel counts rather than pretending mono and stereo are a range", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake({ channels: 2 })),
      entry("02_chapter_02.mp3", mastered(), roughTake({ channels: 4 })),
    ]);
    expect(summary.adjusted.find((row) => row.key === "channels")?.before).toBe("Stereo and 4 channels");
  });

  it("holds back readiness while any file is still outside the target", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake()),
      { ...entry("02_chapter_02.mp3", mastered({ tail_room_tone_s: 0.2, checks: { tail_room_tone: "warn" } }), roughTake()), status: "warn" },
    ]);

    expect(summary.ready).toBe(false);
    expect(summary.outstanding.map((row) => row.key)).toEqual(["tail_room_tone"]);
    expect(summary.outstanding[0].fileNames).toEqual(["02_chapter_02.mp3"]);
    expect(summary.outstanding[0].remedy).toContain("pads the tail");
    expect(summary.fixed.map((row) => row.key)).not.toContain("tail_room_tone");
  });

  it("carries a note from a file that could not be measured", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake()),
      { fileName: "99_retail_sample.mp3", status: "not_measured", note: "Too short for a retail sample." },
    ]);

    expect(summary.measuredFiles).toBe(1);
    expect(summary.ready).toBe(false);
    expect(summary.notes).toEqual([{ fileName: "99_retail_sample.mp3", note: "Too short for a retail sample." }]);
    expect(summary.files.find((file) => file.fileName === "99_retail_sample.mp3")?.measured).toBe(false);
  });

  it("counts a fix against the files it could have been compared in", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake()),
      entry("02_chapter_02.mp3", mastered(), roughTake()),
      // Cut from a chapter that is already mastered, so it has no take to beat.
      entry("99_retail_sample.mp3", mastered()),
    ]);

    const rate = summary.fixed.find((row) => row.key === "sample_rate");
    expect(rate).toMatchObject({ fileCount: 2, ofFiles: 2 });
  });

  it("counts an outstanding check against every measured file", () => {
    const summary = summarizeExportFixes([
      entry("01_chapter_01.mp3", mastered(), roughTake()),
      entry("02_chapter_02.mp3", mastered({ noise_floor_dbfs: -52, checks: { noise_floor: "fail" } }), roughTake()),
    ]);

    expect(summary.outstanding[0]).toMatchObject({ key: "noise_floor", fileCount: 1, ofFiles: 2 });
  });

  it("confirms automatic noise cleanup in the same delivery checklist", () => {
    const noisy = roughTake({
      noise_floor_dbfs: -52,
      checks: { noise_floor: "fail" },
    });
    const entryWithCleanup: ReportEntry = {
      ...entry("01_chapter_01.mp3", mastered({ noise_floor_dbfs: -66 }), noisy),
      processing: { automaticNoiseReductionDb: 10 },
    };
    const summary = summarizeExportFixes([entryWithCleanup]);

    expect(summary.completed.find((row) => row.key === "noise_floor")).toMatchObject({
      outcome: "fixed",
      detail: "Reduced steady background noise automatically, using up to 10 dB of cleanup.",
    });
    expect(summary.outstanding).toEqual([]);
  });

  it("puts click and clipping restoration first in the same delivery checklist", () => {
    const restored: ReportEntry = {
      ...entry("01_chapter_01.mp3", mastered(), roughTake()),
      processing: {
        automaticRestoration: {
          changedSamples: 24,
          changedRatio: 0.0004,
          levelShiftDb: 0.003,
        },
      },
    };
    const summary = summarizeExportFixes([restored]);

    expect(summary.completed[0]).toMatchObject({
      key: "restoration",
      label: "Clicks & clipped peaks",
      outcome: "fixed",
      after: "Repaired",
      fileCount: 1,
      ofFiles: 1,
    });
    expect(summary.completed[0].detail).toContain("24 damaged samples");
    expect(summary.completed[0].detail).toContain("0.003 dB");
  });
});

describe("check definitions", () => {
  it("covers every measured check exactly once", () => {
    const keys = CHECK_DEFINITIONS.map((definition) => definition.key);
    expect([...keys].sort()).toEqual(Object.keys(mastered().checks).sort());
  });

  it("names export as the owner of everything the master and the encoder touch", () => {
    expect(CHECK_DEFINITIONS.filter((definition) => exportSettles(definition.key)).map((definition) => definition.key))
      .toEqual(["sample_rate", "channels", "noise_floor", "rms", "loudness", "true_peak", "head_room_tone", "tail_room_tone", "format"]);
    expect(exportSettles("noise_floor")).toBe(true);
    expect(exportSettles("duration")).toBe(false);
  });

  it("spells a value the same way the meter table does", () => {
    const report = mastered();
    expect(checkValue("rms", report)).toBe(formatDb(report.rms_dbfs));
    expect(checkValue("loudness", report)).toBe(formatLufs(report.lufs_integrated));
    expect(checkValue("true_peak", report)).toBe(formatDb(report.true_peak_dbfs));
    expect(checkValue("noise_floor", report)).toBe(formatDb(report.noise_floor_dbfs));
    expect(checkValue("sample_rate", report)).toBe(formatSampleRate(report.sample_rate));
    expect(checkValue("channels", report)).toBe(formatChannels(report.channels));
    expect(checkValue("duration", report)).toBe(formatLength(report.duration_seconds));
    expect(checkValue("head_room_tone", report)).toBe(formatRoomTone(report.head_room_tone_s));
    expect(checkValue("tail_room_tone", report)).toBe(formatRoomTone(report.tail_room_tone_s));
  });
});

function outcome(changes: ReturnType<typeof compareReports>, key: CheckKey): string {
  return find(changes, key).outcome;
}

function find(changes: ReturnType<typeof compareReports>, key: CheckKey) {
  const change = changes.find((candidate) => candidate.key === key);
  if (!change) {
    throw new Error(`No change row for ${key}`);
  }
  return change;
}

function entry(fileName: string, after: AcxReport, before?: AcxReport): ReportEntry {
  return { fileName, before, after, status: "pass" };
}

type Overrides = Partial<Omit<AcxReport, "checks">> & { checks?: Partial<AcxReport["checks"]> };

/** A 16 kHz stereo take with no room tone: what a narrator actually hands over. */
function roughTake(overrides: Overrides = {}): AcxReport {
  return report({
    rms_dbfs: -21.2,
    lufs_integrated: -20.1,
    true_peak_dbfs: 0,
    noise_floor_dbfs: -98.6,
    sample_rate: 16000,
    channels: 2,
    duration_seconds: 434,
    format: "wav",
    head_room_tone_s: 0.46,
    tail_room_tone_s: 0,
    checks: {
      true_peak: "fail",
      sample_rate: "fail",
      head_room_tone: "fail",
      tail_room_tone: "fail",
      ...overrides.checks,
    },
    ...overrides,
  });
}

/** The same take after the master and the MP3 encoder have had it. */
function mastered(overrides: Overrides = {}): AcxReport {
  return report({
    rms_dbfs: -20,
    lufs_integrated: -19.4,
    true_peak_dbfs: -3.2,
    noise_floor_dbfs: -98.6,
    sample_rate: 44100,
    channels: 1,
    duration_seconds: 437,
    format: "mp3",
    bitrate_kbps: 192,
    vbr: false,
    head_room_tone_s: 1.5,
    tail_room_tone_s: 1.5,
    ...overrides,
  });
}

function report(overrides: Overrides): AcxReport {
  const checks: Record<string, CheckStatus> = {
    rms: "pass",
    loudness: "unspecified",
    true_peak: "pass",
    noise_floor: "pass",
    sample_rate: "pass",
    channels: "pass",
    duration: "pass",
    format: "pass",
    head_room_tone: "pass",
    tail_room_tone: "pass",
    ...overrides.checks,
  };
  return {
    preset_id: "acx",
    preset_label: "ACX / Audible",
    preset_source: "test fixture",
    rms_dbfs: -20,
    lufs_integrated: -19.4,
    true_peak_dbfs: -3.2,
    sample_peak_dbfs: -3.4,
    noise_floor_dbfs: -70,
    noise_floor_start_seconds: 0.2,
    noise_floor_duration_seconds: 0.8,
    sample_rate: 44100,
    channels: 1,
    duration_seconds: 400,
    format: "wav",
    head_room_tone_s: 1.5,
    tail_room_tone_s: 1.5,
    head_room_tone_is_digital_silence: false,
    tail_room_tone_is_digital_silence: false,
    traffic_light: trafficLight(checks),
    ...overrides,
    checks: checks as AcxReport["checks"],
  };
}
