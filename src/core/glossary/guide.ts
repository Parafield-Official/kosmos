import type { GlossaryEntry } from "../project/types";
import { suggestRespelling, type RespellLexicon } from "./respell";

export interface GuideChapter {
  index: number;
  title: string;
  /** The chapter script as plain text. */
  text: string;
}

export interface VoiceGuideInput {
  projectName?: string;
  narrator?: string;
  generatedAt?: string;
  glossary: GlossaryEntry[];
  chapters: GuideChapter[];
}

export interface GuideRow {
  entry: GlossaryEntry;
  /** Times the name appears across every chapter given. */
  count: number;
  /** Chapter numbers it appears in, in order. */
  chapters: number[];
}

export interface MarkUpOptions {
  /**
   * "paragraph" marks the first appearance in each paragraph, which is enough
   * to remind a narrator without burying the prose. "all" marks every one.
   */
  frequency?: "paragraph" | "all";
  /** Wrapper around the respelling. Defaults to square brackets. */
  open?: string;
  close?: string;
}

export interface RespellFill {
  glossary: GlossaryEntry[];
  /** Rows the dictionary could answer. */
  filled: number;
  /** Names no dictionary knows; these still need a person. */
  unknown: string[];
}

export interface GuideFile {
  fileName: string;
  contents: string;
}

/**
 * Answer the pronunciations a dictionary already knows, so a person only writes
 * the ones it does not. Rows someone has already filled in are left alone —
 * a human decision outranks a lookup.
 */
export function fillGlossaryRespells(
  glossary: GlossaryEntry[],
  lexicon: RespellLexicon,
): RespellFill {
  const unknown: string[] = [];
  let filled = 0;
  const next = glossary.map((entry) => {
    if (entry.respell?.trim()) {
      return entry;
    }
    const suggestion = suggestRespelling(entry.spelling, lexicon);
    if (!suggestion) {
      unknown.push(entry.spelling);
      return entry;
    }
    filled += 1;
    return { ...entry, respell: suggestion };
  });
  return { glossary: filled > 0 ? next : glossary, filled, unknown };
}

/**
 * Everything the export writes: the guide, and one marked-up script per chapter.
 * Naming is decided here so it is the same wherever the files are written.
 */
export function planVoiceGuideFiles(
  input: VoiceGuideInput,
  options: MarkUpOptions = {},
): GuideFile[] {
  const files: GuideFile[] = [
    { fileName: "voice-guide.md", contents: buildVoiceGuideMarkdown(input) },
  ];
  for (const chapter of input.chapters) {
    files.push({
      fileName: `${String(chapter.index).padStart(2, "0")}_${slug(chapter.title)}_marked.txt`,
      contents: `${markUpScript(chapter.text, input.glossary, options).trimEnd()}\n`,
    });
  }
  return files;
}

/**
 * Count where each glossary name actually appears, so the guide can lead with
 * the names that carry the book and the narrator can see what is still undecided.
 */
export function collectGuideRows(input: VoiceGuideInput): GuideRow[] {
  const rows = dedupe(input.glossary).map((entry) => {
    const chapters: number[] = [];
    let count = 0;
    for (const chapter of input.chapters) {
      const found = countOccurrences(chapter.text, entry.spelling);
      if (found > 0) {
        chapters.push(chapter.index);
        count += found;
      }
    }
    return { entry, count, chapters };
  });
  rows.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.entry.spelling.localeCompare(right.entry.spelling, "en", { sensitivity: "base" });
  });
  return rows;
}

/**
 * The page a narrator reads before recording: every name, how to say it, how it
 * should sound, and where it turns up.
 */
export function buildVoiceGuideMarkdown(input: VoiceGuideInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rows = collectGuideRows(input);
  const decided = rows.filter((row) => Boolean(row.entry.respell?.trim()));
  const undecided = rows.filter((row) => !row.entry.respell?.trim());

  const lines = [
    `# Voice guide — ${input.projectName ?? "Audiobook"}`,
    "",
    `Generated: ${generatedAt}`,
  ];
  if (input.narrator) {
    lines.push(`Narrator: ${input.narrator}`);
  }
  lines.push(
    `Names: ${rows.length.toLocaleString("en-US")} (${decided.length.toLocaleString("en-US")} with a pronunciation)`,
    `Chapters covered: ${input.chapters.length.toLocaleString("en-US")}`,
    "",
  );

  if (rows.length === 0) {
    lines.push("The glossary is empty. Run name detection on a chapter to start one.", "");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  if (decided.length > 0) {
    lines.push(
      "## Pronunciations",
      "",
      "| Name | Say it | Voice | Times | Chapters |",
      "|---|---|---|---:|---|",
      ...decided.map((row) => [
        `| ${cell(row.entry.spelling)}`,
        cell(row.entry.respell ?? ""),
        cell(row.entry.voice_note ?? "—"),
        String(row.count),
        `${cell(chapterList(row.chapters))} |`,
      ].join(" | ")),
      "",
    );
  }

  if (undecided.length > 0) {
    lines.push(
      "## Still to decide",
      "",
      "These are in the glossary with no pronunciation yet. Settle them before the read,",
      "or the same name will be said two ways.",
      "",
      "| Name | Voice | Times | Chapters |",
      "|---|---|---:|---|",
      ...undecided.map((row) => [
        `| ${cell(row.entry.spelling)}`,
        cell(row.entry.voice_note ?? "—"),
        String(row.count),
        `${cell(chapterList(row.chapters))} |`,
      ].join(" | ")),
      "",
    );
  }

  const unused = rows.filter((row) => row.count === 0);
  if (unused.length > 0 && input.chapters.length > 0) {
    lines.push(
      `Not found in the chapters given: ${unused.map((row) => row.entry.spelling).join(", ")}.`,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * The script with pronunciations dropped in beside the names, so the narrator
 * reads from one page instead of glancing at a guide mid-sentence. Nothing else
 * about the text changes.
 */
export function markUpScript(
  text: string,
  glossary: GlossaryEntry[],
  options: MarkUpOptions = {},
): string {
  const open = options.open ?? "[";
  const close = options.close ?? "]";
  const entries = dedupe(glossary)
    .filter((entry) => Boolean(entry.respell?.trim()) && entry.spelling.trim().length > 0)
    .sort((left, right) => right.spelling.trim().length - left.spelling.trim().length);
  if (entries.length === 0) {
    return text;
  }
  const perParagraph = (options.frequency ?? "paragraph") === "paragraph";

  // Paragraph breaks are kept exactly as they came in; only the words between
  // them are touched.
  return text.split(/(\n\s*\n)/u).map((block) => {
    if (/^\n\s*\n$/u.test(block) || block.trim().length === 0) {
      return block;
    }
    const marks: Array<{ start: number; end: number; respell: string }> = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      for (const match of matchesIn(block, entry.spelling)) {
        marks.push({ ...match, respell: entry.respell!.trim() });
      }
    }
    marks.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));

    const chosen: typeof marks = [];
    for (const mark of marks) {
      if (chosen.some((other) => mark.start < other.end && mark.end > other.start)) {
        continue;
      }
      const key = mark.respell.toLocaleLowerCase("en-US");
      if (perParagraph && seen.has(key)) {
        continue;
      }
      seen.add(key);
      chosen.push(mark);
    }
    if (chosen.length === 0) {
      return block;
    }

    let out = "";
    let cursor = 0;
    for (const mark of chosen) {
      out += block.slice(cursor, mark.end);
      out += ` ${open}${mark.respell}${close}`;
      cursor = mark.end;
    }
    return out + block.slice(cursor);
  }).join("");
}

function matchesIn(text: string, spelling: string): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(wordPattern(spelling))) {
    const prefix = match[1]?.length ?? 0;
    const start = (match.index ?? 0) + prefix;
    found.push({ start, end: start + (match[2]?.length ?? 0) });
  }
  return found;
}

function countOccurrences(text: string, spelling: string): number {
  if (spelling.trim().length === 0) {
    return 0;
  }
  return matchesIn(text, spelling).length;
}

/**
 * Whole words only, case-insensitive, and a possessive still counts as the name:
 * "Siobhan's" is Siobhan.
 */
function wordPattern(spelling: string): RegExp {
  const escaped = spelling.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|['\u2019]s\\b|[^\\p{L}\\p{N}])`,
    "giu",
  );
}

/** One row per spelling, preferring the row a person edited. */
function dedupe(glossary: GlossaryEntry[]): GlossaryEntry[] {
  const bySpelling = new Map<string, GlossaryEntry>();
  for (const entry of glossary) {
    const key = entry.spelling.trim().toLocaleLowerCase("en-US");
    if (key.length === 0) {
      continue;
    }
    const previous = bySpelling.get(key);
    if (!previous || prefers(entry, previous)) {
      bySpelling.set(key, entry);
    }
  }
  return Array.from(bySpelling.values());
}

function prefers(candidate: GlossaryEntry, current: GlossaryEntry): boolean {
  const candidateSaid = Boolean(candidate.respell?.trim());
  const currentSaid = Boolean(current.respell?.trim());
  if (candidateSaid !== currentSaid) {
    return candidateSaid;
  }
  if (candidate.source !== current.source) {
    return candidate.source === "user";
  }
  return false;
}

function chapterList(chapters: number[]): string {
  if (chapters.length === 0) {
    return "—";
  }
  const runs: string[] = [];
  let start = chapters[0];
  let previous = chapters[0];
  for (const chapter of chapters.slice(1)) {
    if (chapter === previous + 1) {
      previous = chapter;
      continue;
    }
    runs.push(start === previous ? String(start) : `${start}–${previous}`);
    start = chapter;
    previous = chapter;
  }
  runs.push(start === previous ? String(start) : `${start}–${previous}`);
  return runs.join(", ");
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/gu, " ").trim();
}

/** Chapter titles become file names, so keep them plain and bounded. */
function slug(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "chapter";
}
