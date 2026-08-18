/// <reference types="vite/client" />

interface BoothDeskBridge {
  platform: string;
  desktop: true;
  newProject: () => Promise<ProjectEnvelope | null>;
  openProject: () => Promise<ProjectEnvelope | null>;
  reopenRecentProject: () => Promise<ProjectEnvelope | null>;
  saveProject: (payload: ProjectEnvelope) => Promise<ProjectEnvelope>;
  importText: (payload: ProjectEnvelope) => Promise<ProjectEnvelope | null>;
  pasteText: (payload: ProjectEnvelope & { title: string; text: string }) => Promise<ProjectEnvelope>;
  loadExample: (payload: ProjectEnvelope) => Promise<ExampleEnvelope>;
  attachAudio: (payload: ProjectEnvelope & { chapterId: string }) => Promise<AudioAttachment | null>;
  readChapterText: (payload: ProjectEnvelope & { chapterId: string }) => Promise<ChapterText>;
  readAudio: (payload: { folder: string; relativePath: string }) => Promise<{ mime: string; base64: string }>;
  decodeAudio: (payload: { folder: string; relativePath: string }) => Promise<DecodedAudio>;
  transcribe: (payload: { folder: string; relativePath: string; language?: string }) => Promise<TranscriptionResult>;
  modelStatus: () => Promise<ModelStatus>;
  downloadModel: () => Promise<ModelStatus>;
  onModelProgress: (listener: (progress: ModelProgress) => void) => () => void;
}

interface ProjectEnvelope {
  folder: string;
  project: import("./core/project/types").ProjectFile;
}

interface AudioAttachment extends ProjectEnvelope {
  sourcePath: string;
  audioPath: string;
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

interface DecodedAudio {
  sampleRate: number;
  channels: number;
  format: import("./core/acx/measure").AudioFormat;
  durationSeconds: number;
  pcmBase64: string;
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
}

interface ModelProgress {
  received: number;
  total: number;
  fraction: number;
}

interface Window {
  boothDesk?: BoothDeskBridge;
}
