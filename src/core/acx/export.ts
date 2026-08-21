import type { AcxReport } from "./measure";
import type { ChapterFile, ProjectFile } from "../project/types";

// Keep desktop export decisions tied to the same versioned specification used
// by the meter and master, rather than duplicating retail limits in Electron.
export { ACX_SPEC } from "./spec";

export interface ExportPlanOptions {
  includeOpeningCredits?: boolean;
  includeClosingCredits?: boolean;
  retailSampleChapterId?: string;
}

export interface ExportPlanItem {
  kind: "opening_credits" | "chapter" | "closing_credits" | "retail_sample";
  fileName: string;
  chapterId?: string;
  sourcePath?: string;
  note?: string;
}

export interface ExportPlan {
  folderName: "acx";
  items: ExportPlanItem[];
  readmeFiles: Array<{ fileName: string; contents: string }>;
}

export interface ExportReadiness {
  totalChapters: number;
  attachedChapters: number;
  missingAudio: ChapterFile[];
  ready: boolean;
}

/**
 * ACX output is a delivery pack, not a progress snapshot. Every manuscript
 * chapter must have an attached take before the export can be called ready.
 * Mastering failures are discovered while processing the takes and are
 * handled by the desktop export transaction.
 */
export function getExportReadiness(project: Pick<ProjectFile, "chapters">): ExportReadiness {
  const chapters = [...project.chapters].sort((a, b) => a.index - b.index);
  const missingAudio = chapters.filter((chapter) => !chapter.audio_path);
  return {
    totalChapters: chapters.length,
    attachedChapters: chapters.length - missingAudio.length,
    missingAudio,
    ready: chapters.length > 0 && missingAudio.length === 0,
  };
}

export interface ReportEntry {
  fileName: string;
  before?: AcxReport;
  after?: AcxReport;
  status: "pass" | "warn" | "fail" | "not_measured";
  note?: string;
}

export function buildExportPlan(
  project: ProjectFile,
  options: ExportPlanOptions = {},
): ExportPlan {
  const items: ExportPlanItem[] = [];
  const readmeFiles: ExportPlan["readmeFiles"] = [];

  if (options.includeOpeningCredits) {
    items.push({
      kind: "opening_credits",
      fileName: "00_opening_credits.mp3",
      note: "Provide a recorded opening-credit slot; Kosmos never generates spoken credits.",
    });
  } else {
    readmeFiles.push({
      fileName: "00_opening_credits_README.txt",
      contents: creditTemplate("opening"),
    });
  }

  for (const chapter of [...project.chapters].sort((a, b) => a.index - b.index)) {
    items.push({
      kind: "chapter",
      fileName: chapterFileName(chapter),
      chapterId: chapter.id,
      sourcePath: chapter.audio_path,
    });
  }

  if (options.includeClosingCredits) {
    items.push({
      kind: "closing_credits",
      fileName: "98_closing_credits.mp3",
      note: "Provide a recorded closing-credit slot; Kosmos never generates spoken credits.",
    });
  } else {
    readmeFiles.push({
      fileName: "98_closing_credits_README.txt",
      contents: creditTemplate("closing"),
    });
  }

  const sampleChapter = options.retailSampleChapterId
    ? project.chapters.find((chapter) => chapter.id === options.retailSampleChapterId)
    : project.chapters[0];
  items.push({
    kind: "retail_sample",
    fileName: "99_retail_sample.mp3",
    chapterId: sampleChapter?.id,
    sourcePath: sampleChapter?.audio_path,
    note: sampleChapter ? "Select a 1–5 minute range beginning on narration." : "Add a chapter before creating a retail sample.",
  });

  return { folderName: "acx", items, readmeFiles };
}

export function chapterFileName(chapter: Pick<ChapterFile, "index">): string {
  return `${String(chapter.index).padStart(2, "0")}_chapter_${String(chapter.index).padStart(2, "0")}.mp3`;
}

export function reportText(entries: ReportEntry[]): string {
  const target = entries.find((entry) => entry.after ?? entry.before);
  const measured = target?.after ?? target?.before;
  const lines = [
    "Kosmos audio spec report",
    "============================",
    "Measurable specs only. Human QC still matters for clicks, echo, and a wrong read.",
    ...(measured
      ? [
        `Delivery target: ${measured.preset_label}`,
        `Target source:   ${measured.preset_source}`,
        "Loudness is integrated LUFS per ITU-R BS.1770. A dimension the target does",
        "not specify is reported but not judged.",
      ]
      : []),
    "",
  ];

  for (const entry of entries) {
    lines.push(`${entry.fileName} — ${entry.status.toUpperCase()}`);
    if (entry.note) {
      lines.push(`  note: ${entry.note}`);
    }
    if (entry.before) {
      lines.push(`  before: ${summary(entry.before)}`);
    }
    if (entry.after) {
      lines.push(`  after:  ${summary(entry.after)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function summary(report: AcxReport): string {
  return [
    `RMS ${format(report.rms_dbfs)} dBFS`,
    `loudness ${format(report.lufs_integrated)} LUFS`,
    `TP ${format(report.true_peak_dbfs)} dBTP`,
    `floor ${format(report.noise_floor_dbfs)} dBFS RMS`,
    `floor window ${formatSeconds(report.noise_floor_start_seconds)}–${formatSeconds(report.noise_floor_start_seconds + report.noise_floor_duration_seconds)} s`,
    `${report.sample_rate} Hz`,
    `${report.channels} ch`,
    `${report.duration_seconds.toFixed(2)} s`,
    `traffic ${report.traffic_light}`,
  ].join(", ");
}

function formatSeconds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "?";
}

function creditTemplate(kind: "opening" | "closing"): string {
  const label = kind === "opening" ? "Opening" : "Closing";
  return `${label} credits slot\n\nRecord this line in a human voice, then replace the README slot with the exported MP3:\n\n{Title}, written by {Author}, narrated by {Narrator}.\n\nKosmos does not generate spoken credits with TTS.\n`;
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "-inf";
}
