export const PROJECT_SCHEMA = 1 as const;

export type ProjectMode = "solo" | "duet";
export type Seat = "narration" | "N1" | "N2";
export type AuthorStatus =
  | "draft"
  | "needs_pickup"
  | "approved"
  | "ignore_this_flag";
export type PickupKind = "skip" | "insert" | "sub" | "pause";
export type PickupStatus = "open" | "done" | "ignored";
export type ProofSensitivity = "conservative" | "default" | "aggressive";

export interface ProjectSettings {
  proof_sensitivity: ProofSensitivity;
  pause_threshold_seconds: number;
  acx_target_rms_dbfs: number;
  /** Which delivery target the meter judges against. */
  spec_preset_id: string;
  /** Drop word pickups the recogniser was less sure than this about. */
  proof_confidence_floor: number;
  /** Words to leave alone everywhere in this book. */
  suppressed_words: string[];
  teleprompter_theme: "dark" | "sepia" | "cream";
  teleprompter_font_size: number;
  /** How much of the script the voice-follow highlight covers as it advances. */
  teleprompter_highlight: "word" | "line" | "paragraph";
  /** Versioned first-run defaults; used to migrate older books once. */
  teleprompter_preset_version?: 2;
}

export interface ProjectPerson {
  name: string;
  role: "author" | "narrator";
  seat?: "N1" | "N2";
}

export interface SeatDefinition {
  label: string;
  color: string;
}

export interface ScriptSpan {
  text: string;
  seat: Seat;
  style: Array<"bold" | "italic" | "underline" | "highlight">;
  /** Deterministic quote heuristic; a user can still repaint the seat. */
  dialogue?: boolean;
  glossary_id?: string;
  /** A narrator-only preparation cue anchored to the words in this span. */
  performance_cue?: PerformanceCue;
}

export type PerformanceCueKind = "beat" | "breath" | "emphasis" | "character" | "intention";

export interface PerformanceCue {
  kind: PerformanceCueKind;
  label?: string;
}

export interface ChapterFile {
  id: string;
  index: number;
  title: string;
  text_path: string;
  audio_path?: string;
  raw_audio_path?: string;
  edited_audio_path?: string;
  /** Scratch tape from Start narrating. Not the chapter take. */
  live_audio_path?: string;
  bed_audio_path?: string;
  overdub_audio_path?: string;
  duet_mix_path?: string;
  n1_stem_path?: string;
  n2_stem_path?: string;
  pickups_path?: string;
  open_pickups?: number;
  acx_traffic_light?: "green" | "yellow" | "red";
  notes_path?: string;
  word_count?: number;
  estimated_duration_minutes?: number;
  duration_warning?: string;
  author_status: AuthorStatus;
  updated_at?: string;
}

export interface GlossaryEntry {
  id: string;
  spelling: string;
  respell?: string;
  /** How this name should sound in the read: accent, age, attitude. */
  voice_note?: string;
  clip_path?: string;
  seats?: Seat[];
  frequency: number;
  source: "auto" | "user";
}

export interface ChapterNote {
  id: string;
  chapter_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface PunchRecording {
  id: string;
  chapter_id: string;
  pickup_id?: string;
  path: string;
  edited_path?: string;
  t_start?: number;
  t_end?: number;
  expected?: string;
  heard?: string;
  /** Whether silence was trimmed from this clip before replaying the edit manifest. */
  trim_silence?: boolean;
  /** Applied edits remain explicit until the narrator has listened and verified the result. */
  verification_status?: "needs_verification" | "verified";
  /** Reverted entries retain their clip/history but are excluded from the working edit. */
  edit_status?: "applied" | "reverted";
  created_at: string;
}

export interface ProjectFile {
  schema: typeof PROJECT_SCHEMA;
  id: string;
  name: string;
  mode: ProjectMode;
  acx_spec_version: string;
  author: string;
  narrator_n1: string;
  narrator_n2: string;
  people: ProjectPerson[];
  seats: Record<Seat, SeatDefinition>;
  chapters: ChapterFile[];
  glossary?: GlossaryEntry[];
  chapter_notes?: ChapterNote[];
  punch_recordings?: PunchRecording[];
  room_test_path?: string;
  settings?: ProjectSettings;
  created_at: string;
  updated_at: string;
}

export interface Pickup {
  id: string;
  chapter_id: string;
  t_start: number;
  t_end: number;
  expected: string;
  heard: string;
  kind: PickupKind;
  seat: Seat;
  status: PickupStatus;
  confidence: number;
  note?: string;
  /** A narrator can voluntarily redo delivery even when proofing found no error. */
  intent?: "proof" | "performance";
  /** The manuscript scope the narrator deliberately selected. */
  selection_kind?: "selection" | "sentence" | "paragraph";
  /** Which reviewed recording supplied this selection's timestamps. */
  source_kind?: "take" | "live";
  /** Canonical manuscript word index captured while narrating in Kosmos. */
  manuscript_index?: number;
  /**
   * The sentence the flagged word sits in. `t_start`/`t_end` stay the word, for
   * marking the page and for exports that point at the exact slip; a narrator
   * listening back or re-recording works on the line, because a word spliced
   * out of its sentence carries the wrong pace and breath and will not blend.
   * Absent on pickups filed before the line was recorded.
   */
  line_start?: number;
  line_end?: number;
  line_text?: string;
}
