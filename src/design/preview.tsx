/**
 * A design workbench for the panels a narrator and an author actually work in.
 *
 * Reviewing UI by reading JSX is guesswork. This page renders the real panels
 * with realistic content — a book mid-proof, a name read two ways, a pack that
 * disagrees with us — so the layout, the wording and the spacing can be looked
 * at, screenshotted and argued about.
 *
 * Dev only: `npm run design` serves it, `npm run design:shots` photographs it.
 * It is not part of the production entry, so nothing here ships.
 */

import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  AcxMeter,
  BookPickupPanel,
  BookWordScanner,
  CollaborationPanel,
  GlossaryPanel,
  PickupList,
  SettingsPanel,
} from "../app/App";
import { DEFAULT_PROJECT_SETTINGS } from "../core/project/settings";
import type { GlossaryEntry, Pickup, ProjectFile } from "../core/project/types";
import "../styles.css";

const noop = (): void => undefined;

function pickup(overrides: Partial<Pickup> & { id: string }): Pickup {
  return {
    chapter_id: "ch01",
    t_start: 12.4,
    t_end: 13.1,
    expected: "light",
    heard: "night",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.86,
    ...overrides,
  };
}

const PICKUPS: Pickup[] = [
  pickup({ id: "p1", t_start: 42.2, t_end: 42.9 }),
  pickup({ id: "p2", t_start: 96.8, t_end: 97.2, expected: "heavy", heard: "", kind: "skip" }),
  pickup({ id: "p3", t_start: 184.1, t_end: 184.6, expected: "", heard: "front", kind: "insert" }),
  pickup({ id: "p4", t_start: 241.5, t_end: 247.0, expected: "Pause > 4s", heard: "", kind: "pause" }),
  pickup({
    id: "p5",
    t_start: 302.9,
    t_end: 303.4,
    expected: "Leominster",
    heard: "lemster",
    note: "Author says LEM-ster is right.",
    status: "ignored",
  }),
  pickup({ id: "p6", t_start: 388.0, t_end: 388.6, expected: "tide", heard: "wind", status: "done" }),
];

const BOOK_SUMMARY = {
  chapters: [
    { chapterId: "ch01", chapterIndex: 1, chapterTitle: "The Road", hasAudio: true, checked: true, open: 3, resolved: 4, total: 7 },
    { chapterId: "ch02", chapterIndex: 2, chapterTitle: "The Bridge", hasAudio: true, checked: true, open: 1, resolved: 2, total: 3 },
    { chapterId: "ch03", chapterIndex: 3, chapterTitle: "The Letter", hasAudio: true, checked: false, open: 0, resolved: 0, total: 0 },
    { chapterId: "ch04", chapterIndex: 4, chapterTitle: "The Harbour", hasAudio: false, checked: false, open: 0, resolved: 0, total: 0 },
  ],
  open: [
    { chapterId: "ch01", chapterIndex: 1, chapterTitle: "The Road", pickup: pickup({ id: "b1", t_start: 42.2 }) },
    {
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "The Road",
      pickup: pickup({ id: "b2", t_start: 96.8, expected: "heavy", heard: "", kind: "skip" }),
    },
    {
      chapterId: "ch01",
      chapterIndex: 1,
      chapterTitle: "The Road",
      pickup: pickup({ id: "b3", t_start: 241.5, t_end: 247, expected: "Pause > 4s", heard: "", kind: "pause" }),
    },
    {
      chapterId: "ch02",
      chapterIndex: 2,
      chapterTitle: "The Bridge",
      pickup: pickup({ id: "b4", chapter_id: "ch02", t_start: 58.4, expected: "Leominster", heard: "lea minster" }),
    },
  ],
  openCount: 4,
  resolvedCount: 6,
  byKind: { sub: 2, skip: 1, insert: 0, pause: 1 },
  repeated: [
    {
      word: "Leominster",
      count: 3,
      chapters: 2,
      rows: [
        {
          chapterId: "ch02",
          chapterIndex: 2,
          chapterTitle: "The Bridge",
          pickup: pickup({ id: "b4", chapter_id: "ch02", t_start: 58.4, expected: "Leominster", heard: "lea minster" }),
        },
      ],
    },
  ],
  uncheckedChapters: [
    { chapterId: "ch03", chapterIndex: 3, chapterTitle: "The Letter", hasAudio: true, checked: false, open: 0, resolved: 0, total: 0 },
  ],
};

const SCAN_REPORT = {
  word: "Leominster",
  totalOccurrences: 4,
  checkedOccurrences: 3,
  readings: [
    {
      heard: "Lemster",
      count: 2,
      occurrences: [
        {
          chapterId: "ch01",
          chapterTitle: "The Road",
          chapterIndex: 1,
          offset: 4,
          context: "The Leominster road was flooded, and the bridge had gone.",
          heard: "Lemster",
          start: 1.9,
          end: 2.6,
          readingKey: "lemster",
        },
        {
          chapterId: "ch01",
          chapterTitle: "The Road",
          chapterIndex: 1,
          offset: 42,
          context: "…and the Leominster bridge had gone by morning.",
          heard: "Lemster",
          start: 5.2,
          end: 5.9,
          readingKey: "lemster",
        },
      ],
    },
    {
      heard: "Lea Minster",
      count: 1,
      occurrences: [
        {
          chapterId: "ch02",
          chapterTitle: "The Bridge",
          chapterIndex: 2,
          offset: 15,
          context: "By morning the Leominster road was open again.",
          heard: "Lea Minster",
          start: 2.1,
          end: 3.0,
          readingKey: "lea minster",
        },
      ],
    },
    {
      heard: "(not checked yet)",
      count: 1,
      occurrences: [
        {
          chapterId: "ch04",
          chapterTitle: "The Harbour",
          chapterIndex: 4,
          offset: 4,
          context: "The Leominster train left the harbour at six.",
          heard: "",
          readingKey: "#no-audio",
        },
      ],
    },
  ],
  chaptersWithoutAudio: ["The Harbour"],
  consistent: false,
};

const GLOSSARY: GlossaryEntry[] = [
  { id: "g1", spelling: "Leominster", respell: "LEM-ster", voice_note: "Local: clipped, flat a", frequency: 12, source: "user" },
  { id: "g2", spelling: "Siobhan", respell: "shi-VAWN", frequency: 7, source: "user" },
  { id: "g3", spelling: "Kael", respell: "", frequency: 41, source: "auto" },
  { id: "g4", spelling: "Bistritz", respell: "", frequency: 5, source: "auto" },
  { id: "g5", spelling: "Worcester", respell: "WUU-ster", voice_note: "Older, dry", frequency: 3, source: "auto", clip_path: "glossary/worcester.wav" },
];

const PROJECT: ProjectFile = {
  schema: 1,
  id: "book-preview",
  name: "The Long Pier",
  mode: "solo",
  acx_spec_version: "2026-acx",
  author: "Alex Author",
  narrator_n1: "Nina Narrator",
  narrator_n2: "",
  people: [
    { name: "Alex Author", role: "author" },
    { name: "Nina Narrator", role: "narrator", seat: "N1" },
  ],
  seats: {
    narration: { label: "Narration", color: "#8a6f4d" },
    N1: { label: "N1", color: "#5c7f6a" },
    N2: { label: "N2", color: "#7a5c7f" },
  },
  chapters: [
    { id: "ch01", index: 1, title: "The Road", text_path: "text/ch01.json", audio_path: "audio/01.wav", author_status: "needs_pickup" },
    { id: "ch02", index: 2, title: "The Bridge", text_path: "text/ch02.json", audio_path: "audio/02.wav", author_status: "draft" },
    { id: "ch03", index: 3, title: "The Letter", text_path: "text/ch03.json", author_status: "draft" },
  ],
  glossary: GLOSSARY,
  chapter_notes: [
    { id: "n1", chapter_id: "ch01", author: "Alex Author", body: "That's Leominster, LEM-ster.", created_at: "2026-03-01T00:00:00.000Z" },
  ],
  punch_recordings: [],
  settings: { ...DEFAULT_PROJECT_SETTINGS, suppressed_words: ["Leominster", "Siobhan"] },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
};

const PACK_REVIEW = {
  stagingId: "staging-1",
  packName: "The Long Pier-collaborator.zip",
  summary: "2 recordings, 1 note, 1 pronunciation, 3 flag decisions, 2 disagreements to settle.",
  incomingName: "The Long Pier",
  plan: {
    notesToAdd: [
      { id: "n2", chapter_id: "ch01", author: "Nina Narrator", body: "Second take on the name.", created_at: "2026-03-02T00:00:00.000Z" },
    ],
    glossaryToAdd: [],
    glossaryRespells: [{ id: "g3", spelling: "Kael", respell: "KAYL" }],
    glossaryVoiceNotes: [{ id: "g3", spelling: "Kael", voiceNote: "Young, hoarse" }],
    decisions: [
      { chapterId: "ch01", pickupId: "p1", status: "done" as const },
      { chapterId: "ch01", pickupId: "p2", status: "done" as const },
      { chapterId: "ch02", pickupId: "p3", status: "ignored" as const },
    ],
    statusChanges: [{ chapterId: "ch01", chapterTitle: "The Road", from: "draft" as const, to: "needs_pickup" as const }],
    audioToAdopt: [
      { chapterId: "ch01", chapterTitle: "The Road", relativePath: "audio/01.wav", withAlignment: true },
      { chapterId: "ch02", chapterTitle: "The Bridge", relativePath: "audio/02.wav", withAlignment: false },
    ],
    conflicts: [
      {
        kind: "pickup" as const,
        chapterId: "ch01",
        chapterTitle: "The Road",
        pickupId: "p5",
        expected: "Leominster",
        mine: "ignored" as const,
        theirs: "done" as const,
      },
      { kind: "script" as const, chapterId: "ch02", chapterTitle: "The Bridge" },
    ],
    skipped: { unknownChapters: ["The Tide"], unknownPickups: 2, orphanNotes: 1 },
    empty: false,
  },
};

const ACX_REPORT = {
  preset_id: "acx",
  preset_label: "ACX",
  preset_source: "acx.com/audio-submission-requirements",
  rms_dbfs: -20.3,
  lufs_integrated: -19.1,
  true_peak_dbfs: -8.2,
  sample_peak_dbfs: -8.4,
  noise_floor_dbfs: -72.4,
  noise_floor_start_seconds: 0.35,
  noise_floor_duration_seconds: 0.9,
  sample_rate: 44100,
  channels: 1,
  duration_seconds: 1663,
  format: "mp3" as const,
  bitrate_kbps: 192,
  vbr: false,
  head_room_tone_s: 1.05,
  tail_room_tone_s: 1.32,
  head_room_tone_is_digital_silence: false,
  tail_room_tone_is_digital_silence: false,
  checks: {
    rms: "pass" as const,
    loudness: "unspecified" as const,
    true_peak: "pass" as const,
    noise_floor: "pass" as const,
    sample_rate: "pass" as const,
    channels: "pass" as const,
    duration: "pass" as const,
    format: "pass" as const,
    head_room_tone: "pass" as const,
    tail_room_tone: "pass" as const,
  },
  traffic_light: "green" as const,
};

const PANELS: Array<{ id: string; title: string; node: ReactElement }> = [
  {
    id: "book-pickups",
    title: "Whole-book pickup list",
    node: (
      <BookPickupPanel
        summary={BOOK_SUMMARY}
        busyAction={null}
        selectedChapterId="ch01"
        canRead
        onLoad={noop}
        onOpen={noop}
        onIgnoreAll={noop}
      />
    ),
  },
  {
    id: "book-pickups-empty",
    title: "Whole-book pickup list, before loading",
    node: (
      <BookPickupPanel
        summary={null}
        busyAction={null}
        selectedChapterId="ch01"
        canRead
        onLoad={noop}
        onOpen={noop}
        onIgnoreAll={noop}
      />
    ),
  },
  {
    id: "word-scan",
    title: "Scan the book for one name",
    node: (
      <BookWordScanner
        word="Leominster"
        report={SCAN_REPORT}
        guide={GLOSSARY[0]}
        suggestions={["Kael", "Leominster", "Siobhan"]}
        busyAction={null}
        onWord={noop}
        onScan={noop}
        onOpenOccurrence={noop}
        onAddToGuide={noop}
        onPickSuggestion={noop}
      />
    ),
  },
  {
    id: "word-scan-empty",
    title: "Scan the book, nothing typed yet",
    node: (
      <BookWordScanner
        word=""
        report={null}
        guide={null}
        suggestions={["Kael", "Leominster", "Siobhan"]}
        busyAction={null}
        onWord={noop}
        onScan={noop}
        onOpenOccurrence={noop}
        onAddToGuide={noop}
        onPickSuggestion={noop}
      />
    ),
  },
  {
    id: "pickups",
    title: "Chapter pickup list",
    node: (
      <PickupList
        pickups={PICKUPS}
        busyAction={null}
        onPlay={noop}
        onExportMarkers={noop}
        onExportReport={noop}
        onExportPacket={noop}
        onPunch={noop}
        onUpdate={noop}
        onSuppress={noop}
        seatFilter="all"
        onSeatFilter={noop}
      />
    ),
  },
  {
    id: "glossary",
    title: "Pronunciation guide",
    node: (
      <GlossaryPanel
        glossary={GLOSSARY}
        spelling=""
        respell=""
        busyAction={null}
        onSpelling={noop}
        onRespell={noop}
        onAdd={noop}
        onRefresh={noop}
        onSuggestRespells={noop}
        onExportGuide={noop}
        onRename={noop}
        onDelete={noop}
        onAttachClip={noop}
        onPlayClip={noop}
        onRecordClip={noop}
      />
    ),
  },
  {
    id: "acx",
    title: "Delivery check",
    node: <AcxMeter report={ACX_REPORT} presetId="acx" onPresetChange={noop} onPlayNoiseFloor={noop} />,
  },
  {
    id: "acx-trouble",
    title: "Delivery check with problems",
    node: (
      <AcxMeter
        report={{
          ...ACX_REPORT,
          rms_dbfs: -26.4,
          noise_floor_dbfs: -54.1,
          tail_room_tone_s: 0.21,
          checks: { ...ACX_REPORT.checks, rms: "fail", noise_floor: "fail", tail_room_tone: "warn" },
          traffic_light: "red",
        }}
        presetId="acx"
        onPresetChange={noop}
        onPlayNoiseFloor={noop}
      />
    ),
  },
  {
    id: "collaboration",
    title: "Author and narrator",
    node: (
      <CollaborationPanel
        project={PROJECT}
        identity={{ projectId: "book-preview", personName: "Alex Author", role: "author" }}
        identityLoaded
        identityName="Alex Author"
        identityRole="author"
        identitySeat="N1"
        chapterNote=""
        selectedChapterId="ch01"
        busyAction={null}
        onIdentityName={noop}
        onIdentityRole={noop}
        onIdentitySeat={noop}
        onChapterNote={noop}
        onSaveIdentity={noop}
        collabPhase="connected"
        collabInvite={null}
        collabWords="amber violin cedar"
        collabReply={null}
        collabPaste=""
        collabPeer={{ name: "Sam Narrator", role: "narrator" }}
        collabConflicts={PACK_REVIEW.plan.conflicts}
        onCollabPaste={noop}
        onCreateInvite={noop}
        onJoinInvite={noop}
        onAcceptReply={noop}
        onHangUp={noop}
        onSaveNote={noop}
        onStatus={noop}
        onSelectChapter={noop}
        onMode={noop}
      />
    ),
  },
  {
    id: "settings",
    title: "Book preferences",
    node: <SettingsPanel settings={PROJECT.settings!} busyAction={null} onChange={noop} />,
  },
];

function Workbench() {
  const wanted = new URLSearchParams(window.location.search).get("panel");
  // Menus only show their real shape when open, so the shot script can ask for
  // them open: `&open` for every one, `&open=first` for a single row menu.
  const open = new URLSearchParams(window.location.search).get("open");
  if (open !== null) {
    requestAnimationFrame(() => {
      const menus = document.querySelectorAll("details");
      const wanted = open === "first" ? [...menus].slice(-1) : [...menus];
      for (const element of wanted) {
        element.setAttribute("open", "");
      }
    });
  }
  const panels = wanted ? PANELS.filter((panel) => panel.id === wanted) : PANELS;
  return (
    <div className="studio-shell" style={{ display: "block", padding: "32px", maxWidth: 1180, margin: "0 auto" }}>
      {panels.map((panel) => (
        <div key={panel.id} style={{ marginBottom: 48 }} data-panel={panel.id}>
          {wanted ? null : (
            <p className="eyebrow" style={{ marginBottom: 12 }}>{panel.title}</p>
          )}
          {panel.node}
        </div>
      ))}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Design workbench root is missing");
}
createRoot(root).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);
