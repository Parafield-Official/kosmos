/**
 * British and American spellings of the same word.
 *
 * A recogniser writes the spelling it was trained on, which is American. A book
 * set in England is written the other way, so "harbour" comes back as "harbor"
 * and "signalled" as "signaled" — the narrator said the word correctly and the
 * page fills with pickups nobody can act on.
 *
 * Both sides fold to one form, so the only way this can hide a real misread is
 * if two genuinely different words fold together. That is what the guards below
 * are for: "four" must never become "for", and "filled" must never become
 * "filed". Everything else that folds oddly ("devour" to "devor") is harmless,
 * because manuscript and transcript fold the same way and no other word lands
 * on the same key.
 */

/** Pairs no rule can derive. Written British first, American second. */
const IRREGULAR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["aeroplane", "airplane"],
  ["aluminium", "aluminum"],
  ["anaemia", "anemia"],
  ["anaesthetic", "anesthetic"],
  ["archaeology", "archeology"],
  ["cheque", "check"],
  ["defence", "defense"],
  ["diarrhoea", "diarrhea"],
  ["distil", "distill"],
  ["draught", "draft"],
  ["encyclopaedia", "encyclopedia"],
  ["enrol", "enroll"],
  ["enrolment", "enrollment"],
  ["fulfil", "fulfill"],
  ["fulfilment", "fulfillment"],
  ["foetus", "fetus"],
  ["gaol", "jail"],
  ["grey", "gray"],
  ["instalment", "installment"],
  ["instil", "instill"],
  ["haemoglobin", "hemoglobin"],
  ["jewellery", "jewelry"],
  ["kerb", "curb"],
  ["licence", "license"],
  ["manoeuvre", "maneuver"],
  ["mediaeval", "medieval"],
  ["mould", "mold"],
  ["moult", "molt"],
  ["moustache", "mustache"],
  ["oesophagus", "esophagus"],
  ["oestrogen", "estrogen"],
  ["offence", "offense"],
  ["paediatric", "pediatric"],
  ["plough", "plow"],
  ["practise", "practice"],
  ["pretence", "pretense"],
  ["programme", "program"],
  ["pyjamas", "pajamas"],
  ["sceptic", "skeptic"],
  ["sceptical", "skeptical"],
  ["skilful", "skillful"],
  ["smoulder", "smolder"],
  ["speciality", "specialty"],
  ["storey", "story"],
  ["sulphur", "sulfur"],
  ["tyre", "tire"],
  ["wilful", "willful"],
  ["woollen", "woolen"],
];

/**
 * The endings a narrator's copy of these words will actually carry. The two
 * spellings of a word can inflect differently — one storey and two storeys,
 * one story and two stories — so each side is inflected by English's own rules
 * and the results line up by position.
 */
function inflections(word: string): string[] {
  const consonantY = /[^aeiou]y$/u.test(word);
  const stem = word.endsWith("e") ? word.slice(0, -1) : word;
  const forms: string[] = [word];
  if (consonantY) {
    forms.push(`${word.slice(0, -1)}ies`, `${word.slice(0, -1)}ied`, `${word}ing`, `${word.slice(0, -1)}ier`, `${word.slice(0, -1)}iers`);
    return forms;
  }
  forms.push(
    /(?:s|sh|ch|x|z)$/u.test(word) ? `${word}es` : `${word}s`,
    word.endsWith("e") ? `${word}d` : `${word}ed`,
    `${stem}ing`,
    word.endsWith("e") ? `${word}r` : `${word}er`,
    word.endsWith("e") ? `${word}rs` : `${word}ers`,
  );
  return forms;
}

const IRREGULAR = new Map<string, string>();
for (const [british, american] of IRREGULAR_PAIRS) {
  const britishForms = inflections(british);
  const americanForms = inflections(american);
  britishForms.forEach((form, index) => {
    IRREGULAR.set(form, americanForms[index] ?? american);
  });
}

/** Vowel groups, to tell a one-syllable stem from a longer one. */
function vowelGroups(value: string): number {
  return (value.match(/[aeiouy]+/gu) ?? []).length;
}

/**
 * Fold a word onto one spelling. Returns the word unchanged when no rule
 * applies, so this is safe to call on everything.
 */
export function americanSpelling(word: string): string {
  const lower = word.toLocaleLowerCase("en-US");
  const irregular = IRREGULAR.get(lower);
  if (irregular) {
    return irregular;
  }
  let value = lower;

  // colour, harbour, favourite, labouring. Two letters must precede the "our",
  // which keeps four, hour, your, pour, sour, tour and dour out of it.
  value = value.replace(/([a-z]{2})our(?=s?$|ed$|ing$|ite$|ful$|less$|able$)/gu, "$1or");

  // realise, organisation, analyse. Three letters must precede, which keeps
  // prise (a different word from prize) and rise, wise and arise out of it.
  value = value.replace(/([a-z]{3})is(?=e[sd]?$|ing$|ation)/gu, "$1iz");
  value = value.replace(/([a-z]{3})ys(?=e[sd]?$|ing$)/gu, "$1yz");

  // centre, theatre, litre. A consonant must precede, so more, care, sure and
  // figure are untouched, and four letters at least, so acre and ogre are too.
  value = value.replace(/([a-z]{2}[bcdfgklmnpqstvxz])re(?=s?$|d$)/gu, "$1er");

  // travelled, signalling, jeweller, marvellous. The stem must carry two vowel
  // groups, which keeps filled from becoming filed, called from becoming caled
  // and callous from becoming calous.
  value = value.replace(/([a-z]+)ll(?=ed$|ing$|er$|ers$|est$|ous$)/gu, (match, stem: string) =>
    vowelGroups(stem) >= 2 ? `${stem}l` : match);

  // catalogue, dialogue. Four letters must precede, keeping vogue and rogue out.
  value = value.replace(/([a-z]{4})ogue(?=s?$)/gu, "$1og");

  return value;
}
