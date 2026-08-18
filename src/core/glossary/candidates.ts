import type { GlossaryEntry, Seat } from "../project/types";
import { COMMON_ENGLISH_WORDS } from "./common-english";

export interface GlossaryCandidate {
  spelling: string;
  frequency: number;
  reasons: Array<"capitalized" | "repeated-capitalized" | "uncommon" | "name-pattern" | "unusual-spelling">;
}

export interface CandidateOptions {
  limit?: number;
  commonWords?: ReadonlySet<string>;
}

export interface AddGlossaryOptions {
  id?: string;
  respell?: string;
  clipPath?: string;
  seats?: Seat[];
}

interface Token {
  raw: string;
  canonical: string;
  start: number;
  end: number;
  capitalized: boolean;
  sentenceStart: boolean;
}

const TOKEN_PATTERN = /[\p{L}][\p{L}\p{M}\d]*(?:['’.-][\p{L}\p{M}\d]+)*/gu;
const REASON_ORDER: GlossaryCandidate["reasons"][number][] = [
  "capitalized",
  "repeated-capitalized",
  "name-pattern",
  "uncommon",
  "unusual-spelling",
];

/** Extract a bounded, explainable candidate list without leaving the machine. */
export function extractGlossaryCandidates(
  manuscript: string,
  options: CandidateOptions = {},
): GlossaryCandidate[] {
  const commonWords = options.commonWords ?? COMMON_ENGLISH_WORDS;
  const tokens = tokenize(manuscript);
  const aggregates = new Map<
    string,
    {
      frequency: number;
      capitalizedFrequency: number;
      variants: Map<string, number>;
      reasons: Set<GlossaryCandidate["reasons"][number]>;
    }
  >();

  tokens.forEach((token, index) => {
    const common = commonWords.has(token.canonical);
    const next = tokens[index + 1]?.canonical;
    const previous = tokens[index - 1]?.canonical;
    const namePattern = previous === "said" || next === "said";
    const unusual = hasUnusualSpelling(token.canonical);
    const reasons = new Set<GlossaryCandidate["reasons"][number]>();

    if (token.capitalized && !token.sentenceStart && !common) {
      reasons.add("capitalized");
    }
    if (token.capitalized && !common) {
      // Repeated-capitalized is assigned after aggregation, but retaining the
      // count here means a word can remain a candidate even at sentence starts.
      reasons.add("repeated-capitalized");
    }
    if (!common) {
      reasons.add("uncommon");
    }
    if (namePattern) {
      reasons.add("name-pattern");
    }
    if (unusual) {
      reasons.add("unusual-spelling");
    }

    if (reasons.size === 0) {
      return;
    }

    const current = aggregates.get(token.canonical) ?? {
      frequency: 0,
      capitalizedFrequency: 0,
      variants: new Map<string, number>(),
      reasons: new Set<GlossaryCandidate["reasons"][number]>(),
    };
    current.frequency += 1;
    if (token.capitalized) {
      current.capitalizedFrequency += 1;
    }
    current.variants.set(token.raw, (current.variants.get(token.raw) ?? 0) + 1);
    reasons.forEach((reason) => current.reasons.add(reason));
    aggregates.set(token.canonical, current);
  });

  const candidates = Array.from(aggregates.entries()).map(([canonical, aggregate]) => {
    if (aggregate.capitalizedFrequency < 3) {
      aggregate.reasons.delete("repeated-capitalized");
    } else {
      aggregate.reasons.add("repeated-capitalized");
    }
    return {
      spelling: representativeSpelling(aggregate.variants, canonical),
      frequency: aggregate.frequency,
      reasons: REASON_ORDER.filter((reason) => aggregate.reasons.has(reason)),
    } satisfies GlossaryCandidate;
  });

  candidates.sort((left, right) => {
    if (right.frequency !== left.frequency) {
      return right.frequency - left.frequency;
    }
    return left.spelling.localeCompare(right.spelling, "en", { sensitivity: "base" });
  });

  return candidates.slice(0, Math.max(0, options.limit ?? 80));
}

/** Convert the explainable draft list to the persisted project shape. */
export function candidatesToGlossary(candidates: GlossaryCandidate[]): GlossaryEntry[] {
  return candidates.map((candidate) => ({
    id: `auto-${slug(candidate.spelling)}`,
    spelling: candidate.spelling,
    frequency: candidate.frequency,
    source: "auto",
  }));
}

export function addGlossaryEntry(
  glossary: GlossaryEntry[],
  spelling: string,
  options: AddGlossaryOptions = {},
): GlossaryEntry[] {
  const clean = spelling.trim();
  if (clean.length === 0) {
    throw new Error("Glossary spelling cannot be empty");
  }
  const id = options.id ?? `user-${slug(clean)}-${glossary.length + 1}`;
  if (glossary.some((entry) => entry.id === id)) {
    throw new Error(`Glossary entry id already exists: ${id}`);
  }
  return [
    ...glossary,
    {
      id,
      spelling: clean,
      respell: options.respell?.trim() || undefined,
      clip_path: options.clipPath,
      seats: options.seats,
      frequency: 0,
      source: "user",
    },
  ];
}

export function deleteGlossaryEntry(glossary: GlossaryEntry[], id: string): GlossaryEntry[] {
  return glossary.filter((entry) => entry.id !== id);
}

export function renameGlossaryEntry(
  glossary: GlossaryEntry[],
  id: string,
  spelling: string,
  respell?: string,
): GlossaryEntry[] {
  const clean = spelling.trim();
  if (clean.length === 0) {
    throw new Error("Glossary spelling cannot be empty");
  }
  let found = false;
  const next = glossary.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    found = true;
    return { ...entry, spelling: clean, respell: respell?.trim() || undefined };
  });
  if (!found) {
    throw new Error(`Unknown glossary entry: ${id}`);
  }
  return next;
}

export function mergeGlossaryEntries(
  glossary: GlossaryEntry[],
  targetId: string,
  sourceId: string,
  spelling?: string,
): GlossaryEntry[] {
  if (targetId === sourceId) {
    throw new Error("Cannot merge a glossary entry with itself");
  }
  const target = glossary.find((entry) => entry.id === targetId);
  const source = glossary.find((entry) => entry.id === sourceId);
  if (!target || !source) {
    throw new Error("Both glossary entries must exist before merging");
  }
  const seats = Array.from(new Set([...(target.seats ?? []), ...(source.seats ?? [])]));
  return glossary
    .filter((entry) => entry.id !== sourceId)
    .map((entry) =>
      entry.id === targetId
        ? {
            ...entry,
            spelling: spelling?.trim() || entry.spelling,
            respell: entry.respell || source.respell,
            clip_path: entry.clip_path || source.clip_path,
            seats: seats.length > 0 ? seats : undefined,
            frequency: entry.frequency + source.frequency,
            source: entry.source === "user" || source.source === "user" ? "user" : "auto",
          }
        : entry,
    );
}

/** Link glossary spellings to script spans while preserving every character/style. */
export function linkGlossarySpans(
  spans: import("../project/types").ScriptSpan[],
  glossary: GlossaryEntry[],
): import("../project/types").ScriptSpan[] {
  // Prefer an explicitly edited/user row when an auto candidate has the same
  // spelling. Longer phrases still win over their shorter component words.
  const entries = Array.from(
    glossary
      .filter((entry) => entry.spelling.trim().length > 0)
      .reduce((bySpelling, entry) => {
        const key = entry.spelling.trim().toLocaleLowerCase("en-US");
        const previous = bySpelling.get(key);
        if (!previous || (entry.source === "user" && previous.source !== "user")) {
          bySpelling.set(key, entry);
        }
        return bySpelling;
      }, new Map<string, GlossaryEntry>())
      .values(),
  ).sort((left, right) => right.spelling.trim().length - left.spelling.trim().length);
  if (entries.length === 0) {
    return spans.map((span) => ({ ...span, style: [...span.style] }));
  }
  return spans.flatMap((span) => linkSpan({ ...span, glossary_id: undefined }, entries));
}

function linkSpan(
  span: import("../project/types").ScriptSpan,
  entries: GlossaryEntry[],
): import("../project/types").ScriptSpan[] {
  const matches: Array<{ start: number; end: number; entry: GlossaryEntry }> = [];
  for (const entry of entries) {
    const spelling = entry.spelling.trim();
    const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "giu");
    for (const match of span.text.matchAll(expression)) {
      const prefixLength = match[1]?.length ?? 0;
      const start = (match.index ?? 0) + prefixLength;
      matches.push({ start, end: start + (match[2]?.length ?? 0), entry });
    }
  }
  matches.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const selected: typeof matches = [];
  for (const match of matches) {
    if (selected.some((candidate) => match.start < candidate.end && match.end > candidate.start)) {
      continue;
    }
    selected.push(match);
  }
  if (selected.length === 0) {
    return [{ ...span, style: [...span.style] }];
  }
  const output: import("../project/types").ScriptSpan[] = [];
  let cursor = 0;
  for (const match of selected) {
    if (match.start > cursor) {
      output.push({ ...span, text: span.text.slice(cursor, match.start), style: [...span.style], glossary_id: undefined });
    }
    output.push({ ...span, text: span.text.slice(match.start, match.end), style: [...span.style], glossary_id: match.entry.id });
    cursor = match.end;
  }
  if (cursor < span.text.length) {
    output.push({ ...span, text: span.text.slice(cursor), style: [...span.style], glossary_id: undefined });
  }
  return output;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const canonical = normalizeToken(raw);
    if (canonical.length < 2 || /^\d+$/.test(canonical)) {
      continue;
    }
    tokens.push({
      raw,
      canonical,
      start,
      end: start + raw.length,
      capitalized: /^\p{Lu}/u.test(raw),
      sentenceStart: isSentenceStart(text, start),
    });
  }
  return tokens;
}

function normalizeToken(raw: string): string {
  return raw
    .replace(/[’']s$/iu, "")
    .replace(/[‐‑‒–—]/g, "-")
    .toLocaleLowerCase("en-US");
}

function isSentenceStart(text: string, start: number): boolean {
  const before = text.slice(0, start);
  const withoutWhitespace = before.replace(/\s+$/u, "");
  if (withoutWhitespace.length === 0) {
    return true;
  }
  const last = withoutWhitespace.at(-1) ?? "";
  return /[.!?。！？]/u.test(last);
}

function representativeSpelling(variants: Map<string, number>, canonical: string): string {
  return Array.from(variants.entries())
    .sort(([leftSpelling, leftCount], [rightSpelling, rightCount]) => {
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }
      const leftTitle = /^\p{Lu}/u.test(leftSpelling) ? 1 : 0;
      const rightTitle = /^\p{Lu}/u.test(rightSpelling) ? 1 : 0;
      if (rightTitle !== leftTitle) {
        return rightTitle - leftTitle;
      }
      return leftSpelling.localeCompare(rightSpelling, "en", { sensitivity: "base" });
    })
    .at(0)?.[0] ?? canonical;
}

function hasUnusualSpelling(word: string): boolean {
  return /(?:cest|chester|cestershire|ough|eaux|sch|tz|cz|[aeiou][^aeiou]{3,})/iu.test(word);
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "entry";
}
