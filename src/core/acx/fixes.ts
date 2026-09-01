/**
 * What mastering settled, and what is still the narrator's problem.
 *
 * Export masters every chapter, so the table the narrator reads before export
 * is a picture of the source take, not of the file that gets delivered: a 16 kHz
 * stereo take with no room tone fails five checks that mastering fixes without
 * being asked. Reporting that as five failures and then silently shipping a
 * clean file teaches the narrator to distrust the meter.
 *
 * This module names, per dimension, who can settle it — the master, the encoder,
 * the room, or the manuscript — and turns a before/after pair of measurements
 * into the list of changes that actually happened. The same definitions carry
 * the promise before export and the receipt after it, so the two can never
 * disagree about what mastering does.
 */

import type { ReportEntry } from "./export";
import {
  fixedNumber,
  formatChannels,
  formatLength,
} from "./format";
import type { AcxReport } from "./measure";
import {
  ACX_PRESET,
  deliveryProfile,
  resolvePreset,
  type DeliveryProfile,
} from "./presets";
import type { CheckStatus, TrafficLight } from "./spec";

export type CheckKey = keyof AcxReport["checks"];
export type RestorationKey = "restoration";
export type ChecklistKey = CheckKey | RestorationKey;

/** Who can settle a dimension. Only the first two happen during export. */
export type CheckOwner = "master" | "encode" | "room" | "manuscript";

export interface CheckDefinition {
  key: CheckKey;
  label: string;
  owner: CheckOwner;
  /** Future tense, shown against the source take before export. */
  promise: string;
  /** What to do about it when the mastered file still misses the target. */
  remedy: string;
}

/**
 * Ordered the way mastering works: rate and channels, then the room, then
 * levels, then the pads, then the container. A checklist that reads in
 * processing order tells the story of what happened to the file.
 */
export const CHECK_DEFINITIONS: readonly CheckDefinition[] = Object.freeze([
  {
    key: "sample_rate",
    label: "Sample rate",
    owner: "master",
    promise: "Export resamples to 44.1 kHz",
    remedy: "Re-export; the master always resamples to 44.1 kHz.",
  },
  {
    key: "channels",
    label: "Channels",
    owner: "master",
    promise: "Export mixes down to mono",
    remedy: "Re-export; the master always delivers one channel.",
  },
  {
    key: "noise_floor",
    label: "Noise floor",
    owner: "master",
    promise: "Export reduces steady background noise, then checks it again",
    remedy: "Automatic cleanup reached its safe cap. Treat the room or use a cleaner take.",
  },
  {
    key: "rms",
    label: "RMS",
    owner: "master",
    promise: "Export levels this into the target window",
    remedy: "Re-record closer to the mic; the take is too far from the window to reach it safely.",
  },
  {
    key: "loudness",
    label: "Loudness",
    owner: "master",
    promise: "Follows the levelling",
    remedy: "Change the delivery target if this figure has to land somewhere specific.",
  },
  {
    key: "true_peak",
    label: "True peak",
    owner: "master",
    promise: "Export limits peaks under the ceiling",
    remedy: "Re-export; the limiter works to the ceiling in the delivery target.",
  },
  {
    key: "head_room_tone",
    label: "Head room tone",
    owner: "master",
    promise: "Export pads the head with room tone",
    remedy: "Re-export; the master pads the head from the quietest part of the take.",
  },
  {
    key: "tail_room_tone",
    label: "Tail room tone",
    owner: "master",
    promise: "Export pads the tail with room tone",
    remedy: "Re-export; the master pads the tail from the quietest part of the take.",
  },
  {
    key: "format",
    label: "Format",
    owner: "encode",
    promise: "Export encodes 192 kbps CBR MP3",
    remedy: "Re-export; the encoder writes 192 kbps CBR MP3.",
  },
  {
    key: "duration",
    label: "Length",
    owner: "manuscript",
    promise: "Unchanged, apart from the room tone pads",
    remedy: "Split the chapter. Mastering cannot shorten a read.",
  },
]);

const DEFINITIONS = new Map<CheckKey, CheckDefinition>(
  CHECK_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function checkDefinition(
  key: CheckKey,
  profile: DeliveryProfile = deliveryProfile(ACX_PRESET),
): CheckDefinition {
  const definition = DEFINITIONS.get(key);
  if (!definition) {
    throw new Error(`Unknown ACX check: ${key}`);
  }
  switch (key) {
    case "sample_rate":
      return {
        ...definition,
        promise: `Export resamples to ${(profile.sampleRate / 1000).toFixed(1)} kHz`,
        remedy: `Re-export; this target always resamples to ${(profile.sampleRate / 1000).toFixed(1)} kHz.`,
      };
    case "channels":
      return {
        ...definition,
        promise: "Export prepares a mono delivery master",
        remedy: "Re-export; this target always writes one channel.",
      };
    case "format":
      return {
        ...definition,
        promise: profile.container === "mp3"
          ? `Export encodes ${profile.bitrateKbps ?? 192} kbps CBR MP3`
          : `Export writes ${profile.pcmBitDepth ?? 24}-bit WAV`,
        remedy: `Re-export; this target writes ${profile.container.toUpperCase()}.`,
      };
    default:
      return definition;
  }
}

/** True when export itself settles the dimension, without asking anyone. */
export function exportSettles(
  key: CheckKey,
  profile: DeliveryProfile = deliveryProfile(ACX_PRESET),
): boolean {
  const owner = checkDefinition(key, profile).owner;
  return owner === "master" || owner === "encode";
}

interface Metric {
  read(report: AcxReport): number | undefined;
  /** The number without its unit, so a range reads "−25.3 to −19.8 dBFS". */
  number?(value: number): string;
  unit?: string;
  /**
   * Whether a low and a high reading describe the set. Levels and lengths do;
   * "Mono to Stereo" does not, so channel counts are listed instead.
   */
  rangeable?: boolean;
  /** Replaces number and unit for a dimension that is not a measurement. */
  text?(report: AcxReport): string;
}

const METRICS: Record<CheckKey, Metric> = {
  sample_rate: { read: (report) => report.sample_rate, number: (value) => (value / 1000).toFixed(1), unit: "kHz", rangeable: true },
  channels: { read: (report) => report.channels, number: formatChannels },
  noise_floor: { read: (report) => report.noise_floor_dbfs, number: fixedNumber, unit: "dBFS", rangeable: true },
  rms: { read: (report) => report.rms_dbfs, number: fixedNumber, unit: "dBFS", rangeable: true },
  loudness: { read: (report) => report.lufs_integrated, number: fixedNumber, unit: "LUFS", rangeable: true },
  true_peak: { read: (report) => report.true_peak_dbfs, number: fixedNumber, unit: "dBFS", rangeable: true },
  head_room_tone: { read: (report) => report.head_room_tone_s, number: (value) => value.toFixed(2), unit: "s", rangeable: true },
  tail_room_tone: { read: (report) => report.tail_room_tone_s, number: (value) => value.toFixed(2), unit: "s", rangeable: true },
  format: { read: () => undefined, text: deliveryFormat },
  duration: { read: (report) => report.duration_seconds, number: formatLength, rangeable: true },
};

/** The container as it would be delivered, bitrate and mode included. */
function deliveryFormat(report: AcxReport): string {
  const container = report.format.toUpperCase();
  if (report.format !== "mp3" || report.bitrate_kbps === undefined) {
    return container;
  }
  const mode = report.vbr === true ? " VBR" : report.vbr === false ? " CBR" : "";
  return `${container} ${report.bitrate_kbps.toFixed(0)} kbps${mode}`;
}

export function checkValue(key: CheckKey, report: AcxReport): string {
  const metric = METRICS[key];
  if (metric.text) {
    return metric.text(report);
  }
  const value = metric.read(report);
  if (value === undefined || !metric.number) {
    return "—";
  }
  const number = metric.number(value);
  return metric.unit ? `${number} ${metric.unit}` : number;
}

/**
 * `fixed` was outside the target and now is not. `adjusted` was already inside
 * it and mastering still moved the number, which the narrator deserves to see
 * before they wonder why the delivered file measures differently. `held` means
 * nothing happened, and `outstanding` means nothing we can do happened.
 */
export type FixOutcome = "fixed" | "adjusted" | "held" | "outstanding" | "unjudged";

export interface CheckChange {
  key: CheckKey;
  label: string;
  owner: CheckOwner;
  outcome: FixOutcome;
  /** Plain past tense: what mastering did to this dimension, or what is left. */
  detail: string;
  before?: string;
  after: string;
  /** The reading behind each spelling, kept so ranges sort by value. */
  beforeValue?: number;
  afterValue?: number;
  beforeStatus?: CheckStatus;
  afterStatus: CheckStatus;
}

export interface FileFixes {
  fileName: string;
  status: ReportEntry["status"];
  note?: string;
  measured: boolean;
  trafficLight?: TrafficLight;
  presetLabel?: string;
  changes: CheckChange[];
  fixedCount: number;
  outstandingCount: number;
}

/**
 * One row of the delivery checklist, speaking for every file that shares the
 * outcome. Values collapse to a single reading when the files agree and to a
 * range when they do not, because "−25.3 to −19.8 dBFS" is a fact while an
 * average of two chapters is not.
 */
export interface AggregateChange {
  key: ChecklistKey;
  label: string;
  owner: CheckOwner;
  outcome: Exclude<FixOutcome, "held" | "unjudged">;
  detail: string;
  remedy?: string;
  before?: string;
  after: string;
  fileCount: number;
  /**
   * How many files could have landed in this row at all. A retail sample is cut
   * from a chapter that is already mastered, so it has nothing to compare and
   * must not turn "fixed everywhere" into "fixed in 2 of 3 files".
   */
  ofFiles: number;
  fileNames: string[];
}

export interface ExportFixSummary {
  files: FileFixes[];
  measuredFiles: number;
  /** The target the delivered files were judged against, named so "ready" means something. */
  presetLabel?: string;
  /** Was outside the target before mastering and inside it after. */
  fixed: AggregateChange[];
  /** Was already inside the target, and mastering moved the number anyway. */
  adjusted: AggregateChange[];
  /** One user-facing checklist: corrected and prepared rows in processing order. */
  completed: AggregateChange[];
  /** Still outside the target in the delivered file. */
  outstanding: AggregateChange[];
  /** Already inside the target and left alone, by label. */
  held: string[];
  /** Measured, but the delivery target sets no limit, by label. */
  unjudged: string[];
  notes: Array<{ fileName: string; note: string }>;
  ready: boolean;
}

export function compareReports(
  after: AcxReport,
  before?: AcxReport,
  profile: DeliveryProfile = deliveryProfile(resolvePreset(after.preset_id)),
): CheckChange[] {
  return CHECK_DEFINITIONS.map((baseDefinition) => {
    const definition = checkDefinition(baseDefinition.key, profile);
    const key = definition.key;
    const afterValue = checkValue(key, after);
    const beforeValue = before ? checkValue(key, before) : undefined;
    const afterStatus = after.checks[key];
    const beforeStatus = before?.checks[key];
    const moved = beforeValue !== undefined && beforeValue !== afterValue;
    return {
      key,
      label: definition.label,
      owner: definition.owner,
      outcome: outcomeFor(afterStatus, beforeStatus, moved),
      detail: detailFor(definition, after, before, moved),
      before: beforeValue,
      after: afterValue,
      beforeValue: before ? METRICS[key].read(before) : undefined,
      afterValue: METRICS[key].read(after),
      beforeStatus,
      afterStatus,
    };
  });
}

function outcomeFor(afterStatus: CheckStatus, beforeStatus: CheckStatus | undefined, moved: boolean): FixOutcome {
  if (afterStatus === "fail" || afterStatus === "warn") {
    return "outstanding";
  }
  if (afterStatus === "unspecified") {
    return "unjudged";
  }
  if (beforeStatus === "fail" || beforeStatus === "warn") {
    return "fixed";
  }
  return moved ? "adjusted" : "held";
}

/**
 * Described from the numbers rather than from the pipeline, so a floor that rose
 * with the level lift is not reported as having been gated down.
 */
function detailFor(
  definition: CheckDefinition,
  after: AcxReport,
  before: AcxReport | undefined,
  moved: boolean,
): string {
  const key = definition.key;
  if (after.checks[key] === "fail" || after.checks[key] === "warn") {
    return definition.remedy;
  }
  if (!moved) {
    return "Already inside the target, and left alone.";
  }
  const rose = raised(key, after, before);
  switch (key) {
    case "sample_rate":
      return `Resampled to ${checkValue("sample_rate", after)}.`;
    case "channels":
      return `Mixed down to ${checkValue("channels", after).toLowerCase()}.`;
    case "noise_floor":
      return rose
        ? "Still under the limit after the level lift."
        : "Steady background noise was reduced automatically.";
    case "rms":
      return rose ? "Lifted into the target window." : "Brought down into the target window.";
    case "loudness":
      return "Followed the levelling.";
    case "true_peak":
      return rose ? "Peak after levelling, under the ceiling." : "Peaks limited under the ceiling.";
    case "head_room_tone":
      return rose
        ? "Head padded with room tone from the quietest part of the take."
        : "Head trimmed back into the target window.";
    case "tail_room_tone":
      return rose
        ? "Tail padded with room tone from the quietest part of the take."
        : "Tail trimmed back into the target window.";
    case "format":
      return `Encoded to ${deliveryFormat(after)}.`;
    case "duration":
      return rose ? "Longer by the room tone pads." : "Shorter after the master trimmed the ends.";
    default:
      return "Changed by mastering.";
  }
}

function raised(key: CheckKey, after: AcxReport, before: AcxReport | undefined): boolean {
  if (!before) {
    return false;
  }
  const to = METRICS[key].read(after);
  const from = METRICS[key].read(before);
  if (to === undefined || from === undefined) {
    return false;
  }
  return to > from;
}

function fileFixes(entry: ReportEntry, profile: DeliveryProfile): FileFixes {
  const changes = entry.after ? compareReports(entry.after, entry.before, profile) : [];
  const reduction = entry.processing?.automaticNoiseReductionDb;
  if (reduction) {
    const floor = changes.find((change) => change.key === "noise_floor");
    if (floor && floor.outcome !== "outstanding" && floor.outcome !== "unjudged") {
      floor.detail = `Reduced steady background noise automatically, using up to ${reduction.toFixed(0)} dB of cleanup.`;
    }
  }
  return {
    fileName: entry.fileName,
    status: entry.status,
    note: entry.note,
    measured: Boolean(entry.after),
    trafficLight: entry.after?.traffic_light,
    presetLabel: entry.after?.preset_label ?? entry.before?.preset_label,
    changes,
    fixedCount: changes.filter((change) => change.outcome === "fixed").length,
    outstandingCount: changes.filter((change) => change.outcome === "outstanding").length,
  };
}

function restorationAggregate(entries: readonly ReportEntry[]): AggregateChange | undefined {
  const repaired = entries.filter((entry) => entry.processing?.automaticRestoration);
  if (repaired.length === 0) {
    return undefined;
  }
  const repairs = repaired.map((entry) => entry.processing!.automaticRestoration!);
  const changedSamples = repairs.reduce((sum, repair) => sum + repair.changedSamples, 0);
  const maximumLevelShift = Math.max(...repairs.map((repair) => repair.levelShiftDb));
  const comparableFiles = entries.filter((entry) => entry.before).length;
  return {
    key: "restoration",
    label: "Clicks & clipped peaks",
    owner: "master",
    outcome: "fixed",
    detail: `Reconstructed ${changedSamples.toLocaleString()} damaged ${changedSamples === 1 ? "sample" : "samples"} before noise reduction and mastering; narration level shifted by no more than ${maximumLevelShift.toFixed(3)} dB.`,
    after: "Repaired",
    fileCount: repaired.length,
    ofFiles: comparableFiles,
    fileNames: repaired.map((entry) => entry.fileName),
  };
}

const SEVERITY: Record<FixOutcome, number> = {
  outstanding: 4,
  fixed: 3,
  adjusted: 2,
  held: 1,
  unjudged: 0,
};

export function summarizeExportFixes(
  entries: readonly ReportEntry[],
  profile: DeliveryProfile = deliveryProfile(resolvePreset(
    entries.find((entry) => entry.after ?? entry.before)?.after?.preset_id
      ?? entries.find((entry) => entry.after ?? entry.before)?.before?.preset_id,
  )),
): ExportFixSummary {
  const files = entries.map((entry) => fileFixes(entry, profile));
  const measured = files.filter((file) => file.measured);
  const grouped = new Map<CheckKey, Array<{ file: FileFixes; change: CheckChange }>>();
  for (const file of measured) {
    for (const change of file.changes) {
      const bucket = grouped.get(change.key) ?? [];
      bucket.push({ file, change });
      grouped.set(change.key, bucket);
    }
  }

  const fixed: AggregateChange[] = [];
  const adjusted: AggregateChange[] = [];
  const outstanding: AggregateChange[] = [];
  const held: string[] = [];
  const unjudged: string[] = [];

  for (const baseDefinition of CHECK_DEFINITIONS) {
    const definition = checkDefinition(baseDefinition.key, profile);
    const rows = grouped.get(definition.key) ?? [];
    if (rows.length === 0) {
      continue;
    }
    const worst = rows.reduce(
      (carry, row) => (SEVERITY[row.change.outcome] > SEVERITY[carry] ? row.change.outcome : carry),
      "unjudged" as FixOutcome,
    );
    if (worst === "held") {
      held.push(definition.label);
      continue;
    }
    if (worst === "unjudged") {
      unjudged.push(definition.label);
      continue;
    }
    const speaking = rows.filter((row) => row.change.outcome === worst);
    const comparable = worst === "outstanding"
      ? rows.length
      : rows.filter((row) => row.change.before !== undefined).length;
    const aggregate: AggregateChange = {
      key: definition.key,
      label: definition.label,
      owner: definition.owner,
      outcome: worst,
      detail: speaking[0].change.detail,
      remedy: worst === "outstanding" ? definition.remedy : undefined,
      before: collapse(definition.key, speaking.map((row) => ({ display: row.change.before, value: row.change.beforeValue }))),
      after: collapse(definition.key, speaking.map((row) => ({ display: row.change.after, value: row.change.afterValue })))
        ?? speaking[0].change.after,
      fileCount: speaking.length,
      ofFiles: comparable,
      fileNames: speaking.map((row) => row.file.fileName),
    };
    if (worst === "outstanding") {
      outstanding.push(aggregate);
    } else if (worst === "fixed") {
      fixed.push(aggregate);
    } else {
      adjusted.push(aggregate);
    }
  }

  const measuredChanges = CHECK_DEFINITIONS
    .map((definition) =>
      fixed.find((row) => row.key === definition.key)
      ?? adjusted.find((row) => row.key === definition.key))
    .filter((row): row is AggregateChange => Boolean(row));
  const restoration = restorationAggregate(entries);
  const completed = restoration ? [restoration, ...measuredChanges] : measuredChanges;

  return {
    files,
    measuredFiles: measured.length,
    presetLabel: measured[0]?.presetLabel,
    fixed,
    adjusted,
    completed,
    outstanding,
    held,
    unjudged,
    notes: files
      .filter((file): file is FileFixes & { note: string } => Boolean(file.note))
      .map((file) => ({ fileName: file.fileName, note: file.note })),
    ready: outstanding.length === 0 && files.every((file) => file.status === "pass"),
  };
}

/** One reading when the files agree, a low-to-high range when they do not. */
function collapse(key: CheckKey, readings: Array<{ display?: string; value?: number }>): string | undefined {
  const present = readings.filter((reading) => reading.display !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  const distinct = [...new Set(present.map((reading) => reading.display as string))];
  if (distinct.length === 1) {
    return distinct[0];
  }
  const metric = METRICS[key];
  const numbers = present.map((reading) => reading.value);
  if (metric.rangeable && metric.number && numbers.every((value) => typeof value === "number" && Number.isFinite(value))) {
    const finite = numbers as number[];
    const low = metric.number(Math.min(...finite));
    const high = metric.number(Math.max(...finite));
    return metric.unit ? `${low} to ${high} ${metric.unit}` : `${low} to ${high}`;
  }
  return distinct.length === 2 ? distinct.join(" and ") : `${distinct.length} readings`;
}
