import { alignManuscriptTokens, type TranscriptWord } from "./align";

export interface LiveTimelineRefinement {
  timeline: TranscriptWord[];
  adopted: boolean;
  coverage: number;
  refinedWordCount: number;
  baselineWordCount: number;
}

/**
 * Project post-recording word boundaries onto the canonical manuscript clock.
 * The aligner is timing evidence only: its spelling is never copied into the
 * saved live timeline, and a word it cannot place keeps its booth timestamp.
 */
export function refineLiveManuscriptTimeline(input: {
  manuscript: string;
  baseline: TranscriptWord[];
  aligned: TranscriptWord[];
  minimumCoverage?: number;
}): LiveTimelineRefinement {
  const minimumCoverage = clamp(input.minimumCoverage ?? 0.8, 0, 1);
  const baseline = validWords(input.baseline);
  if (baseline.length === 0) {
    return emptyResult(input.baseline);
  }

  const baselineByToken = new Map(
    alignManuscriptTokens(input.manuscript, baseline)
      .filter(hasTiming)
      .map((word) => [word.tokenIndex, word] as const),
  );
  const refinedByToken = new Map(
    alignManuscriptTokens(input.manuscript, validWords(input.aligned))
      .filter(hasTiming)
      .map((word) => [word.tokenIndex, word] as const),
  );

  let refinedWordCount = 0;
  const projected: TranscriptWord[] = [];
  for (const [tokenIndex, original] of baselineByToken) {
    const refined = refinedByToken.get(tokenIndex);
    if (refined) {
      refinedWordCount += 1;
    }
    const timing = refined ?? original;
    projected.push({
      text: original.written,
      start: timing.start as number,
      end: timing.end as number,
      ...(refined ? {} : confidenceForToken(baseline, original.start, original.end)),
    });
  }

  const coverage = baselineByToken.size > 0 ? refinedWordCount / baselineByToken.size : 0;
  const adopted = coverage >= minimumCoverage && isMonotonic(projected);
  return {
    timeline: adopted ? projected : input.baseline.map((word) => ({ ...word })),
    adopted,
    coverage,
    refinedWordCount,
    baselineWordCount: baselineByToken.size,
  };
}

function validWords(words: TranscriptWord[]): TranscriptWord[] {
  return words.filter((word) =>
    typeof word.text === "string"
    && Number.isFinite(word.start)
    && Number.isFinite(word.end)
    && word.start >= 0
    && word.end >= word.start,
  );
}

function hasTiming(word: { start?: number; end?: number }): word is typeof word & { start: number; end: number } {
  return Number.isFinite(word.start) && Number.isFinite(word.end) && (word.end as number) >= (word.start as number);
}

function isMonotonic(words: TranscriptWord[]): boolean {
  return words.every((word, index) => index === 0 || word.start >= words[index - 1].start);
}

function confidenceForToken(
  baseline: TranscriptWord[],
  start: number | undefined,
  end: number | undefined,
): Pick<TranscriptWord, "confidence"> {
  const source = baseline.find((word) => word.start === start && word.end === end);
  return source?.confidence === undefined ? {} : { confidence: source.confidence };
}

function emptyResult(timeline: TranscriptWord[]): LiveTimelineRefinement {
  return {
    timeline: timeline.map((word) => ({ ...word })),
    adopted: false,
    coverage: 0,
    refinedWordCount: 0,
    baselineWordCount: 0,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
