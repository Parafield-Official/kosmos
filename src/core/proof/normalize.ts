export interface ManuscriptToken {
  text: string;
  value: string;
  start: number;
  end: number;
  index: number;
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

