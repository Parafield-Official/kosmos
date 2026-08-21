/**
 * Words that sound identical are treated as the same word when comparing a
 * manuscript to a transcript. If the manuscript says "their" and the recogniser
 * heard "there", the audio is correct either way, so a pickup there sends the
 * narrator back to the booth to re-record something that already sounds right.
 *
 * Heteronyms are deliberately absent. "Read" and "red" are spelled differently
 * and sometimes sound the same, but "read" also has a second pronunciation, and
 * choosing the wrong one is exactly the mistake a narrator makes and needs
 * flagged. The same goes for lead/led, sow/sew, tear/tier, bow/bough, and
 * row/roe. Suppressing those would hide real errors, so they stay out.
 */
const HOMOPHONE_GROUPS: readonly string[][] = [
  ["aisle", "isle", "i'll"],
  ["allowed", "aloud"],
  ["altar", "alter"],
  ["ate", "eight"],
  ["bare", "bear"],
  ["be", "bee"],
  ["berry", "bury"],
  ["blew", "blue"],
  ["board", "bored"],
  ["brake", "break"],
  ["buy", "by", "bye"],
  ["cell", "sell"],
  ["cent", "scent", "sent"],
  ["cereal", "serial"],
  ["chews", "choose"],
  ["chord", "cord"],
  ["cite", "sight", "site"],
  ["coarse", "course"],
  ["complement", "compliment"],
  ["council", "counsel"],
  ["creak", "creek"],
  ["cue", "queue"],
  ["days", "daze"],
  ["dear", "deer"],
  ["dual", "duel"],
  ["dew", "due"],
  ["fair", "fare"],
  ["faint", "feint"],
  ["feat", "feet"],
  ["fir", "fur"],
  ["flea", "flee"],
  ["flour", "flower"],
  ["for", "fore", "four"],
  ["gene", "jean"],
  ["grate", "great"],
  ["groan", "grown"],
  ["guessed", "guest"],
  ["hair", "hare"],
  ["hall", "haul"],
  ["heal", "heel", "he'll"],
  ["hear", "here"],
  ["heard", "herd"],
  ["higher", "hire"],
  ["hoard", "horde"],
  ["hole", "whole"],
  ["holy", "wholly"],
  ["idle", "idol"],
  ["in", "inn"],
  ["its", "it's"],
  ["knead", "need"],
  ["knew", "new"],
  ["knight", "night"],
  ["knot", "not"],
  ["know", "no"],
  ["knows", "nose"],
  ["lain", "lane"],
  ["leak", "leek"],
  ["lessen", "lesson"],
  ["loan", "lone"],
  ["made", "maid"],
  ["mail", "male"],
  ["marshal", "martial"],
  ["meat", "meet"],
  ["medal", "meddle"],
  ["might", "mite"],
  ["missed", "mist"],
  ["moan", "mown"],
  ["morning", "mourning"],
  ["muscle", "mussel"],
  ["naval", "navel"],
  ["none", "nun"],
  ["oar", "or", "ore"],
  ["one", "won"],
  ["pail", "pale"],
  ["pain", "pane"],
  ["pair", "pare", "pear"],
  ["passed", "past"],
  ["patience", "patients"],
  ["pause", "paws"],
  ["peace", "piece"],
  ["peak", "peek", "pique"],
  ["peal", "peel"],
  ["pedal", "peddle"],
  ["plain", "plane"],
  ["pole", "poll"],
  ["poor", "pore", "pour"],
  ["praise", "prays", "preys"],
  ["pray", "prey"],
  ["presence", "presents"],
  ["principal", "principle"],
  ["profit", "prophet"],
  ["rain", "reign", "rein"],
  ["rap", "wrap"],
  ["real", "reel"],
  ["right", "rite", "write"],
  ["ring", "wring"],
  ["road", "rode"],
  ["role", "roll"],
  ["root", "route"],
  ["sail", "sale"],
  ["scene", "seen"],
  ["sea", "see"],
  ["seam", "seem"],
  ["seas", "sees", "seize"],
  ["soar", "sore"],
  ["sole", "soul"],
  ["some", "sum"],
  ["son", "sun"],
  ["staid", "stayed"],
  ["stair", "stare"],
  ["stake", "steak"],
  ["stationary", "stationery"],
  ["steal", "steel"],
  ["straight", "strait"],
  ["suite", "sweet"],
  ["tacks", "tax"],
  ["tail", "tale"],
  ["taught", "taut"],
  ["tea", "tee"],
  ["team", "teem"],
  ["their", "there", "they're"],
  ["threw", "through"],
  ["throne", "thrown"],
  ["thyme", "time"],
  ["tide", "tied"],
  ["to", "too", "two"],
  ["toe", "tow"],
  ["told", "tolled"],
  ["vain", "vane", "vein"],
  ["vale", "veil"],
  ["waist", "waste"],
  ["wait", "weight"],
  ["waive", "wave"],
  ["ware", "wear", "where"],
  ["way", "weigh"],
  ["weak", "week"],
  ["weather", "whether"],
  ["which", "witch"],
  ["whine", "wine"],
  ["who's", "whose"],
  ["wood", "would"],
  ["yoke", "yolk"],
  ["your", "you're"],
];

const CLASS_BY_WORD = buildIndex();

/** The shared key for a set of same-sounding words, or null if it has none. */
export function homophoneClass(value: string): string | null {
  return CLASS_BY_WORD.get(value) ?? null;
}

export function homophoneGroupCount(): number {
  return HOMOPHONE_GROUPS.length;
}

function buildIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of HOMOPHONE_GROUPS) {
    const key = `~${group[0]}`;
    for (const word of group) {
      index.set(word, key);
      // Recognisers are inconsistent about apostrophes, so "theyre" and "its"
      // reach us as often as "they're" and "it's". Index both spellings.
      const stripped = word.replace(/'/gu, "");
      if (stripped !== word) {
        index.set(stripped, key);
      }
    }
  }
  return index;
}
