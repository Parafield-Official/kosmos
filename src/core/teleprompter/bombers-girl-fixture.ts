/**
 * The Bombers + Girl passage and the narrator slips graded against it.
 *
 * Shared so the unit test and the live desktop run judge the same narration:
 * the test feeds these slips straight to `liveBackFlag`, while the live run
 * speaks this passage aloud into the running app. If the two drifted apart, a
 * passing test would say nothing about the booth.
 */

export const BOMBERS_GIRL = [
  "Bombers",
  "They cross the Channel at midnight. There are twelve and they are Thanes the Channel at midnigh. There are twe and they are named for songs: Stardust and Stormy Weather and In the Mood and Pistol-Packin' Mama.",
  "The sea glides along far below, spattered with the countless chevrons of whitecaps.",
  "Soon enough, the navigators can discern the low moonlit lumps of islands ranged along the horizon. France.",
  "Intercoms crackle. Deliberately, almost lazily, the bombers shed altitude.",
  "Threads of red light ascend from anti-air emplacements up and down the coast.",
  "Dark, ruined ships appear, scuttled or destroyed, one with its bow shorn away, a second flickering as it burns.",
  "On an outermost island, panicked sheep run zigzagging between rocks.",
  "Inside each airplane, a bombardier peers through an aiming window and counts to twenty.",
  "In a corner of the city, inside a tall, narrow house at Number 4 rue Vauborel, on the sixth and highest floor, a sightless sixteen-year-old named Marie-Laure LeBlanc kneels over a low table covered entirely with a model.",
  "The model is a miniature of the city she kneels within, and contains scale replicas of the hundreds of houses and shops and hotels within its walls.",
  "A slender wooden jetty arcs our from a beach called the Plage du Môle.",
  "She whispers, and her fingers walk down a lite staircase.",
  "In a corner of the room stand two galvanized buckets filled to the rim with water.",
].join(" ");

export interface BombersGirlSlip {
  name: string;
  /** Manuscript words locating the slip, matched case-insensitively. */
  phrase: string;
  /** Word offset inside `phrase` that the narrator says wrong. */
  offset: number;
  /** What the narrator says instead. */
  heard: string;
}

export const BOMBERS_GIRL_SLIPS: readonly BombersGirlSlip[] = [
  { name: "prep at→in", phrase: "Channel at midnight", offset: 1, heard: "in" },
  { name: "number twelve→twenty", phrase: "are twelve and", offset: 1, heard: "twenty" },
  { name: "determiner the→a", phrase: "The sea glides", offset: 0, heard: "A" },
  { name: "dropped s glides", phrase: "sea glides along", offset: 1, heard: "glide" },
  { name: "dropped s chevrons", phrase: "countless chevrons of", offset: 1, heard: "chevron" },
  { name: "dropped s islands", phrase: "of islands ranged", offset: 1, heard: "island" },
  { name: "content France→Spain", phrase: "horizon France", offset: 1, heard: "Spain" },
  { name: "dropped s bombers", phrase: "the bombers shed", offset: 1, heard: "bomber" },
  { name: "dropped s Threads", phrase: "Threads of red", offset: 0, heard: "Thread" },
  { name: "dropped s ships", phrase: "ruined ships appear", offset: 1, heard: "ship" },
  { name: "dropped s rocks", phrase: "between rocks", offset: 1, heard: "rock" },
  { name: "number twenty→twelve", phrase: "to twenty", offset: 1, heard: "twelve" },
  { name: "ordinal sixth→fifth", phrase: "the sixth and", offset: 1, heard: "fifth" },
  { name: "dropped s kneels", phrase: "LeBlanc kneels over", offset: 1, heard: "kneel" },
  { name: "dropped s buckets", phrase: "galvanized buckets filled", offset: 1, heard: "bucket" },
] as const;
