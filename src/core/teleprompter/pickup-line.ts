/**
 * Line-sized pickups.
 *
 * A pickup is a re-record, and a re-record has to drop back into the take
 * without a seam. Both narrator practice and ACX's own guidance put that seam
 * at a sentence boundary rather than around the offending word. ACX tells
 * narrators to mark "the sentences before and after the portion containing the
 * error" and to re-record those as well, so the editor can insert the new audio
 * seamlessly. Narrators say the same thing from the performance side: a word
 * lifted out of a sentence carries the wrong pace, pitch and breath, and no
 * amount of editing makes it blend. The punch-and-roll technique used to record
 * in the first place is built on it — roll from the start of a sentence, match
 * the tone you just heard, punch in on a breath.
 *
 * So the unit here is the sentence, not the word.
 *
 * That choice also fixes Listen. A flag's timestamps come from the back-check
 * model's word alignment, which carries a few hundred milliseconds of error.
 * That is most of a word, so a word-sized clip often plays the neighbour
 * instead — but it is a small fraction of a sentence, so a sentence-sized clip
 * contains the flagged word no matter which way the error falls.
 */

/**
 * Enough of a manuscript word for the line maths. Callers pass their own richer
 * word type; the fields below are all this module reads.
 *
 * `index` must equal the word's position in the array, which is how the
 * teleprompter numbers a chapter's words.
 */
export interface PickupLineWord {
  index: number;
  lineIndex: number;
  text: string;
  /** Set when the run of punctuation after this word closes a sentence. */
  endsSentence?: boolean;
}

/** An inclusive span of word indexes. */
export interface PickupWordRange {
  from: number;
  to: number;
}

/**
 * Lead-in played before a pickup's line, so the narrator can hear the read they
 * are matching and come in on its rhythm. Punch-and-roll guides put this at
 * "a sentence or two"; Audacity's punch-and-roll defaults to five seconds. Three
 * is a sentence at narration pace, which is the shortest run-up that still
 * carries tone.
 */
export const PICKUP_PREROLL_SECONDS = 3;

/**
 * The sentence a word belongs to.
 *
 * Paragraph edges bound a sentence as firmly as a full stop does: a heading or
 * a line broken mid-thought is still somewhere a narrator would restart, and
 * running past it would splice across a pause that belongs to the take.
 */
export function sentenceWordRange(
  words: readonly PickupLineWord[],
  index: number,
): PickupWordRange | null {
  const anchor = words[index];
  if (!anchor) {
    return null;
  }
  let from = index;
  while (from > 0) {
    const previous = words[from - 1];
    if (!previous || previous.lineIndex !== anchor.lineIndex || previous.endsSentence) {
      break;
    }
    from -= 1;
  }
  let to = index;
  while (to < words.length - 1) {
    if (words[to]?.endsSentence) {
      break;
    }
    const next = words[to + 1];
    if (!next || next.lineIndex !== anchor.lineIndex) {
      break;
    }
    to += 1;
  }
  return { from, to };
}

/**
 * The sentence a word belongs to, widened by whole sentences on both sides.
 *
 * `contextSentences` is what ACX asks narrators to re-record around an error.
 * Zero gives the offending sentence alone, which is the smallest unit that
 * still blends.
 */
export function pickupLineRange(
  words: readonly PickupLineWord[],
  index: number,
  contextSentences = 0,
): PickupWordRange | null {
  const base = sentenceWordRange(words, index);
  if (!base) {
    return null;
  }
  let { from, to } = base;
  const steps = Number.isFinite(contextSentences) ? Math.max(0, Math.floor(contextSentences)) : 0;
  for (let step = 0; step < steps; step += 1) {
    const before = from > 0 ? sentenceWordRange(words, from - 1) : null;
    const after = to < words.length - 1 ? sentenceWordRange(words, to + 1) : null;
    if (!before && !after) {
      break;
    }
    from = before ? before.from : from;
    to = after ? after.to : to;
  }
  return { from, to };
}

/** The words of a range, for showing the narrator what to read again. */
export function pickupLineText(
  words: readonly PickupLineWord[],
  range: PickupWordRange | null,
): string {
  if (!range) {
    return "";
  }
  return words
    .slice(Math.max(0, range.from), Math.max(0, range.to) + 1)
    .map((word) => word.text)
    .join(" ")
    .trim();
}

/** The measured audio occupied by one transcript word. */
export interface PickupTimedWord {
  start: number;
  end: number;
}

/**
 * Audio bounds from words that were actually measured.
 *
 * Never project manuscript words through a global words-per-minute value:
 * delivery speed changes by narrator, sentence and performance. A partial live
 * window therefore returns the context it truly contains; the finished proof
 * later replaces it with the complete sentence's measured words.
 */
export function pickupLineSeconds(
  words: readonly PickupTimedWord[],
  fallback?: PickupTimedWord,
): { start: number; end: number } {
  const measured = words.filter((word) =>
    Number.isFinite(word.start)
    && Number.isFinite(word.end)
    && word.start >= 0
    && word.end >= word.start);
  if (measured.length === 0) {
    const start = Number.isFinite(fallback?.start) ? Math.max(0, fallback?.start as number) : 0;
    const end = Number.isFinite(fallback?.end) ? Math.max(start, fallback?.end as number) : start;
    return { start, end };
  }
  return {
    start: Math.min(...measured.map((word) => word.start)),
    end: Math.max(...measured.map((word) => word.end)),
  };
}

/**
 * Remove measured room tone from the edges of a line-sized playback range.
 *
 * Whisper can pin its first token to the start of a segment even when that
 * segment opens with seconds of quiet. The audio measurement is authoritative
 * for that boundary, so snap directly to where the measured silence ends or
 * begins instead of adding another guessed duration.
 */
export function trimPickupLineSilence(
  bounds: { start: number; end: number },
  silences: readonly { start: number; end: number }[] | undefined,
): { start: number; end: number } {
  let start = Number.isFinite(bounds.start) ? Math.max(0, bounds.start) : 0;
  let end = Number.isFinite(bounds.end) ? Math.max(start, bounds.end) : start;
  const ordered = [...(silences ?? [])]
    .filter((silence) =>
      Number.isFinite(silence.start)
      && Number.isFinite(silence.end)
      && silence.start >= 0
      && silence.end > silence.start)
    .sort((left, right) => left.start - right.start);

  for (const silence of ordered) {
    if (silence.start <= start && silence.end > start && silence.end < end) {
      start = silence.end;
    }
  }
  for (const silence of ordered) {
    if (silence.start > start && silence.start < end && silence.end >= end) {
      end = silence.start;
      break;
    }
  }
  return { start, end: Math.max(start, end) };
}

/**
 * Where to start playing so the narrator hears the read leading into a line.
 * Clamped at zero, so a line at the very top of a chapter simply starts there.
 */
export function pickupPrerollStart(lineStart: number, prerollSeconds = PICKUP_PREROLL_SECONDS): number {
  const start = Number.isFinite(lineStart) ? Math.max(0, lineStart) : 0;
  const preroll = Number.isFinite(prerollSeconds) ? Math.max(0, prerollSeconds) : PICKUP_PREROLL_SECONDS;
  return Math.max(0, start - preroll);
}
