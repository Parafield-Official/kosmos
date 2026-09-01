/**
 * Turn a dictionary pronunciation into something a narrator can read at the
 * mic. The bundled pronouncing dictionary spells words in ARPAbet phones,
 * which nobody wants to sight-read in a booth, so this rewrites them as
 * stressed syllables: "L IY1 OW0 M IH2 N S T ER0" becomes "LEE-oh-min-ster".
 *
 * The result is a starting point, not an authority: a narrator can edit it,
 * and for a name the author invented there will be no entry at all.
 */

const VOWELS: Record<string, string> = {
  AA: "ah",
  AE: "a",
  AH: "uh",
  AO: "aw",
  AW: "ow",
  AY: "y",
  EH: "e",
  ER: "er",
  EY: "ay",
  IH: "i",
  IY: "ee",
  OW: "oh",
  OY: "oy",
  // "uu" as in book, kept apart from "oo" as in boot.
  UH: "uu",
  UW: "oo",
};

const CONSONANTS: Record<string, string> = {
  B: "b",
  CH: "ch",
  D: "d",
  DH: "th",
  F: "f",
  G: "g",
  HH: "h",
  JH: "j",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ng",
  P: "p",
  R: "r",
  S: "s",
  SH: "sh",
  T: "t",
  TH: "th",
  V: "v",
  W: "w",
  Y: "y",
  Z: "z",
  ZH: "zh",
};

/** Clusters English words can actually begin with, so codas break sensibly. */
const LEGAL_ONSETS = new Set([
  "B L", "B R", "D R", "D W", "F L", "F R", "G L", "G R", "G W", "HH Y",
  "K L", "K R", "K W", "K Y", "M Y", "P L", "P R", "P Y", "S F", "S K",
  "S L", "S M", "S N", "S P", "S T", "S W", "SH R", "T R", "T W", "TH R",
  "TH W", "V R", "S K R", "S K W", "S P L", "S P R", "S T R", "B Y", "F Y",
]);

export interface Syllable {
  text: string;
  stressed: boolean;
}

export interface RespellResult {
  respell: string;
  syllables: Syllable[];
}

/** Split "L IY1 OW0" style phones into readable, stress-marked syllables. */
export function respellArpabet(pronunciation: string): RespellResult | null {
  const phones = pronunciation
    .trim()
    .split(/\s+/u)
    .filter((phone) => phone.length > 0);
  if (phones.length === 0) {
    return null;
  }

  const parsed: Array<{ symbol: string; stress: number; vowel: boolean }> = [];
  for (const phone of phones) {
    const match = /^([A-Za-z]+)([0-2])?$/u.exec(phone);
    if (!match) {
      return null;
    }
    const symbol = match[1].toUpperCase();
    const vowel = symbol in VOWELS;
    if (!vowel && !(symbol in CONSONANTS)) {
      return null;
    }
    parsed.push({ symbol, stress: match[2] ? Number(match[2]) : 0, vowel });
  }
  if (!parsed.some((phone) => phone.vowel)) {
    return null;
  }

  const groups: Array<{ onset: string[]; nucleus: string; stress: number; coda: string[] }> = [];
  let cluster: string[] = [];
  for (const phone of parsed) {
    if (!phone.vowel) {
      cluster.push(phone.symbol);
      continue;
    }
    const previous = groups[groups.length - 1];
    if (!previous) {
      // Everything before the first vowel has to start the word.
      groups.push({ onset: cluster, nucleus: phone.symbol, stress: phone.stress, coda: [] });
    } else {
      const split = splitCluster(cluster, previous);
      previous.coda = split.coda;
      groups.push({ onset: split.onset, nucleus: phone.symbol, stress: phone.stress, coda: [] });
    }
    cluster = [];
  }
  // Anything after the last vowel closes the last syllable.
  if (groups.length > 0) {
    groups[groups.length - 1].coda = cluster;
  }

  const primary = groups.some((group) => group.stress === 1);
  const syllables = groups.map((group) => {
    const text = [
      ...group.onset.map((symbol) => CONSONANTS[symbol]),
      VOWELS[group.nucleus],
      ...group.coda.map((symbol) => CONSONANTS[symbol]),
    ].join("");
    const stressed = primary ? group.stress === 1 : group.stress === 2;
    return { text, stressed };
  });

  return {
    respell: syllables
      .map((syllable) => syllable.stressed ? syllable.text.toLocaleUpperCase("en-US") : syllable.text)
      .join("-"),
    syllables,
  };
}

/** Vowels that a reader expects to see closed by a consonant. */
const CHECKED_VOWELS = new Set(["AE", "EH", "IH", "AH", "UH", "AA", "AO"]);

/**
 * Take the longest legal onset off the end of a between-vowel cluster; the
 * rest closes the syllable before it. "min-ster", not "mins-ter".
 *
 * One exception, for reading rather than for linguistics: a stressed short
 * vowel keeps a single following consonant, so a name reads "MER-ee" instead
 * of "ME-ree", which invites a long e.
 */
function splitCluster(
  cluster: string[],
  previous: { nucleus: string; stress: number },
): { coda: string[]; onset: string[] } {
  if (
    cluster.length === 1
    && previous.stress === 1
    && CHECKED_VOWELS.has(previous.nucleus)
  ) {
    return { coda: cluster, onset: [] };
  }
  for (let size = Math.min(3, cluster.length); size >= 1; size -= 1) {
    const candidate = cluster.slice(cluster.length - size);
    const key = candidate.join(" ");
    if (size === 1 || LEGAL_ONSETS.has(key)) {
      return { coda: cluster.slice(0, cluster.length - size), onset: candidate };
    }
  }
  return { coda: cluster, onset: [] };
}

export interface RespellLexicon {
  pronunciation(word: string): string | undefined;
}

/**
 * Suggest a respelling for a word as written. Hyphenated names are handled a
 * part at a time, since the dictionary lists the parts and not the whole.
 */
export function suggestRespelling(word: string, lexicon: RespellLexicon): string | null {
  const clean = word.trim();
  if (clean.length === 0) {
    return null;
  }
  const pieces = clean.split(/[\s\u2010-\u2015-]+/u).filter((piece) => piece.length > 0);
  if (pieces.length === 0) {
    return null;
  }
  const respelled: string[] = [];
  for (const piece of pieces) {
    const pronunciation = lexicon.pronunciation(lookupKey(piece));
    if (!pronunciation) {
      return null;
    }
    const result = respellArpabet(pronunciation);
    if (!result) {
      return null;
    }
    respelled.push(result.respell);
  }
  return respelled.join(" ");
}

function lookupKey(word: string): string {
  return word
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .toLocaleLowerCase("en-US");
}
