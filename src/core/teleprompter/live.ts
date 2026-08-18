import { normalizeToken } from "../proof/normalize";

export interface LiveExpectedWord {
  index: number;
  lineIndex: number;
  text: string;
}

export interface LiveTranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface LiveMatchState {
  cursor: number;
  lastHeardEnd: number;
}

export interface LiveMismatch {
  id: string;
  expected: string;
  heard: string;
  expectedIndex: number;
  lineIndex: number;
  start: number;
  end: number;
  confidence: number;
}

export interface LiveMatchResult {
  state: LiveMatchState;
  flag?: LiveMismatch;
}

export interface LiveMatchInput {
  chapterId: string;
  expected: LiveExpectedWord[];
  transcript: LiveTranscriptWord[];
  state: LiveMatchState;
  flagsEnabled: boolean;
  confidenceThreshold?: number;
  dismissedIds?: string[];
}

/**
 * Consume a rolling ASR window without ever moving the prompt backwards.
 * Low-confidence words are observed for de-duplication but do not advance the
 * script or produce a live flag; batch Proof remains the recall path.
 */
export function matchLiveWindow(input: LiveMatchInput): LiveMatchResult {
  let cursor = Math.max(0, Math.min(input.expected.length, Math.floor(input.state.cursor)));
  let lastHeardEnd = Number.isFinite(input.state.lastHeardEnd) ? Math.max(0, input.state.lastHeardEnd) : 0;
  const threshold = Number.isFinite(input.confidenceThreshold)
    ? Math.min(1, Math.max(0, input.confidenceThreshold as number))
    : 0.9;
  const dismissedIds = new Set(input.dismissedIds ?? []);
  let flag: LiveMismatch | undefined;

  const words = input.transcript
    .filter((word) => typeof word.text === "string" && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start)
    .sort((left, right) => left.start - right.start);

  for (const word of words) {
    if (word.end <= lastHeardEnd + 0.05) {
      continue;
    }
    lastHeardEnd = Math.max(lastHeardEnd, word.end);
    const expectedWord = input.expected[cursor];
    if (!expectedWord) {
      continue;
    }
    const heard = normalizeToken(word.text);
    const expected = normalizeToken(expectedWord.text);
    if (!heard || !expected) {
      continue;
    }
    if (heard === expected) {
      cursor += 1;
      continue;
    }
    const confidence = Number.isFinite(word.confidence) ? Math.min(1, Math.max(0, word.confidence as number)) : 0;
    if (confidence < threshold || heard.length < 2 || expected.length < 2) {
      continue;
    }

    const id = `live-${input.chapterId}-${expectedWord.index}-${heard}`;
    if (input.flagsEnabled && !flag && !dismissedIds.has(id)) {
      flag = {
        id,
        expected: expectedWord.text,
        heard: word.text,
        expectedIndex: expectedWord.index,
        lineIndex: expectedWord.lineIndex,
        start: Math.max(0, word.start),
        end: Math.max(Math.max(0, word.start), word.end),
        confidence,
      };
    }
    cursor += 1;
  }

  return { state: { cursor, lastHeardEnd }, flag };
}
