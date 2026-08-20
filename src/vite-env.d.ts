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
  readChapterText: (payload: ProjectEnvelope & { chapterId: string }) => Promise<ChapterText>;
  saveAlignment: (payload: ProjectEnvelope & { chapterId: string; pickups: import("./core/project/types").Pickup[]; transcript: import("./core/proof/align").TranscriptWord[] }) => Promise<ProjectEnvelope>;
  readAlignment: (payload: ProjectEnvelope & { chapterId: string }) => Promise<AlignmentFile | null>;
  exportMarkers: (payload: ProjectEnvelope & { chapterId: string; pickups: import("./core/project/types").Pickup[] }) => Promise<MarkerExportResult>;
  exportProofReport: (payload: ProjectEnvelope & { chapterId: string; transcript: import("./core/proof/align").TranscriptWord[]; pickups: import("./core/project/types").Pickup[] }) => Promise<ProofReportResult>;
  saveRecordingWav: (payload: ProjectEnvelope & { kind: "chapter" | "punch" | "room" | "glossary"; chapterId?: string; glossaryId?: string; pickupId?: string; wavBase64: string }) => Promise<RecordingSaveResult>;
  applyPunchRecording: (payload: ProjectEnvelope & { chapterId: string; pickupId?: string; expected?: string; heard?: string; tStart: number; tEnd: number; wavBase64: string; trimSilence?: boolean }) => Promise<PunchSaveResult>;
  mixDuetChapter: (payload: ProjectEnvelope & { chapterId: string; narrationSeat: "N1" | "N2"; crossfadeMs?: number }) => Promise<DuetMixSaveResult>;
  audioUrl: (payload: { folder: string; relativePath: string }) => Promise<string>;
  decodeAudio: (payload: { folder: string; relativePath: string }) => Promise<DecodedAudio>;
  audioMetadata: (payload: { folder: string; relativePath: string }) => Promise<AudioMetadata>;
  measureAudio: (payload: { folder: string; relativePath: string; requireRoomTone?: boolean }) => Promise<import("./core/acx/measure").AcxReport>;
  transcribe: (payload: { folder: string; relativePath: string; language?: string }) => Promise<TranscriptionResult>;
  startLiveTranscription: () => Promise<{ persistent: boolean; acceleration: string; engine?: string; streaming?: boolean; backcheck?: string }>;
  stopLiveTranscription: () => Promise<{ stopped: boolean }>;
  transcribeBuffer: (payload: { audioBase64?: string; pcmBase64?: string; mimeType?: string; language?: string; engine?: string }) => Promise<TranscriptionResult>;
  modelStatus: () => Promise<ModelStatus>;
  downloadModel: () => Promise<ModelStatus>;
  onModelProgress: (listener: (progress: ModelProgress) => void) => () => void;
  exportAcx: (payload: ProjectEnvelope) => Promise<AcxExportResult>;
  shareZip: (payload: ProjectEnvelope & { lightPack: boolean }) => Promise<ShareZipResult | null>;
  shareSeatPack: (payload: ProjectEnvelope & { seat: "N1" | "N2" }) => Promise<ShareZipResult | null>;
  getIdentity: (projectId: string) => Promise<LocalIdentity | null>;
  setIdentity: (identity: LocalIdentity) => Promise<LocalIdentity>;
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

interface RecordingSaveResult extends ProjectEnvelope {
  path: string;
  kind: "chapter" | "punch" | "room" | "glossary";
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

interface TranscriptionResult {
  engine: "whisper.cpp";
  modelPath: string;
  words: import("./core/proof/align").TranscriptWord[];
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

interface AcxExportResult {
  folder: string;
  files: string[];
  entries: Array<{ fileName: string; status: string; note?: string }>;
  report: string;
  status: "ready" | "ready_with_warnings";
  warningCount: number;
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

interface Window {
  boothDesk?: BoothDeskBridge;
}
