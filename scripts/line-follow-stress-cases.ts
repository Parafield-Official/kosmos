export const LINE_FOLLOW_MANUSCRIPT = [
  "The lantern waited beside the quiet harbor.",
  "Beyond the window, winter rain moved softly.",
  "A copper kettle whispered on the stove.",
  "Mara folded the letter and checked the clock.",
  "Footsteps faded slowly beneath the stone arch.",
  "At dawn, three fishing boats crossed the silver water.",
  "She closed the book and listened for the bell.",
] as const;

export type LineFollowExpectation =
  | { kind: "continue"; throughLine: number; mustBacktrack?: boolean }
  | { kind: "halt"; atLine: number };

export interface LineFollowStressCase {
  id: string;
  description: string;
  spokenParts: readonly string[];
  expectation: LineFollowExpectation;
}

const line = (index: number) => LINE_FOLLOW_MANUSCRIPT[index] ?? "";

/**
 * A fixed virtual-narrator corpus. These are reading miscues, not random word
 * corruption: whole-line omissions, regressions, false starts, repetitions,
 * and a jump away from the current line. Keeping the script fixed makes the
 * before/after comparison meaningful even when the matcher changes.
 */
export const LINE_FOLLOW_STRESS_CASES: readonly LineFollowStressCase[] = [
  {
    id: "clean_sequential",
    description: "Reads every line in order.",
    spokenParts: [line(0), line(1), line(2), line(3)],
    expectation: { kind: "continue", throughLine: 3 },
  },
  {
    id: "restart_current_line",
    description: "Starts a line, breaks off, and restarts it from the beginning.",
    spokenParts: [line(0), "Beyond the window winter", line(1), line(2)],
    expectation: { kind: "continue", throughLine: 2, mustBacktrack: true },
  },
  {
    id: "restart_with_editing_phrase",
    description: "Uses a natural editing phrase before restarting the current line.",
    spokenParts: [line(0), "Beyond the window winter", "Sorry, start again", line(1), line(2)],
    expectation: { kind: "continue", throughLine: 2, mustBacktrack: true },
  },
  {
    id: "repeat_previous_line",
    description: "Rereads the previous complete line, then continues normally.",
    spokenParts: [line(0), line(1), line(0), line(1), line(2)],
    expectation: { kind: "continue", throughLine: 2, mustBacktrack: true },
  },
  {
    id: "repeat_after_next_line_start",
    description: "Begins the next line, returns to the prior line, then tries again.",
    spokenParts: [line(0), line(1), "A copper kettle", line(1), line(2)],
    expectation: { kind: "continue", throughLine: 2, mustBacktrack: true },
  },
  {
    id: "skip_one_line",
    description: "Reads line one and jumps over exactly one full line.",
    spokenParts: [line(0), line(2), line(3)],
    expectation: { kind: "halt", atLine: 1 },
  },
  {
    id: "skip_two_lines",
    description: "Reads line one and jumps two full lines ahead.",
    spokenParts: [line(0), line(3), line(4)],
    expectation: { kind: "halt", atLine: 1 },
  },
  {
    id: "jump_after_partial_line",
    description: "Reads part of the current line and jumps to a later line.",
    spokenParts: [line(0), "Beyond the window winter", line(3), line(4)],
    expectation: { kind: "halt", atLine: 1 },
  },
  {
    id: "unrelated_sentence",
    description: "Says a plausible sentence that is not anywhere in the manuscript.",
    spokenParts: [line(0), "The ballroom erupted with music and laughter", line(1)],
    expectation: { kind: "halt", atLine: 1 },
  },
] as const;

