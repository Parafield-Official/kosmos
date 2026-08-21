import type { GlossaryEntry, Seat } from "../project/types";
import { COMMON_ENGLISH_WORDS } from "./common-english";

export interface GlossaryCandidate {
  spelling: string;
  frequency: number;
  reasons: CandidateReason[];
}

export type CandidateReason =
  | "capitalized"
  | "repeated-capitalized"
  | "uncommon"
  | "name-pattern"
  | "unusual-spelling"
  | "ambiguous-pronunciation"
  | "unexpected-pronunciation";

export interface PronunciationLexicon {
  has(word: string): boolean;
  pronunciationCount(word: string): number;
  /** The first pronunciation listed for a word, in ARPAbet phones. */
  pronunciation(word: string): string | undefined;
}

export interface CandidateOptions {
  limit?: number;
  commonWords?: ReadonlySet<string>;
  lexicon?: PronunciationLexicon;
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

const NAME_CONTEXT_WORDS = new Set([
  "asked", "called", "cried", "named", "replied", "said", "shouted", "whispered", "yelled",
]);
const TITLE_OR_ROLE_WORDS = new Set([
  "aunt", "author", "brother", "chapter", "dear", "duchess", "duke", "everyone", "father",
  "gentle", "lady", "lord", "mother", "mr", "mrs", "miss", "reader", "read", "sister", "society",
]);
const HETERONYM_WORDS = new Set([
  "address", "advocate", "attribute", "bass", "bow", "close", "content", "conduct", "contract",
  "convert", "desert", "does", "dove", "entrance", "export", "import", "increase", "insult", "lead",
  "live", "minute", "object", "polish", "present", "produce", "project", "protest", "read", "record",
  "refuse", "reject", "resume", "row", "sewer", "sow", "subject", "suspect", "tear", "use", "wind", "wound",
]);

const TOKEN_PATTERN = /[\p{L}][\p{L}\p{M}\d]*(?:['’.-][\p{L}\p{M}\d]+)*/gu;
const REASON_ORDER: GlossaryCandidate["reasons"][number][] = [
  "capitalized",
  "repeated-capitalized",
  "name-pattern",
  "uncommon",
  "unusual-spelling",
  "ambiguous-pronunciation",
  "unexpected-pronunciation",
];

/** Extract a bounded, explainable candidate list without leaving the machine. */
export function extractGlossaryCandidates(
  manuscript: string,
  options: CandidateOptions = {},
): GlossaryCandidate[] {
  const commonWords = options.commonWords ?? COMMON_ENGLISH_WORDS;
  const lexicon = options.lexicon;
  const tokens = tokenize(manuscript);
  const aggregates = new Map<
    string,
    {
      frequency: number;
      capitalizedFrequency: number;
      capitalizedMidSentenceFrequency: number;
      namePatternFrequency: number;
      unusualFrequency: number;
      nonAsciiFrequency: number;
      acronymFrequency: number;
      known: boolean;
      variants: Map<string, number>;
    }
  >();

  tokens.forEach((token, index) => {
    const known = lexicon ? lexicon.has(token.canonical) : commonWords.has(token.canonical);
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    const namePattern = !token.canonical.includes("'") && token.capitalized && (
      Boolean(previous && NAME_CONTEXT_WORDS.has(previous.canonical) && isAdjacentNameContext(manuscript, previous, token))
      || Boolean(next && NAME_CONTEXT_WORDS.has(next.canonical) && isAdjacentNameContext(manuscript, token, next))
    );
    const unusual = hasUnusualSpelling(token.canonical)
      && !(token.canonical.includes("-") && token.canonical.split("-").every((part) => isKnownWord(part, commonWords, lexicon)));

    const current = aggregates.get(token.canonical) ?? {
      frequency: 0,
      capitalizedFrequency: 0,
      capitalizedMidSentenceFrequency: 0,
      namePatternFrequency: 0,
      unusualFrequency: 0,
      nonAsciiFrequency: 0,
      acronymFrequency: 0,
      known,
      variants: new Map<string, number>(),
    };
    current.frequency += 1;
    current.known = current.known || known;
    if (token.capitalized) {
      current.capitalizedFrequency += 1;
      if (!token.sentenceStart) {
        current.capitalizedMidSentenceFrequency += 1;
      }
    }
    if (namePattern) {
      current.namePatternFrequency += 1;
    }
    if (unusual) {
      current.unusualFrequency += 1;
    }
    if ([...token.raw].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
      current.nonAsciiFrequency += 1;
    }
    if (token.raw.length > 1 && token.raw === token.raw.toLocaleUpperCase("en-US") && token.raw !== token.raw.toLocaleLowerCase("en-US")) {
      current.acronymFrequency += 1;
    }
    current.variants.set(token.raw, (current.variants.get(token.raw) ?? 0) + 1);
    aggregates.set(token.canonical, current);
  });

  const candidates = Array.from(aggregates.entries()).map(([canonical, aggregate]) => {
    const titleOrRole = TITLE_OR_ROLE_WORDS.has(canonical);
    const nameSignal = !titleOrRole && (
      aggregate.namePatternFrequency > 0
      || (!aggregate.known && aggregate.capitalizedMidSentenceFrequency >= 2)
      || (aggregate.capitalizedFrequency > 0 && !aggregate.known)
    );
    const unusualSignal = aggregate.unusualFrequency > 0 || aggregate.nonAsciiFrequency > 0;
    const unknownSignal = !aggregate.known && !titleOrRole && (
      unusualSignal
      || aggregate.acronymFrequency > 0
    );
    const ambiguousSignal = HETERONYM_WORDS.has(canonical)
      && (lexicon ? lexicon.pronunciationCount(canonical) > 1 : false);
    // A proper noun the dictionary says with a different number of syllables
    // than its spelling suggests is the classic trap: Worcester, Gloucester,
    // Hermione. The dictionary knows these, so no other signal catches them.
    const unexpectedSignal = !titleOrRole
      && aggregate.capitalizedMidSentenceFrequency > 0
      && saidUnlikeItsSpelling(canonical, lexicon);
    if (!nameSignal && !unknownSignal && !ambiguousSignal && !unexpectedSignal) {
      return null;
    }
    const reasons = new Set<CandidateReason>();
    if (nameSignal && aggregate.capitalizedMidSentenceFrequency > 0) {
      reasons.add("capitalized");
    }
    if (nameSignal && aggregate.capitalizedFrequency >= 3) {
      reasons.add("repeated-capitalized");
    }
    if (aggregate.namePatternFrequency > 0) {
      reasons.add("name-pattern");
    }
    if (!aggregate.known) {
      reasons.add("uncommon");
    }
    if (unusualSignal) {
      reasons.add("unusual-spelling");
    }
    if (ambiguousSignal) {
      reasons.add("ambiguous-pronunciation");
    }
    if (unexpectedSignal) {
      reasons.add("unexpected-pronunciation");
    }
    return {
      spelling: representativeSpelling(aggregate.variants, canonical),
      frequency: aggregate.frequency,
      reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
    } satisfies GlossaryCandidate;
  }).filter((candidate): candidate is GlossaryCandidate => candidate !== null);

  candidates.sort((left, right) => {
    if (right.frequency !== left.frequency) {
      return right.frequency - left.frequency;
    }
    const scoreDelta = candidateScore(right) - candidateScore(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.spelling.localeCompare(right.spelling, "en", { sensitivity: "base" });
  });

  return candidates.slice(0, Math.max(0, options.limit ?? 80));
}

/** Parse the line-oriented CMUdict format into the small interface extraction needs. */
export function parsePronouncingDictionary(contents: string): PronunciationLexicon {
  const pronunciations = new Map<string, Set<string>>();
  const first = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith(";;")) {
      continue;
    }
    const match = /^(\S+)\s+(.+)$/u.exec(trimmed);
    if (!match) {
      continue;
    }
    const spelling = match[1].replace(/\(\d+\)$/u, "").toLocaleLowerCase("en-US");
    const phones = match[2].trim();
    const pronunciationsForWord = pronunciations.get(spelling) ?? new Set<string>();
    pronunciationsForWord.add(phones);
    pronunciations.set(spelling, pronunciationsForWord);
    if (!first.has(spelling)) {
      first.set(spelling, phones);
    }
  }
  return {
    has: (word) => pronunciations.has(word.toLocaleLowerCase("en-US")),
    pronunciationCount: (word) => pronunciations.get(word.toLocaleLowerCase("en-US"))?.size ?? 0,
    pronunciation: (word) => first.get(word.toLocaleLowerCase("en-US")),
  };
}

/** Convert the explainable draft list to the persisted project shape. */
export function candidatesToGlossary(candidates: GlossaryCandidate[]): GlossaryEntry[] {
  const usedIds = new Set<string>();
  return candidates.map((candidate) => {
    const baseId = `auto-${slug(candidate.spelling)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      spelling: candidate.spelling,
      frequency: candidate.frequency,
      source: "auto",
    };
  });
}

/** Merge a new manuscript's deterministic candidates without orphaning older links. */
export function mergeGlossaryCandidates(
  existing: GlossaryEntry[],
  candidates: GlossaryCandidate[],
): GlossaryEntry[] {
  const result = existing.map((entry) => ({
    ...entry,
    ...(entry.seats ? { seats: [...entry.seats] } : {}),
  }));
  const bySpelling = new Map<string, number>();
  result.forEach((entry, index) => {
    const key = entry.spelling.trim().toLocaleLowerCase("en-US");
    const previousIndex = bySpelling.get(key);
    if (previousIndex === undefined || prefersGlossaryEntry(entry, result[previousIndex])) {
      bySpelling.set(key, index);
    }
  });
  const generated = candidatesToGlossary(candidates);
  for (const entry of generated) {
    const key = entry.spelling.trim().toLocaleLowerCase("en-US");
    const existingIndex = bySpelling.get(key);
    if (existingIndex !== undefined) {
      const current = result[existingIndex];
      result[existingIndex] = {
        ...current,
        frequency: Math.max(0, current.frequency) + Math.max(0, entry.frequency),
      };
      continue;
    }
    let id = entry.id;
    let suffix = 2;
    while (result.some((candidate) => candidate.id === id)) {
      id = `${entry.id}-${suffix}`;
      suffix += 1;
    }
    bySpelling.set(key, result.length);
    result.push({ ...entry, id });
  }
  return result;
}

/** Rebuild generated rows after the lexicon or manuscript changes. */
export function replaceAutoGlossaryCandidates(
  existing: GlossaryEntry[],
  candidates: GlossaryCandidate[],
): GlossaryEntry[] {
  const result = existing
    .filter((entry) => entry.source === "user" || Boolean(entry.respell || entry.voice_note || entry.clip_path || entry.seats?.length))
    .map((entry) => ({
      ...entry,
      ...(entry.seats ? { seats: [...entry.seats] } : {}),
    }));
  const bySpelling = new Map<string, number>();
  result.forEach((entry, index) => {
    bySpelling.set(entry.spelling.trim().toLocaleLowerCase("en-US"), index);
  });
  for (const generated of candidatesToGlossary(candidates)) {
    const key = generated.spelling.trim().toLocaleLowerCase("en-US");
    const existingIndex = bySpelling.get(key);
    if (existingIndex !== undefined) {
      result[existingIndex] = {
        ...result[existingIndex],
        frequency: generated.frequency,
      };
      continue;
    }
    let id = generated.id;
    let suffix = 2;
    while (result.some((entry) => entry.id === id)) {
      id = `${generated.id}-${suffix}`;
      suffix += 1;
    }
    bySpelling.set(key, result.length);
    result.push({ ...generated, id });
  }
  return result;
}

function prefersGlossaryEntry(candidate: GlossaryEntry, current: GlossaryEntry): boolean {
  if (candidate.source !== current.source) {
    return candidate.source === "user";
  }
  const candidateEdited = Boolean(candidate.respell || candidate.voice_note || candidate.clip_path);
  const currentEdited = Boolean(current.respell || current.voice_note || current.clip_path);
  return candidateEdited && !currentEdited;
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
  let id = options.id ?? `user-${slug(clean)}-${glossary.length + 1}`;
  if (!options.id) {
    const baseId = id;
    let suffix = glossary.length + 1;
    while (glossary.some((entry) => entry.id === id)) {
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }
  }
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
  voiceNote?: string,
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
    return {
      ...entry,
      spelling: clean,
      respell: respell?.trim() || undefined,
      voice_note: voiceNote === undefined ? entry.voice_note : voiceNote.trim() || undefined,
      source: "user" as const,
    };
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
            voice_note: entry.voice_note || source.voice_note,
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

function isKnownWord(
  word: string,
  commonWords: ReadonlySet<string>,
  lexicon: PronunciationLexicon | undefined,
): boolean {
  return lexicon ? lexicon.has(word) : commonWords.has(word);
}

function isAdjacentNameContext(text: string, left: Token, right: Token): boolean {
  return !/[.!?\n]/u.test(text.slice(left.end, right.start));
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
  return /(?:cest|chester|cestershire|eaux|ough|sch|tz|cz)/iu.test(word);
}

/**
 * True when the dictionary says a word with a different number of syllables
 * than its spelling suggests — "Worcester" is spelled with three and said with
 * two. Counting syllables is cheap and, unlike comparing letters to sounds,
 * does not fire on every name that merely looks foreign.
 */
function saidUnlikeItsSpelling(word: string, lexicon: PronunciationLexicon | undefined): boolean {
  const phones = lexicon?.pronunciation?.(word);
  if (!phones || word.includes("-") || word.includes("'")) {
    return false;
  }
  const spoken = (phones.match(/\d/gu) ?? []).length;
  if (spoken === 0) {
    return false;
  }
  return countSpelledSyllables(word) !== spoken;
}

/** Vowel groups, less the endings English writes but does not say. */
function countSpelledSyllables(word: string): number {
  const letters = word
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z]/gu, "")
    .replace(/(?:es|e)$/u, "");
  return (letters.match(/[aeiouy]+/gu) ?? []).length || 1;
}

function candidateScore(candidate: GlossaryCandidate): number {
  return candidate.reasons.reduce((score, reason) => score + (
    reason === "name-pattern" ? 5
      : reason === "unusual-spelling" ? 4
        : reason === "ambiguous-pronunciation" ? 4
          : reason === "unexpected-pronunciation" ? 4
          : reason === "capitalized" ? 3
            : reason === "repeated-capitalized" ? 2
              : reason === "uncommon" ? 1
                : 0
  ), 0);
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "entry";
}
