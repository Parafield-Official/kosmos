import type { Pickup } from "../project/types";
import type { TranscriptWord } from "./align";

export interface ProofReportInput {
  chapterIndex: number;
  chapterTitle: string;
  audioPath?: string;
  audioDurationSeconds?: number;
  generatedAt?: string;
  transcript: TranscriptWord[];
  pickups: Pickup[];
}

export interface ProofReportFiles {
  report: string;
  csv: string;
}

/** Build a human-readable report and an editor-friendly pickup packet. */
export function buildProofReportFiles(input: ProofReportInput): ProofReportFiles {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const pickups = [...input.pickups].sort((left, right) => left.t_start - right.t_start);
  const open = pickups.filter((pickup) => pickup.status === "open");
  const resolved = pickups.filter((pickup) => pickup.status === "done");
  const ignored = pickups.filter((pickup) => pickup.status === "ignored");
  const words = pickups.filter((pickup) => pickup.kind !== "pause");
  const pauses = pickups.filter((pickup) => pickup.kind === "pause");
  const chapterLabel = `Chapter ${input.chapterIndex}: ${input.chapterTitle}`;
  const lines = [
    `# Proof report — ${chapterLabel}`,
    "",
    `Generated: ${generatedAt}`,
    `Audio: ${input.audioPath ?? "Not recorded"}`,
    `Duration: ${formatDuration(input.audioDurationSeconds)}`,
    `Transcript: ${input.transcript.length.toLocaleString("en-US")} timed words`,
    "",
    "## Summary",
    "",
    `- ${countLabel(open.length, "open pickup")}`,
    `- ${countLabel(resolved.length, "resolved pickup")}`,
    `- ${countLabel(ignored.length, "ignored pickup")}`,
    `- ${countLabel(words.length, "word change")}`,
    `- ${countLabel(pauses.length, "long pause")}`,
    "",
  ];
  if (pickups.length === 0) {
    lines.push("No word changes or long pauses were found.", "");
  } else {
    lines.push(
      "## Pickup packet",
      "",
      "| # | Time | Type | Status | Expected | Heard | Confidence | Note |",
      "|---:|---|---|---|---|---|---:|---|",
      ...pickups.map((pickup, index) => [
        `| ${index + 1}`,
        markdownCell(formatTimestamp(pickup.t_start)),
        markdownCell(pickup.kind),
        markdownCell(pickup.status),
        markdownCell(pickup.expected || "—"),
        markdownCell(pickup.heard || "—"),
        `${Math.round(Math.max(0, Math.min(1, pickup.confidence)) * 100)}%`,
        `${markdownCell(pickup.note || "—")} |`,
      ].join(" | ")),
      "",
    );
  }
  lines.push(
    "## Final listening checklist",
    "",
    "- Listen through every open pickup in context.",
    "- Check performance, pronunciation, clicks, room changes, and mouth noise.",
    "- Re-run proofing after applying replacement audio.",
    "",
  );

  const csvRows = [
    ["id", "chapter", "time_start", "time_end", "type", "status", "confidence", "expected", "heard", "note"],
    ...pickups.map((pickup) => [
      pickup.id,
      chapterLabel,
      pickup.t_start.toFixed(3),
      pickup.t_end.toFixed(3),
      pickup.kind,
      pickup.status,
      pickup.confidence.toFixed(3),
      pickup.expected,
      pickup.heard,
      pickup.note ?? "",
    ]),
  ];
  return {
    report: `${lines.join("\n").trimEnd()}\n`,
    csv: `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
  };
}

function formatDuration(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || (seconds ?? -1) < 0) {
    return "Unknown";
  }
  const total = Math.round(seconds as number);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/gu, " ").trim();
}

function csvCell(value: string): string {
  const clean = String(value).replace(/\r?\n/gu, " ");
  return /[",]/u.test(clean) ? `"${clean.replaceAll('"', '""')}"` : clean;
}
