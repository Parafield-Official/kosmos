/**
 * Numbers are the biggest source of false pickups. A manuscript says "1999" and
 * the narrator reads "nineteen ninety nine"; a plain word diff calls that one
 * deletion and three insertions. Both sides are folded to the same digit string
 * so the comparison sees one token that matches.
 *
 * Folding to digits rather than to words is deliberate: it collapses the several
 * legitimate ways to read the same figure. "Nineteen ninety nine" and "one
 * thousand nine hundred ninety nine" both land on 1999, so the narrator is free
 * to read it either way.
 */

const CARDINALS = new Map<string, number>([
  ["zero", 0], ["oh", 0], ["nought", 0], ["naught", 0],
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15],
  ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19],
  ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50],
  ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90],
]);

const ORDINALS = new Map<string, number>([
  ["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5],
  ["sixth", 6], ["seventh", 7], ["eighth", 8], ["ninth", 9], ["tenth", 10],
  ["eleventh", 11], ["twelfth", 12], ["thirteenth", 13], ["fourteenth", 14],
  ["fifteenth", 15], ["sixteenth", 16], ["seventeenth", 17], ["eighteenth", 18],
  ["nineteenth", 19], ["twentieth", 20], ["thirtieth", 30], ["fortieth", 40],
  ["fiftieth", 50], ["sixtieth", 60], ["seventieth", 70], ["eightieth", 80],
  ["ninetieth", 90],
]);

const SCALES = new Map<string, number>([
  ["hundred", 100], ["thousand", 1_000], ["million", 1_000_000], ["billion", 1_000_000_000],
]);

const ORDINAL_SCALES = new Map<string, number>([
  ["hundredth", 100], ["thousandth", 1_000], ["millionth", 1_000_000], ["billionth", 1_000_000_000],
]);

const ORDINAL_SUFFIX = /^(\d+)(?:st|nd|rd|th)$/u;
const DIGITS_ONLY = /^\d+$/u;

export interface NumberRun {
  /** Canonical key, e.g. "1999" or "21#ord". */
  key: string;
  /** How many input values the run consumed. */
  length: number;
}

export function isNumberWord(value: string): boolean {
  return CARDINALS.has(value)
    || ORDINALS.has(value)
    || SCALES.has(value)
    || ORDINAL_SCALES.has(value);
}

/** Digits, with or without an ordinal suffix, as written in the manuscript. */
export function canonicalDigits(value: string): string | null {
  const ordinal = ORDINAL_SUFFIX.exec(value);
  if (ordinal) {
    return `${stripLeadingZeros(ordinal[1])}#ord`;
  }
  return DIGITS_ONLY.test(value) ? stripLeadingZeros(value) : null;
}

/**
 * Fold the number at `start` into one canonical key, or return null when the
 * value there is not a number.
 */
export function foldNumberRun(values: string[], start: number): NumberRun | null {
  const digits = canonicalDigits(values[start] ?? "");
  if (digits !== null) {
    return { key: digits, length: 1 };
  }
  if (!isNumberWord(values[start] ?? "")) {
    return null;
  }

  // Groups hold figures spoken side by side without a scale word, the way a
  // year is read: "nineteen" then "ninety nine" is 19 then 99, which is 1999
  // rather than 118.
  const groups: Array<{ value: number; length: number }> = [];
  let current = 0;
  let groupStart = start;
  let scaled = 0;
  let usedScale = false;
  let ordinal = false;
  let index = start;

  while (index < values.length) {
    const value = values[index];

    // "one hundred and one" is one number, but a bare "and" is not.
    if (value === "and" && index > start && isNumberWord(values[index + 1] ?? "")) {
      index += 1;
      continue;
    }

    const cardinal = CARDINALS.get(value);
    const scale = SCALES.get(value);
    const ordinalValue = ORDINALS.get(value);
    const ordinalScale = ORDINAL_SCALES.get(value);

    if (cardinal !== undefined) {
      if (cardinal === 0) {
        // A spoken zero is a placeholder digit, as in "nineteen oh five".
        pushGroup(index);
        groups.push({ value: 0, length: 1 });
        groupStart = index + 1;
      } else if (canAbsorb(current, cardinal)) {
        current += cardinal;
      } else {
        pushGroup(index);
        groupStart = index;
        current = cardinal;
      }
    } else if (scale !== undefined) {
      if (scale === 100) {
        current = (current === 0 ? 1 : current) * 100;
      } else {
        scaled += (current === 0 ? 1 : current) * scale;
        current = 0;
        usedScale = true;
      }
    } else if (ordinalValue !== undefined) {
      if (canAbsorb(current, ordinalValue)) {
        current += ordinalValue;
      } else {
        pushGroup(index);
        groupStart = index;
        current = ordinalValue;
      }
      ordinal = true;
      index += 1;
      break;
    } else if (ordinalScale !== undefined) {
      if (ordinalScale === 100) {
        current = (current === 0 ? 1 : current) * 100;
      } else {
        scaled += (current === 0 ? 1 : current) * ordinalScale;
        current = 0;
        usedScale = true;
      }
      ordinal = true;
      index += 1;
      break;
    } else {
      break;
    }
    index += 1;
  }

  if (index === start) {
    return null;
  }

  const suffix = ordinal ? "#ord" : "";
  if (usedScale) {
    // A scale word binds the whole phrase together, so "one thousand nine
    // hundred ninety nine" is unambiguously one figure.
    return { key: `${scaled + current}${suffix}`, length: index - start };
  }
  pushGroup(index);
  if (groups.length === 1) {
    return { key: `${groups[0].value}${suffix}`, length: index - start };
  }
  if (isYearShaped(groups)) {
    return {
      key: `${groups.map((group) => group.value).join("")}${suffix}`,
      length: index - start,
    };
  }
  // Several figures in a row that are not year-shaped are separate numbers.
  // "One. Three." reaches us as two words with no punctuation, and joining them
  // into 13 would invent a mismatch against a manuscript that reads them apart.
  return { key: String(groups[0].value), length: groups[0].length };

  function pushGroup(boundary: number): void {
    if (current !== 0) {
      groups.push({ value: current, length: boundary - groupStart });
      current = 0;
    }
  }
}

/**
 * Whether side-by-side figures are the way a year is spoken. Restricting
 * concatenation to this shape keeps the fold symmetric: it depends only on the
 * words, so the manuscript and the transcript always fold the same way, and
 * neither side can invent a mismatch the other cannot see.
 */
function isYearShaped(groups: Array<{ value: number }>): boolean {
  const values = groups.map((group) => group.value);
  if (values.length === 2) {
    return values.every((value) => value >= 10 && value <= 99);
  }
  if (values.length === 3) {
    // "Nineteen oh five".
    return values[0] >= 10 && values[0] <= 99 && values[1] === 0 && values[2] >= 1 && values[2] <= 9;
  }
  return false;
}

/**
 * Whether a figure can join the one being built. "Ninety" then "nine" is 99
 * because 90 has an empty ones place; "nineteen" then "ninety" cannot join,
 * because 19 has no empty place for a 90 to sit in.
 */
function canAbsorb(current: number, next: number): boolean {
  if (current === 0) {
    return false;
  }
  if (current % 100 === 0 && next < 100) {
    return true;
  }
  return current % 10 === 0 && next < 10;
}

function stripLeadingZeros(value: string): string {
  const trimmed = value.replace(/^0+/u, "");
  return trimmed === "" ? "0" : trimmed;
}
