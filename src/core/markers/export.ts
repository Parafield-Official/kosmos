import type { Pickup } from "../project/types";

export interface MarkerFile {
  fileName: string;
  contents: string;
}

export interface MarkerOptions {
  includeIgnored?: boolean;
  maxLabelLength?: number;
}

/** A subtitle cue with no duration never paints, so give every cue a floor. */
const MIN_SUBTITLE_SECONDS = 0.5;

/** Audacity label track: start, end, and label separated by tabs. */
export function audacityLabels(pickups: Pickup[], options: MarkerOptions = {}): string {
  return eligiblePickups(pickups, options)
    .map((pickup) => `${formatSeconds(pickup.t_start)}\t${formatSeconds(pickup.t_end)}\t${markerLabel(pickup, options)}\n`)
    .join("");
}

/**
 * Reaper's Region/Marker Manager imports comma-separated rows under a
 * `#,Name,Start,End,Length,Color` header, where the index column carries an
 * `R` prefix for regions. Regions rather than markers, because double-clicking
 * one selects exactly the words to punch.
 */
export function reaperRegionCsv(pickups: Pickup[], options: MarkerOptions = {}): string {
  const rows = eligiblePickups(pickups, options).map((pickup, index) =>
    csvRow([
      `R${index + 1}`,
      markerLabel(pickup, options),
      formatSeconds(pickup.t_start),
      formatSeconds(pickup.t_end),
      formatSeconds(Math.max(0, pickup.t_end - pickup.t_start)),
      "",
    ]),
  );
  return ["#,Name,Start,End,Length,Color", ...rows, ""].join("\n");
}

/**
 * Adobe Audition writes and reads its marker list as a tab-delimited table
 * under a fixed six-column header, with decimal times. A non-zero duration
 * makes the entry a range marker rather than a point cue.
 */
export function auditionMarkerCsv(pickups: Pickup[], options: MarkerOptions = {}): string {
  const rows = eligiblePickups(pickups, options).map((pickup) =>
    [
      markerLabel(pickup, options),
      formatAuditionDecimal(pickup.t_start),
      formatAuditionDecimal(Math.max(0, pickup.t_end - pickup.t_start)),
      "decimal",
      "Cue",
      pickup.note ? singleLine(pickup.note) : "",
    ].join("\t"),
  );
  return ["Name\tStart\tDuration\tTime Format\tType\tDescription", ...rows, ""].join("\n");
}

/** SubRip subtitles, for editors and proofers who want the read as timed text. */
export function subtitleSrt(pickups: Pickup[], options: MarkerOptions = {}): string {
  return eligiblePickups(pickups, options)
    .map((pickup, index) => {
      const end = Math.max(pickup.t_end, pickup.t_start + MIN_SUBTITLE_SECONDS);
      return [
        String(index + 1),
        `${formatSrtTime(pickup.t_start)} --> ${formatSrtTime(end)}`,
        markerLabel(pickup, options),
        "",
      ].join("\n");
    })
    .join("\n");
}

/**
 * A spreadsheet-friendly table of every pickup. This is also the file to feed
 * a Pro Tools marker converter, which accepts comma-separated text.
 */
export function pickupCsv(pickups: Pickup[], options: MarkerOptions = {}): string {
  const rows = eligiblePickups(pickups, options).map((pickup, index) =>
    csvRow([
      String(index + 1),
      formatSeconds(pickup.t_start),
      formatSeconds(pickup.t_end),
      formatTimecode(pickup.t_start),
      pickup.kind,
      pickup.seat,
      pickup.status,
      pickup.expected,
      pickup.heard,
      Number.isFinite(pickup.confidence) ? pickup.confidence.toFixed(2) : "",
      pickup.note ? singleLine(pickup.note) : "",
    ]),
  );
  return [
    "#,Start (s),End (s),Start (timecode),Kind,Seat,Status,Expected,Heard,Confidence,Note",
    ...rows,
    "",
  ].join("\n");
}

export function markerFileSet(
  baseName: string,
  pickups: Pickup[],
  options: MarkerOptions = {},
): MarkerFile[] {
  const safeBase = baseName.replace(/[^a-z0-9_-]+/giu, "_");
  return [
    {
      fileName: `${safeBase}_audacity_labels.txt`,
      contents: audacityLabels(pickups, options),
    },
    {
      fileName: `${safeBase}_reaper_regions.csv`,
      contents: reaperRegionCsv(pickups, options),
    },
    {
      fileName: `${safeBase}_audition_markers.csv`,
      contents: auditionMarkerCsv(pickups, options),
    },
    {
      fileName: `${safeBase}_pickups.csv`,
      contents: pickupCsv(pickups, options),
    },
    {
      fileName: `${safeBase}_pickups.srt`,
      contents: subtitleSrt(pickups, options),
    },
    {
      fileName: `${safeBase}_MARKERS_README.txt`,
      contents: markerReadme(),
    },
  ];
}

function markerReadme(): string {
  return [
    "Kosmos marker export",
    "",
    "Which file your editor wants:",
    "",
    "  Audacity          *_audacity_labels.txt",
    "                    File > Import > Labels.",
    "",
    "  Reaper            *_reaper_regions.csv",
    "                    View > Region/Marker Manager, then right-click inside the",
    "                    window and choose Import regions/markers (or drag the file in).",
    "                    Set the ruler to seconds first; Reaper reads these times as",
    "                    whatever unit the timeline is currently showing.",
    "",
    "  Adobe Audition    *_audition_markers.csv",
    "                    File > Import > Markers from File. Audition writes this same",
    "                    tab-delimited layout when it exports, so it round-trips.",
    "",
    "  Anything else     *_pickups.csv",
    "                    A plain table of every pickup. Opens in Excel or Numbers, and",
    "                    it is the file to feed a marker converter for DAWs that cannot",
    "                    read text markers directly.",
    "",
    "  Subtitles         *_pickups.srt",
    "                    For proofers and video editors who want the list as timed text.",
    "",
    "Pro Tools cannot import text or CSV markers. It only takes markers from a Pro",
    "Tools session file or a MIDI file, so run *_pickups.csv through a marker",
    "converter and import the session file it produces.",
    "",
    "Markers cover word mismatches and long pauses only. Listen for acting, clicks,",
    "echo, and noise yourself.",
    "",
  ].join("\n");
}

function eligiblePickups(pickups: Pickup[], options: MarkerOptions): Pickup[] {
  return pickups
    .filter((pickup) => options.includeIgnored || pickup.status !== "ignored")
    .filter((pickup) => Number.isFinite(pickup.t_start) && Number.isFinite(pickup.t_end))
    .sort((left, right) => left.t_start - right.t_start || left.id.localeCompare(right.id));
}

function markerLabel(pickup: Pickup, options: MarkerOptions): string {
  const expected = pickup.expected || "—";
  const heard = pickup.heard || "—";
  const full = `${expected} → ${heard} [${pickup.kind}]`;
  const maxLength = options.maxLabelLength ?? 96;
  return full.length > maxLength ? `${full.slice(0, Math.max(1, maxLength - 1))}…` : full;
}

/** A pickup note is free text; marker rows are one line each. */
function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}

function csvField(value: string): string {
  const flat = value.replace(/\r?\n/gu, " ");
  return /[",]/u.test(flat) ? `"${flat.replace(/"/gu, '""')}"` : flat;
}

function formatSeconds(value: number): string {
  return Math.max(0, value).toFixed(3);
}

/** Audition decimal times: M:SS.sss, widening to H:MM:SS.sss past an hour. */
function formatAuditionDecimal(value: number): string {
  const total = Math.max(0, value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${padSeconds(seconds)}`;
  }
  return `${minutes}:${padSeconds(seconds)}`;
}

function formatTimecode(value: number): string {
  const total = Math.max(0, value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${pad2(hours)}:${pad2(minutes)}:${padSeconds(total % 60)}`;
}

function formatSrtTime(value: number): string {
  return formatTimecode(value).replace(".", ",");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function padSeconds(value: number): string {
  return value.toFixed(3).padStart(6, "0");
}
