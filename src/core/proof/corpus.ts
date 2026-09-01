import type { EvalCase } from "./eval";

/**
 * Hand-labelled cases for the aligner, written from the ways a real read goes
 * wrong and the ways a recogniser makes a correct read look wrong.
 *
 * The clean cases carry no expected pickups on purpose. They are the ones worth
 * watching: every entry in `expected: []` is a way we used to send a narrator
 * back to the booth for nothing.
 */

/** Lay words out on a timeline so the fixtures stay readable. */
function read(words: string, options: { from?: number; gap?: number; confidence?: number } = {}) {
  const spacing = options.gap ?? 0.1;
  let cursor = options.from ?? 0.1;
  return words.split(" ").map((word) => {
    const start = cursor;
    const end = start + 0.3;
    cursor = end + spacing;
    return options.confidence === undefined
      ? ([word, start, end] as [string, number, number])
      : ([word, start, end, options.confidence] as [string, number, number, number]);
  });
}

export const PROOF_CORPUS: EvalCase[] = [
  {
    name: "clean read",
    manuscript: "The harbour was quiet that morning.",
    heard: read("The harbour was quiet that morning"),
    expected: [],
  },
  {
    name: "substituted word",
    manuscript: "She left the letter on the table.",
    heard: read("She left the letter in the table"),
    expected: ["on"],
  },
  {
    name: "skipped clause",
    manuscript: "He waited. The train never came. He walked home.",
    heard: read("He waited He walked home"),
    expected: ["train", "never", "came"],
  },
  {
    name: "inserted word",
    manuscript: "The door opened.",
    heard: read("The heavy door opened"),
    expected: ["heavy"],
  },
  {
    name: "year read aloud",
    manuscript: "It closed in 1999 after the flood.",
    heard: read("It closed in nineteen ninety nine after the flood"),
    expected: [],
  },
  {
    name: "year read the long way",
    manuscript: "It closed in 1999 after the flood.",
    heard: read("It closed in one thousand nine hundred ninety nine after the flood"),
    expected: [],
  },
  {
    name: "year with a spoken zero",
    manuscript: "The letter is dated 1905.",
    heard: read("The letter is dated nineteen oh five"),
    expected: [],
  },
  {
    name: "recent year",
    manuscript: "By 2025 the harbour was gone.",
    heard: read("By twenty twenty five the harbour was gone"),
    expected: [],
  },
  {
    name: "hyphenated compound",
    manuscript: "There were twenty-one boats and a half-empty pier.",
    heard: read("There were twenty one boats and a half empty pier"),
    expected: [],
  },
  {
    name: "digits read as a compound number",
    manuscript: "He counted 21 crates.",
    heard: read("He counted twenty one crates"),
    expected: [],
  },
  {
    name: "ordinal read aloud",
    manuscript: "On the 3rd day they turned back.",
    heard: read("On the third day they turned back"),
    expected: [],
  },
  {
    name: "large figure with a scale word",
    manuscript: "The estate sold for 2500000 that spring.",
    heard: read("The estate sold for two million five hundred thousand that spring"),
    expected: [],
  },
  {
    name: "homophone heard the other way",
    manuscript: "They took their boat to the pier.",
    heard: read("They took there boat too the pier"),
    expected: [],
  },
  {
    name: "possessive homophone",
    manuscript: "It's whose turn to steer?",
    heard: read("Its who's turn to steer"),
    expected: [],
  },
  {
    name: "heteronym is still a real error",
    // "Read" and "led" are not interchangeable by ear, so a swap here is a
    // genuine misread and has to survive normalization.
    manuscript: "He read the log and led them out.",
    heard: read("He red the log and lead them out"),
    expected: ["read", "led"],
  },
  {
    name: "separate sentences that both start with a number",
    // Folding these together would read them as "13" and invent a mismatch.
    manuscript: "One. Three. Go.",
    heard: read("One Three Go"),
    expected: [],
  },
  {
    name: "British spelling written, American spelling heard",
    // Every recogniser we can ship writes American spellings, so a book set in
    // England would otherwise flag a word per line.
    manuscript: "The harbour master signalled towards the grey theatre.",
    heard: read("The harbor master signaled towards the gray theater"),
    expected: [],
  },
  {
    name: "compound heard as one word",
    manuscript: "The half-empty carriage rattled on.",
    heard: read("The halfempty carriage rattled on"),
    expected: [],
  },
  {
    name: "compound written open, heard closed",
    manuscript: "He sat in the court yard until dusk.",
    heard: read("He sat in the courtyard until dusk"),
    expected: [],
  },
  {
    name: "a real misread inside a compound still counts",
    manuscript: "The half-empty carriage rattled on.",
    heard: read("The half full carriage rattled on"),
    expected: ["empty"],
  },
  {
    name: "long mid-sentence pause",
    manuscript: "She turned the key and waited for the engine.",
    heard: [
      ...read("She turned the key and"),
      ...read("waited for the engine", { from: 8 }),
    ],
    expected: [],
    expectedPauses: [2.1],
    durationSeconds: 12,
    pauseThresholdSeconds: 4,
  },
  {
    name: "pause the recogniser's timings hid",
    // whisper.cpp divides a segment's span evenly among its words, so a real
    // stop can arrive as a tenth of a second. The measured audio is the source.
    manuscript: "She turned the key and waited for the engine.",
    heard: read("She turned the key and waited for the engine"),
    expected: [],
    expectedPauses: [1.7],
    silences: [{ start: 1.7, end: 8.4 }],
    durationSeconds: 12,
    pauseThresholdSeconds: 4,
  },
  {
    name: "room tone before the first word is not a pause",
    manuscript: "She turned the key.",
    heard: read("She turned the key", { from: 6 }),
    expected: [],
    silences: [{ start: 0, end: 5.9 }],
    durationSeconds: 12,
    pauseThresholdSeconds: 4,
  },
  {
    name: "gap at a sentence boundary is not a pause",
    manuscript: "She turned the key. The engine caught.",
    heard: [
      ...read("She turned the key"),
      ...read("The engine caught", { from: 8 }),
    ],
    expected: [],
    durationSeconds: 12,
    pauseThresholdSeconds: 4,
  },
  {
    name: "garbled word the recogniser was unsure about",
    manuscript: "The Leominster road was flooded.",
    heard: [
      ...read("The", { confidence: 0.95 }),
      ...read("lemster", { from: 0.5, confidence: 0.11 }),
      ...read("road was flooded", { from: 1, confidence: 0.95 }),
    ],
    expected: [],
    minConfidence: 0.4,
  },
  {
    name: "confident misread survives the gate",
    manuscript: "The Leominster road was flooded.",
    heard: [
      ...read("The", { confidence: 0.95 }),
      ...read("lancaster", { from: 0.5, confidence: 0.93 }),
      ...read("road was flooded", { from: 1, confidence: 0.95 }),
    ],
    expected: ["leominster"],
    minConfidence: 0.4,
  },
  {
    name: "gate stays out of the way when the engine reports no confidence",
    manuscript: "The Leominster road was flooded.",
    heard: read("The lancaster road was flooded"),
    expected: ["leominster"],
    minConfidence: 0.4,
  },
];
