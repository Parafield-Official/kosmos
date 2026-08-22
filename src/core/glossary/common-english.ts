/**
 * Bundled closed classes for deterministic glossary suggestions.
 *
 * This is language structure, not a book-specific leak list: function words,
 * titles, months, and weekdays. Do not grow it with discourse fillers
 * ("actually", "probably") — those are dropped by quote-starts and
 * capitalization ratio. The user can always add a word manually.
 */
export const COMMON_ENGLISH_WORDS = new Set(
  `
  a about above after again against all almost along already also although always am an and any are around as at away back be became because become been before began begin behind being below between both but by can chapter could credits dawn day did do does doing down during each early either else enough even ever every few first for found from further get got had half has have he her here hers herself him himself his home how i if in into is it its itself
  january february march april may june july august september october november december
  monday tuesday wednesday thursday friday saturday sunday
  just keep kind know last later least less let like little long look made make many may me might more most much must my myself near need never new next no nor not now of off often on once one only or other our ours ourselves out over own paragraph people perhaps place please prologue quite rather really right said same saw say see seem seemed several shall she should since so some something sometimes still such than that the their theirs them themselves then there therefore these they thing this those though through to too toward two under until up upon us use very was way we well were what when where whether which while who whom whose why will with within without would written you your yours yourself yourselves
  `.split(/\s+/).filter(Boolean).map((word) => word.toLowerCase()),
);
