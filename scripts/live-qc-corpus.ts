/**
 * Held-out narrator-slip corpus for the live Whisper back-check.
 *
 * Nothing in here was used while tuning `matchLiveWindow`/`liveBackFlag`. The
 * passages are public-domain prose with different vocabulary, names and
 * sentence shapes than the tuning text, and every take is spoken by a
 * synthetic narrator with its own accent. The `dev` half is for iteration;
 * the `lockbox` half uses different passages *and* different voices so a
 * passing score means the slip classes generalize rather than the thresholds
 * having been fitted to a transcript.
 */

export interface QcPassage {
  id: string;
  text: string;
}

export type QcSlipClass =
  | "preposition"
  | "determiner"
  | "pronoun"
  | "auxiliary"
  | "inflection"
  | "onset-clip"
  | "number"
  | "content"
  | "clean"
  | "same-number";

export interface QcCase {
  id: string;
  set: "dev" | "lockbox" | "final";
  passage: string;
  /** Manuscript words spoken in this take, verbatim from the passage. */
  phrase: string;
  /** Word offset inside `phrase` that the narrator says wrong. */
  offset: number;
  /** What the narrator says instead. Empty means the word is skipped. */
  heard: string;
  /**
   * The manuscript word `offset` is meant to land on. Required when the offset
   * points inside a hyphenated compound, where counting words by eye is easy to
   * get wrong; the harness refuses the case if the two disagree.
   */
  expects?: string;
  klass: QcSlipClass;
  voice: string;
  rate: number;
}

export const PASSAGES: QcPassage[] = [
  {
    id: "ishmael",
    text: "Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.",
  },
  {
    id: "fortune",
    text: "It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  },
  {
    id: "traveller",
    text: "The Time Traveller, for so it will be convenient to speak of him, was expounding a recondite matter to us. His pale grey eyes shone and twinkled, and his usually pale face was flushed and animated. The fire burned brightly, and the soft radiance of the incandescent lights in the lilies of silver caught the bubbles that flashed and passed in our glasses.",
  },
  {
    id: "survey",
    text: "The survey party reached the fourth ridge at nine o'clock and counted twelve hundred paces to the second marker. Four men carried the chains, and the seventh flag stood at the edge of the ravine where the river turned north.",
  },
  {
    id: "irene",
    text: "To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex. It was not that he felt any emotion akin to love for Irene Adler. All emotions, and that one particularly, were abhorrent to his cold, precise but admirably balanced mind.",
  },
  {
    id: "pond",
    text: "When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbour, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labour of my hands.",
  },
  {
    id: "epochs",
    text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.",
  },
  {
    id: "wendy",
    text: "All children, except one, grow up. They soon know that they will grow up, and the way Wendy knew was this. One day when she was two years old she was playing in a garden, and she plucked another flower and ran with it to her mother.",
  },
  {
    id: "hyde",
    text: "Mr. Utterson the lawyer was a man of a rugged countenance, that was never lighted by a smile; cold, scanty and embarrassed in discourse; backward in sentiment; lean, long, dusty, dreary and yet somehow lovable. At friendly meetings, and when the wine was to his taste, something eminently human beaconed from his eye.",
  },
  {
    id: "harker",
    text: "Left Munich at eight thirty-five on the first of May, arriving at Vienna early next morning; should have arrived at six forty-six, but the train was an hour late. Buda-Pesth seems a wonderful place, from the glimpse which I got of it from the train and the little I could walk through the streets.",
  },
  {
    id: "benbow",
    text: "Squire Trelawney, Doctor Livesey, and the rest of these gentlemen having asked me to write down the whole particulars about Treasure Island, from the beginning to the end, keeping nothing back but the bearings of the island, and that only because there is still treasure not yet lifted, I take up my pen in the year of grace seventeen hundred and forty, and go back to the time when my father kept the Admiral Benbow inn.",
  },
];

/** Iteration set: three US/UK/AU narrators over four unseen passages. */
const DEV: Array<Omit<QcCase, "set">> = [
  { id: "ishmael-prep-in-on", passage: "ishmael", phrase: "having little or no money in my purse and nothing", offset: 5, heard: "on", klass: "preposition", voice: "Samantha", rate: 170 },
  { id: "ishmael-det-the-a", passage: "ishmael", phrase: "see the watery part of the world It is a", offset: 1, heard: "a", klass: "determiner", voice: "Daniel", rate: 165 },
  { id: "ishmael-plural-years", passage: "ishmael", phrase: "years ago never mind how long precisely having little or", offset: 0, heard: "year", klass: "inflection", voice: "Karen", rate: 175 },
  { id: "ishmael-content-purse", passage: "ishmael", phrase: "money in my purse and nothing particular to interest me", offset: 3, heard: "pocket", klass: "content", voice: "Samantha", rate: 165 },
  { id: "ishmael-clean-sail", passage: "ishmael", phrase: "I thought I would sail about a little and see", offset: -1, heard: "", klass: "clean", voice: "Daniel", rate: 170 },
  { id: "ishmael-aux-is-was", passage: "ishmael", phrase: "It is a way I have of driving off the", offset: 1, heard: "was", klass: "auxiliary", voice: "Karen", rate: 165 },

  { id: "fortune-prep-on-in", passage: "fortune", phrase: "on his first entering a neighbourhood this truth is so", offset: 0, heard: "in", klass: "preposition", voice: "Daniel", rate: 170 },
  { id: "fortune-det-a-the", passage: "fortune", phrase: "of such a man may be on his first entering", offset: 2, heard: "the", klass: "determiner", voice: "Karen", rate: 165 },
  { id: "fortune-plural-families", passage: "fortune", phrase: "in the minds of the surrounding families that he is", offset: 6, heard: "family", klass: "inflection", voice: "Samantha", rate: 175 },
  { id: "fortune-pronoun-his-her", passage: "fortune", phrase: "of such a man may be on his first entering", offset: 7, heard: "her", klass: "pronoun", voice: "Daniel", rate: 165 },
  { id: "fortune-content-fortune", passage: "fortune", phrase: "of a good fortune must be in want of a", offset: 3, heard: "future", klass: "content", voice: "Karen", rate: 170 },
  { id: "fortune-clean-known", passage: "fortune", phrase: "However little known the feelings or views of such a", offset: -1, heard: "", klass: "clean", voice: "Samantha", rate: 165 },

  { id: "traveller-aux-was-is", passage: "traveller", phrase: "of him was expounding a recondite matter to us His", offset: 2, heard: "is", klass: "auxiliary", voice: "Karen", rate: 170 },
  { id: "traveller-plural-eyes", passage: "traveller", phrase: "His pale grey eyes shone and twinkled and his usually", offset: 3, heard: "eye", klass: "inflection", voice: "Samantha", rate: 165 },
  { id: "traveller-onset-flashed", passage: "traveller", phrase: "of silver caught the bubbles that flashed and passed in", offset: 6, heard: "ashed", klass: "onset-clip", voice: "Daniel", rate: 175 },
  { id: "traveller-det-the-a", passage: "traveller", phrase: "The fire burned brightly and the soft radiance of the", offset: 0, heard: "A", klass: "determiner", voice: "Karen", rate: 165 },
  { id: "traveller-prep-in-on", passage: "traveller", phrase: "incandescent lights in the lilies of silver caught the bubbles", offset: 2, heard: "on", klass: "preposition", voice: "Samantha", rate: 170 },
  { id: "traveller-clean-animated", passage: "traveller", phrase: "and his usually pale face was flushed and animated The", offset: -1, heard: "", klass: "clean", voice: "Daniel", rate: 165 },

  { id: "survey-ordinal-fourth", passage: "survey", phrase: "party reached the fourth ridge at nine o'clock and counted", offset: 3, heard: "fifth", klass: "number", voice: "Samantha", rate: 170 },
  { id: "survey-number-twelve", passage: "survey", phrase: "and counted twelve hundred paces to the second marker Four", offset: 2, heard: "twenty", klass: "number", voice: "Daniel", rate: 165 },
  { id: "survey-ordinal-second", passage: "survey", phrase: "to the second marker Four men carried the chains and", offset: 2, heard: "third", klass: "number", voice: "Karen", rate: 175 },
  { id: "survey-same-number", passage: "survey", phrase: "marker Four men carried the chains and the seventh flag", offset: 1, heard: "4", klass: "same-number", voice: "Samantha", rate: 165 },
  { id: "survey-clean-ravine", passage: "survey", phrase: "at the edge of the ravine where the river turned", offset: -1, heard: "", klass: "clean", voice: "Karen", rate: 170 },
  { id: "survey-ordinal-seventh", passage: "survey", phrase: "and the seventh flag stood at the edge of the", offset: 2, heard: "sixth", klass: "number", voice: "Daniel", rate: 165 },
];

/** Lockbox: unseen passages read by three more accents (IE/ZA/IN). */
const LOCKBOX: Array<Omit<QcCase, "set">> = [
  { id: "irene-aux-is-was", passage: "irene", phrase: "To Sherlock Holmes she is always the woman I have", offset: 4, heard: "was", klass: "auxiliary", voice: "Moira", rate: 170 },
  { id: "irene-pronoun-her-him", passage: "irene", phrase: "heard him mention her under any other name In his", offset: 3, heard: "him", klass: "pronoun", voice: "Tessa", rate: 165 },
  { id: "irene-plural-eyes", passage: "irene", phrase: "In his eyes she eclipses and predominates the whole of", offset: 2, heard: "eye", klass: "inflection", voice: "Rishi", rate: 170 },
  { id: "irene-content-emotion", passage: "irene", phrase: "he felt any emotion akin to love for Irene Adler", offset: 3, heard: "ambition", klass: "content", voice: "Moira", rate: 165 },
  { id: "irene-prep-to-for", passage: "irene", phrase: "any emotion akin to love for Irene Adler All emotions", offset: 3, heard: "for", klass: "preposition", voice: "Tessa", rate: 170 },
  { id: "irene-clean-balanced", passage: "irene", phrase: "were abhorrent to his cold precise but admirably balanced mind", offset: -1, heard: "", klass: "clean", voice: "Rishi", rate: 165 },

  { id: "pond-det-the-a", passage: "pond", phrase: "wrote the following pages or rather the bulk of them", offset: 6, heard: "a", klass: "determiner", voice: "Tessa", rate: 170 },
  { id: "pond-prep-in-on", passage: "pond", phrase: "I lived alone in the woods a mile from any", offset: 3, heard: "on", klass: "preposition", voice: "Rishi", rate: 165 },
  { id: "pond-plural-pages", passage: "pond", phrase: "wrote the following pages or rather the bulk of them", offset: 3, heard: "page", klass: "inflection", voice: "Moira", rate: 175 },
  { id: "pond-prep-on-at", passage: "pond", phrase: "on the shore of Walden Pond in Concord Massachusetts and", offset: 0, heard: "at", klass: "preposition", voice: "Tessa", rate: 165 },
  { id: "pond-content-house", passage: "pond", phrase: "in a house which I had built myself on the", offset: 2, heard: "home", klass: "content", voice: "Rishi", rate: 170 },
  { id: "pond-clean-labour", passage: "pond", phrase: "and earned my living by the labour of my hands", offset: -1, heard: "", klass: "clean", voice: "Moira", rate: 165 },

  { id: "epochs-content-best", passage: "epochs", phrase: "It was the best of times it was the worst", offset: 3, heard: "first", klass: "content", voice: "Rishi", rate: 170 },
  { id: "epochs-aux-was-is", passage: "epochs", phrase: "it was the age of wisdom it was the age", offset: 1, heard: "is", klass: "auxiliary", voice: "Moira", rate: 165 },
  { id: "epochs-plural-times", passage: "epochs", phrase: "of times it was the age of wisdom it was", offset: 1, heard: "time", klass: "inflection", voice: "Tessa", rate: 170 },
  { id: "epochs-clean-belief", passage: "epochs", phrase: "it was the epoch of belief it was the epoch", offset: -1, heard: "", klass: "clean", voice: "Rishi", rate: 165 },

  { id: "benbow-number-seventeen", passage: "benbow", phrase: "in the year of grace seventeen hundred and forty and", offset: 5, heard: "seventy", klass: "number", voice: "Moira", rate: 170 },
  { id: "benbow-det-the-a", passage: "benbow", phrase: "and go back to the time when my father kept", offset: 4, heard: "a", klass: "determiner", voice: "Tessa", rate: 165 },
  { id: "benbow-plural-gentlemen", passage: "benbow", phrase: "the rest of these gentlemen having asked me to write", offset: 4, heard: "gentleman", klass: "inflection", voice: "Rishi", rate: 170 },
  { id: "benbow-prep-to-at", passage: "benbow", phrase: "from the beginning to the end keeping nothing back but", offset: 3, heard: "at", klass: "preposition", voice: "Moira", rate: 165 },
  { id: "benbow-clean-bearings", passage: "benbow", phrase: "keeping nothing back but the bearings of the island and", offset: -1, heard: "", klass: "clean", voice: "Tessa", rate: 170 },
];

/**
 * Final validation: three more passages read by a narrator (Tara) who appears
 * nowhere else. Run once, after tuning has stopped, as the unbiased estimate.
 */
const FINAL: Array<Omit<QcCase, "set">> = [
  { id: "wendy-prep-in-on", passage: "wendy", phrase: "old she was playing in a garden and she plucked", offset: 4, heard: "on", klass: "preposition", voice: "Tara", rate: 170 },
  { id: "wendy-plural-children", passage: "wendy", phrase: "All children except one grow up They soon know that", offset: 1, heard: "child", klass: "inflection", voice: "Tara", rate: 165 },
  { id: "wendy-det-a-the", passage: "wendy", phrase: "was playing in a garden and she plucked another flower", offset: 3, heard: "the", klass: "determiner", voice: "Tara", rate: 170 },
  { id: "wendy-content-flower", passage: "wendy", phrase: "she plucked another flower and ran with it to her", offset: 3, heard: "feather", klass: "content", voice: "Tara", rate: 165 },
  { id: "wendy-number-two", passage: "wendy", phrase: "when she was two years old she was playing in", offset: 3, heard: "three", klass: "number", voice: "Tara", rate: 170 },
  { id: "wendy-clean-grow", passage: "wendy", phrase: "They soon know that they will grow up and the", offset: -1, heard: "", klass: "clean", voice: "Tara", rate: 165 },

  { id: "hyde-aux-was-is", passage: "hyde", phrase: "the lawyer was a man of a rugged countenance that", offset: 2, heard: "is", klass: "auxiliary", voice: "Tara", rate: 170 },
  { id: "hyde-pronoun-his-her", passage: "hyde", phrase: "the wine was to his taste something eminently human beaconed", offset: 4, heard: "her", klass: "pronoun", voice: "Tara", rate: 165 },
  { id: "hyde-plural-meetings", passage: "hyde", phrase: "At friendly meetings and when the wine was to his", offset: 2, heard: "meeting", klass: "inflection", voice: "Tara", rate: 170 },
  { id: "hyde-content-smile", passage: "hyde", phrase: "that was never lighted by a smile cold scanty and", offset: 6, heard: "sigh", klass: "content", voice: "Tara", rate: 165 },
  { id: "hyde-clean-dreary", passage: "hyde", phrase: "lean long dusty dreary and yet somehow lovable At friendly", offset: -1, heard: "", klass: "clean", voice: "Tara", rate: 170 },

  { id: "harker-number-eight", passage: "harker", phrase: "Left Munich at eight thirty-five on the first of May", offset: 3, heard: "nine", klass: "number", voice: "Tara", rate: 170 },
  { id: "harker-ordinal-first", passage: "harker", phrase: "thirty-five on the first of May arriving at Vienna early", offset: 4, heard: "third", klass: "number", voice: "Tara", rate: 165 },
  // `forty-six` tokenizes into two words, so the slip has to land on one of
  // them whole. Breaking the last component gives 6:46 read as 6:49, which is
  // how a narrator actually misreads a time; breaking the first left `fifty` in
  // front of a stranded `six` and Whisper collapsed the lot to `656`.
  { id: "harker-number-forty-six", passage: "harker", phrase: "should have arrived at six forty-six but the train was", offset: 6, expects: "six", heard: "nine", klass: "number", voice: "Tara", rate: 170 },
  { id: "harker-prep-at-in", passage: "harker", phrase: "should have arrived at six forty-six but the train was", offset: 3, heard: "in", klass: "preposition", voice: "Tara", rate: 165 },
  { id: "harker-plural-streets", passage: "harker", phrase: "little I could walk through the streets", offset: 6, heard: "street", klass: "inflection", voice: "Tara", rate: 170 },
  { id: "harker-clean-glimpse", passage: "harker", phrase: "from the glimpse which I got of it from the", offset: -1, heard: "", klass: "clean", voice: "Tara", rate: 165 },
];

export const CASES: QcCase[] = [
  ...DEV.map((entry) => ({ ...entry, set: "dev" as const })),
  ...LOCKBOX.map((entry) => ({ ...entry, set: "lockbox" as const })),
  ...FINAL.map((entry) => ({ ...entry, set: "final" as const })),
];
