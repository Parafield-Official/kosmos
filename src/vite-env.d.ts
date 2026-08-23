/// <reference types="vite/client" />

interface BoothDeskBridge {
  platform: string;
  desktop: true;
  newProject: () => Promise<ProjectEnvelope | null>;
  openProject: () => Promise<ProjectEnvelope | null>;
  reopenRecentProject: () => Promise<ProjectEnvelope | null>;
  saveProject: (payload: ProjectEnvelope) => Promise<ProjectEnvelope>;
  importText: (payload: ProjectEnvelope) => Promise<ManuscriptImportResult | null>;
  pasteText: (payload: ProjectEnvelope & { title: string; text: string }) => Promise<ProjectEnvelope>;
  renameChapter: (payload: ProjectEnvelope & { chapterId: string; title: string }) => Promise<ProjectEnvelope>;
  splitChapter: (payload: ProjectEnvelope & { chapterId: string; offset: number; secondTitle: string }) => Promise<ChapterEditResult>;
  mergeChapters: (payload: ProjectEnvelope & { firstChapterId: string; secondChapterId: string }) => Promise<ProjectEnvelope & { preservedSourcePath: string }>;
  setChapterSeat: (payload: ProjectEnvelope & { chapterId: string; seat: "narration" | "N1" | "N2" }) => Promise<ProjectEnvelope>;
  setProjectMode: (payload: ProjectEnvelope & { mode: "solo" | "duet" }) => Promise<ProjectEnvelope>;
  setChapterSpans: (payload: ProjectEnvelope & { chapterId: string; spans: import("./core/project/types").ScriptSpan[] }) => Promise<ProjectEnvelope>;
  loadExample: (payload: ProjectEnvelope) => Promise<ExampleEnvelope>;
  attachAudio: (payload: ProjectEnvelope & { chapterId: string }) => Promise<AudioAttachment | null>;
  attachDuetTrack: (payload: ProjectEnvelope & { chapterId: string; kind: "bed" | "overdub" }) => Promise<DuetTrackAttachment | null>;
  attachGlossaryClip: (payload: ProjectEnvelope & { glossaryId: string }) => Promise<GlossaryClipAttachment | null>;
  relinkGlossary: (payload: ProjectEnvelope) => Promise<ProjectEnvelope>;
  refreshGlossary: (payload: ProjectEnvelope) => Promise<ProjectEnvelope>;
  suggestGlossaryRespells: (payload: ProjectEnvelope) => Promise<RespellSuggestionResult>;
  exportVoiceGuide: (payload: ProjectEnvelope & { frequency?: "paragraph" | "all" }) => Promise<VoiceGuideResult>;
  readChapterText: (payload: ProjectEnvelope & { chapterId: string }) => Promise<ChapterText>;
  saveAlignment: (payload: ProjectEnvelope & { chapterId: string; pickups: import("./core/project/types").Pickup[]; transcript: import("./core/proof/align").TranscriptWord[] }) => Promise<ProjectEnvelope>;
  readAlignment: (payload: ProjectEnvelope & { chapterId: string }) => Promise<AlignmentFile | null>;
  exportMarkers: (payload: ProjectEnvelope & { chapterId: string; pickups: import("./core/project/types").Pickup[] }) => Promise<MarkerExportResult>;
  exportProofReport: (payload: ProjectEnvelope & { chapterId: string; transcript: import("./core/proof/align").TranscriptWord[]; pickups: import("./core/project/types").Pickup[] }) => Promise<ProofReportResult>;
  exportPickupPacket: (payload: ProjectEnvelope & { chapterId: string; transcript: import("./core/proof/align").TranscriptWord[]; pickups: import("./core/project/types").Pickup[] }) => Promise<PickupPacketResult>;
  saveRecordingWav: (payload: ProjectEnvelope & { kind: "chapter" | "punch" | "room" | "glossary" | "live"; chapterId?: string; glossaryId?: string; pickupId?: string; wavBase64: string }) => Promise<RecordingSaveResult>;
  applyPunchRecording: (payload: ProjectEnvelope & { chapterId: string; pickupId?: string; expected?: string; heard?: string; tStart: number; tEnd: number; wavBase64: string; trimSilence?: boolean }) => Promise<PunchSaveResult>;
  mixDuetChapter: (payload: ProjectEnvelope & { chapterId: string; narrationSeat: "N1" | "N2"; crossfadeMs?: number }) => Promise<DuetMixSaveResult>;
  audioUrl: (payload: { folder: string; relativePath: string }) => Promise<string>;
  decodeAudio: (payload: { folder: string; relativePath: string }) => Promise<DecodedAudio>;
  audioMetadata: (payload: { folder: string; relativePath: string }) => Promise<AudioMetadata>;
  measureAudio: (payload: { folder: string; relativePath: string; requireRoomTone?: boolean; presetId?: string; customPresets?: import("./core/acx/presets").SpecPreset[] }) => Promise<import("./core/acx/measure").AcxReport>;
  readBookProof: (payload: ProjectEnvelope) => Promise<BookProof>;
  resolveBookPickups: (payload: ProjectEnvelope & {
    requests: Array<{ chapterId: string; ids: string[] }>;
    status: import("./core/project/types").PickupStatus;
  }) => Promise<{ folder: string; project: import("./core/project/types").ProjectFile; changedChapters: number }>;
  transcribe: (payload: { folder: string; relativePath: string; language?: string }) => Promise<TranscriptionResult>;
  startLiveTranscription: (payload?: ProjectEnvelope & { chapterId?: string }) => Promise<{ persistent: boolean; acceleration: string; engine?: string; streaming?: boolean; backcheck?: string }>;
  stopLiveTranscription: () => Promise<{ stopped: boolean; live_audio_path?: string; folder?: string; project?: import("./core/project/types").ProjectFile; tapeError?: string }>;
  transcribeBuffer: (payload: { audioBase64?: string; pcmBase64?: string; mimeType?: string; language?: string; engine?: string }) => Promise<TranscriptionResult>;
  sendLivePcm: (payload: { pcmBase64: string }) => void;
  onLiveWords: (listener: (payload: { words: import("./core/proof/align").TranscriptWord[] }) => void) => () => void;
  modelStatus: () => Promise<ModelStatus>;
  downloadModel: () => Promise<ModelStatus>;
  onModelProgress: (listener: (progress: ModelProgress) => void) => () => void;
  exportDelivery: (payload: ProjectEnvelope) => Promise<DeliveryExportResult>;
  showDeliveryPack: (payload: ProjectEnvelope) => Promise<{ folder: string; shown: boolean }>;
  reviewPack: (payload: ProjectEnvelope) => Promise<PackReview | null>;
  applyPack: (payload: ProjectEnvelope & { stagingId: string }) => Promise<PackImportResult>;
  discardPack: (payload: { stagingId: string }) => Promise<{ discarded: boolean }>;
  shareZip: (payload: ProjectEnvelope & { lightPack: boolean }) => Promise<ShareZipResult | null>;
  shareSeatPack: (payload: ProjectEnvelope & { seat: "N1" | "N2" }) => Promise<ShareZipResult | null>;
  getIdentity: (projectId: string) => Promise<LocalIdentity | null>;
  setIdentity: (identity: LocalIdentity) => Promise<LocalIdentity>;
  collabIceServers: () => Promise<{ iceServers: RTCIceServer[]; turn: boolean }>;
  collabEncodeInvite: (payload: { project: import("./core/project/types").ProjectFile; sdp: string }) => Promise<CollabSnapshot>;
  collabDecodeInvite: (text: string) => Promise<{ projectId: string; projectName: string; secret: string; sdp?: string; words: string }>;
  collabEncodeReply: (payload: { sdp: string }) => Promise<string>;
  collabDecodeReply: (text: string) => Promise<{ secret: string; sdp: string }>;
  collabAttach: (payload: ProjectEnvelope & { identity: { name: string; role: "author" | "narrator" } }) => Promise<CollabSnapshot>;
  collabInbound: (text: string) => Promise<CollabSnapshot>;
  collabAnnounce: () => Promise<CollabSnapshot>;
  collabStart: () => Promise<CollabSnapshot>;
  collabStatus: () => Promise<CollabSnapshot>;
  collabDisconnect: () => Promise<CollabSnapshot>;
  onCollabOutbound: (listener: (text: string) => void) => () => void;
  appUpdateStatus: () => Promise<import("./app/app-update").AppUpdateStatus>;
  checkAppUpdate: () => Promise<import("./app/app-update").AppUpdateStatus | null>;
  installAppUpdate: () => Promise<{ installed: boolean }>;
  openKosmosRelease: () => Promise<void>;
  onAppUpdate: (listener: (status: import("./app/app-update").AppUpdateStatus) => void) => () => void;
}

interface ProjectEnvelope {
  folder: string;
  project: import("./core/project/types").ProjectFile;
}

interface AudioAttachment extends ProjectEnvelope {
  sourcePath: string;
  audioPath: string;
}

interface DuetTrackAttachment extends ProjectEnvelope {
  kind: "bed" | "overdub";
  sourcePath: string;
  audioPath: string;
}

interface GlossaryClipAttachment extends ProjectEnvelope {
  sourcePath: string;
  clipPath: string;
}

interface ManuscriptImportResult extends ProjectEnvelope {
  chapters: import("./core/project/types").ChapterFile[];
  sourcePath?: string;
  format?: "txt" | "md" | "docx" | "epub" | "pdf";
}

interface ChapterEditResult extends ProjectEnvelope {
  chapter: import("./core/project/types").ChapterFile;
}

interface ExampleEnvelope extends ProjectEnvelope {
  chapter: import("./core/project/types").ChapterFile;
  transcriptText: string;
}

interface ChapterText {
  chapterId: string;
  text: string;
  spans: import("./core/project/types").ScriptSpan[];
}

interface AlignmentFile {
  schema: 1;
  chapter_id: string;
  updated_at: string;
  transcript: import("./core/proof/align").TranscriptWord[];
  pickups: import("./core/project/types").Pickup[];
}

interface MarkerExportResult {
  folder: string;
  files: string[];
}

interface ProofReportResult {
  folder: string;
  files: string[];
}

interface RespellSuggestionResult extends ProjectEnvelope {
  /** Rows the dictionary could answer. */
  filled: number;
  /** Names no dictionary knows; these still need a person. */
  unknown: string[];
}

interface VoiceGuideResult {
  folder: string;
  files: string[];
}

interface RecordingSaveResult extends ProjectEnvelope {
  path: string;
  kind: "chapter" | "punch" | "room" | "glossary" | "live";
}

interface PunchSaveResult extends ProjectEnvelope {
  kind: "punch";
  path: string;
  editedPath: string;
}

interface DuetMixSaveResult extends ProjectEnvelope {
  mixPath: string;
  n1StemPath: string;
  n2StemPath: string;
  segments: number;
  timingSource: "alignment" | "proportional";
}

interface DecodedAudio {
  sampleRate: number;
  channels: number;
  format: import("./core/acx/measure").AudioFormat;
  durationSeconds: number;
  bitrateKbps?: number;
  vbr?: boolean;
  pcmBase64: string;
}

interface AudioMetadata {
  sampleRate: number;
  channels: number;
  format: import("./core/acx/measure").AudioFormat;
  durationSeconds: number;
  bitrateKbps?: number;
  vbr?: boolean;
}

interface PackReview {
  stagingId: string;
  packName: string;
  summary: string;
  incomingName: string;
  plan: import("./core/sharing/merge").MergePlan;
}

interface PackImportResult {
  folder: string;
  project: import("./core/project/types").ProjectFile;
  applied: {
    recordings: number;
    decisions: number;
    decidedChapters: number;
    notes: number;
    glossary: number;
    statuses: number;
    conflicts: number;
  };
}

interface PickupPacketResult {
  folder: string;
  files: string[];
  clipCount: number;
  pickupCount: number;
}

interface BookProofChapter {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  manuscript: string;
  transcript: import("./core/proof/align").TranscriptWord[];
  pickups: import("./core/project/types").Pickup[];
  hasAudio: boolean;
  checked: boolean;
}

interface BookProof {
  chapters: BookProofChapter[];
}

interface TranscriptionResult {
  engine: "whisper.cpp";
  modelPath: string;
  words: import("./core/proof/align").TranscriptWord[];
  /** Quiet stretches measured from the audio, when the file was on disk. */
  silences?: import("./core/proof/silence").SilenceRange[];
}

interface ModelStatus {
  id: "small.en";
  path: string;
  available: boolean;
  bytes: number;
  expectedSha1: string;
  bundled?: boolean;
}

interface ModelProgress {
  received: number;
  total: number;
  fraction: number;
}

interface DeliveryExportResult {
  folder: string;
  files: string[];
  /**
   * Each entry carries the measurement of the source take and of the encoded
   * delivered file, which lets Finish show the narrator what mastering
   * settled instead of only how many files were written.
   */
  entries: import("./core/acx/export").ReportEntry[];
  report: string;
  status: "ready" | "ready_with_warnings";
  warningCount: number;
  targetId: string;
  targetLabel: string;
  profileDescription: string;
  container: "mp3" | "wav";
  profile: import("./core/acx/presets").DeliveryProfile;
}

interface ShareZipResult {
  outputPath: string;
  fileCount: number;
  bytes: number;
}

interface LocalIdentity {
  projectId: string;
  personName: string;
  role: "author" | "narrator";
  seat?: "N1" | "N2";
}

interface CollabSnapshot {
  phase: string;
  invite: string | null;
  words: string | null;
  peer: { name: string; role: string } | null;
  lastReview: { plan: import("./core/sharing/merge").MergePlan; summary?: string } | null;
  error: string | null;
  project: import("./core/project/types").ProjectFile | null;
  folder: string | null;
  projectUpdated?: boolean;
}

interface Window {
  boothDesk?: BoothDeskBridge;
}
