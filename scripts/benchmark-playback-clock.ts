import { performance } from "node:perf_hooks";
import { strict as assert } from "node:assert";
import { alignedManuscriptTokens } from "../src/core/proof/selection";
import { createChapterPlaybackClock, originalChapterTranscript, tokenIndexAtTime } from "../labs/next/src/main-app/review-timing";
import type { BookChapter } from "../labs/next/src/main-app/store";

// A roughly 40-minute chapter at 150 words/minute, with forward and backward seeks.
const count = 6000;
const manuscript = Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
const chapter = { id: "benchmark", recordedWords: Array.from({ length: count }, (_, index) => ({
  index, start: index * 0.4, end: index * 0.4 + 0.35,
})) } as BookChapter;
const times = Array.from({ length: 60 }, (_, index) => ((index * 97) % count) * 0.4 + 0.1);
const beforeStart = performance.now();
const before = times.map(time => tokenIndexAtTime(alignedManuscriptTokens(manuscript, originalChapterTranscript(manuscript, chapter)), time));
const beforeMs = performance.now() - beforeStart;
const clock = createChapterPlaybackClock();
const setupStart = performance.now();
clock(manuscript, chapter, "original", 0);
const setupMs = performance.now() - setupStart;
const afterStart = performance.now();
const after = times.map(time => clock(manuscript, chapter, "original", time));
const afterMs = performance.now() - afterStart;
assert.deepEqual(after, before);
console.log(JSON.stringify({ words: count, updates: times.length, beforeMs, setupMs, afterMs, speedup: beforeMs / afterMs, identicalPositions: true }, null, 2));
