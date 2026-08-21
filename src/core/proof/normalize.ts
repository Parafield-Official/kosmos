import { homophoneClass } from "./homophones";
import { foldNumberRun } from "./numbers";

export interface ManuscriptToken {
  text: string;
  value: string;
  start: number;
  end: number;
  index: number;
}

/**
 * One thing to compare. A unit usually covers a single token, but a number
 * spoken across several words collapses into one unit, and a hyphenated
 * compound contributes several units from one token.
 */
export interface MatchUnit {
  key: string;
  /** Inclusive range of source tokens or words this unit came from. */
  from: number;
  to: number;
}

/**
 * Split for matching on the pieces a reader actually says. "Twenty-one" is one
 * manuscript token but two spoken words, and the recogniser only ever reports
 * spoken words.
 */
export function spokenPieces(text: string): string[] {
  return text
    .split(/[-\u2010-\u2015]+/u)
    .map((piece) => normalizeToken(piece))
    .filter((piece) => piece.length > 0);
}

/**
 * Reduce a sequence of spoken words to comparison units, folding numbers and
 * collapsing same-sounding words onto a shared key.
 */
export function toMatchUnits(pieces: Array<{ value: string; source: number }>): MatchUnit[] {
  const values = pieces.map((piece) => piece.value);
  const units: MatchUnit[] = [];
  let index = 0;
  while (index < values.length) {
    const number = foldNumberRun(values, index);
    if (number && number.length > 0) {
      units.push({
        key: number.key,
        from: pieces[index].source,
        to: pieces[index + number.length - 1].source,
      });
      index += number.length;
      continue;
    }
    units.push({
      key: homophoneClass(values[index]) ?? values[index],
      from: pieces[index].source,
      to: pieces[index].source,
    });
    index += 1;
  }
  return units;
}

export function manuscriptMatchUnits(tokens: ManuscriptToken[]): MatchUnit[] {
  const pieces: Array<{ value: string; source: number }> = [];
  for (const token of tokens) {
    for (const value of spokenPieces(token.text)) {
      pieces.push({ value, source: token.index });
    }
  }
  return toMatchUnits(pieces);
}

export function transcriptMatchUnits(words: Array<{ text: string }>): MatchUnit[] {
  const pieces: Array<{ value: string; source: number }> = [];
  words.forEach((word, index) => {
    for (const value of spokenPieces(word.text)) {
      pieces.push({ value, source: index });
    }
  });
  return toMatchUnits(pieces);
}

/** Normalize only for matching. The original token is kept for display. */
export function normalizeToken(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "")
    .replace(/^'+|'+$/gu, "");
}

export function tokenizeManuscript(text: string): ManuscriptToken[] {
  const tokens: ManuscriptToken[] = [];
  const matcher = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const token = match[0];
    const value = normalizeToken(token);
    if (value.length === 0) {
      continue;
    }
    tokens.push({
      text: token,
      value,
      start: match.index,
      end: match.index + token.length,
      index: tokens.length,
    });
  }

  return tokens;
}

