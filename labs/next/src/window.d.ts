export {};

/** Update status broadcast from the main process (mirrors electron/app-update.cjs). */
export interface AppUpdateStatus {
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error";
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
  skipped?: boolean;
  text?: string;
  showBanner?: boolean;
  canInstall?: boolean;
  releasePage?: string;
}

/** Shape of the project.json marker written into each book folder. */
export interface StoredProjectFile {
  app?: string;
  schema?: number;
  id: string;
  title: string;
  author: string;
  coverDataUrl?: string;
  chapters: unknown[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  folder?: string;
  external?: boolean;
}

export interface ChapterPunchDto {
  id: string;
  chapter_id: string;
  pickup_id?: string;
  path: string;
  t_start: number;
  t_end: number;
  trim_silence?: boolean;
  edit_status?: string;
  expected?: string;
  heard?: string;
  created_at?: string;
  duration_delta?: number;
}

type LabsPlace = "mark" | "intro" | "brand" | "welcome" | "access" | "community" | "theme" | "app";

declare global {
  interface Window {
    kosmosNext?: {
      platform?: NodeJS.Platform;
      ready: (payload: { width: number; height: number; place: LabsPlace }) => void;
      resize: (size: { width: number; height: number }) => Promise<void>;
      setPlace?: (place: LabsPlace) => Promise<void>;
      setMaterial?: (material: {
        vibrancy?: string;
        visualEffectState?: string;
        blur?: number;
        look?: "frosted" | "transparent";
        clear?: boolean;
      }) => Promise<void>;
      pushTuning?: (values: Record<string, string>) => void;
      onTuningApply?: (callback: (values: Record<string, string>) => void) => (() => void) | void;
      jump?: (place: LabsPlace) => Promise<{ ok: boolean }>;
      reportPlace?: (place: LabsPlace) => void;
      onJump?: (callback: (place: LabsPlace) => void) => (() => void) | void;
      onPlace?: (callback: (place: LabsPlace) => void) => (() => void) | void;
      getWindowChrome?: () => Promise<{
        platform: NodeJS.Platform;
        fullscreen: boolean;
        maximized: boolean;
        expanded: boolean;
        showTrafficChrome: boolean;
      }>;
      onWindowChrome?: (callback: (state: {
        platform: NodeJS.Platform;
        fullscreen: boolean;
        maximized: boolean;
        expanded: boolean;
        showTrafficChrome: boolean;
      }) => void) => (() => void) | void;
      requestMicrophoneAccess?: () => Promise<{ granted: boolean; status?: string }>;
      getMicrophoneAccess?: () => Promise<{ granted: boolean; status?: string }>;
      requestFolderAccess?: () => Promise<{ granted: boolean; path?: string }>;
      getFolderAccess?: () => Promise<{ granted: boolean; path?: string }>;
      getSpeechModelAccess?: () => Promise<{ granted: boolean; bytes?: number; bundled?: boolean }>;
      downloadSpeechModel?: () => Promise<{ granted: boolean; bytes?: number }>;
      onSpeechModelProgress?: (callback: (progress: { received: number; total: number; fraction: number }) => void) => (() => void) | void;
      resetAccess?: () => Promise<{
        mic: { granted: boolean; status?: string };
        folder: { granted: boolean; path?: string };
        speechModel: { granted: boolean; bytes?: number; bundled?: boolean };
      }>;
      onAccessReset?: (callback: (snapshot: {
        mic: { granted: boolean; status?: string };
        folder: { granted: boolean; path?: string };
        speechModel: { granted: boolean; bytes?: number; bundled?: boolean };
      }) => void) => (() => void) | void;
      openMicrophoneSettings?: () => Promise<{ ok: boolean }>;
      getAppInfo?: () => Promise<{ version: string; update: AppUpdateStatus }>;
      checkForUpdates?: () => Promise<AppUpdateStatus>;
      installAppUpdate?: () => Promise<{ installed: boolean }>;
      openReleasePage?: () => Promise<unknown>;
      onAppUpdate?: (callback: (status: AppUpdateStatus) => void) => () => void;
      openDiscord?: (payload: { appUrl: string; webUrl: string }) => Promise<{ ok: boolean; via?: "app" | "web" }>;
      getWorkspace?: () => Promise<{ workspace: string | null }>;
      listProjects?: () => Promise<{ workspace: string | null; projects: StoredProjectFile[] }>;
      createProject?: (input: {
        title: string;
        author: string;
        coverDataUrl?: string;
        parentFolder?: string;
      }) => Promise<StoredProjectFile>;
      pickProjectParent?: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
      saveProjectFile?: (project: StoredProjectFile) => Promise<StoredProjectFile>;
      openProjectFolder?: () => Promise<{ ok: boolean; canceled?: boolean; invalid?: boolean; folder?: string; project?: StoredProjectFile; external?: boolean }>;
      deleteProjectFolder?: (folder: string) => Promise<{ ok: boolean }>;
      importManuscript?: (folder: string) => Promise<{ ok: boolean; canceled?: boolean; manuscript?: string }>;
      moveProjectIntoWorkspace?: (folder: string) => Promise<{ ok: boolean; invalid?: boolean; project?: StoredProjectFile }>;
      linkExternalProject?: (folder: string) => Promise<{ ok: boolean; invalid?: boolean; project?: StoredProjectFile }>;
      writeManuscript?: (payload: { folder: string; name: string; base64: string }) => Promise<{ ok: boolean; manuscript?: string }>;
      readManuscript?: (payload: { folder: string; name?: string }) => Promise<{ ok: boolean; name?: string; base64?: string }>;
      writeChapterContents?: (payload: { folder: string; chapters: { id: string; html: string }[] }) => Promise<{ ok: boolean }>;
      writeChapterContent?: (payload: { folder: string; chapterId: string; html: string }) => Promise<{ ok: boolean }>;
      deleteChapterFiles?: (payload: { folder: string; chapterId: string }) => Promise<{ ok: boolean }>;
      readChapterContent?: (payload: { folder: string; chapterId: string }) => Promise<{ ok: boolean; html: string }>;
      writeChapterAudio?: (payload: {
        folder: string;
        chapterId: string;
        base64: string;
        mime?: string;
        slot?: "original" | "working" | "mastered";
      }) => Promise<{ ok: boolean; file?: string }>;
      readChapterAudio?: (payload: { folder: string; file: string }) => Promise<{ ok: boolean; base64?: string }>;
      transcribeChapter?: (payload: { folder: string; file: string }) => Promise<{
        ok: boolean;
        words?: Array<{ text: string; start: number; end: number; confidence?: number }>;
        reason?: string;
      }>;
      copyToWorking?: (payload: { folder: string; chapterId: string; file: string }) => Promise<{ ok: boolean; file?: string }>;
      applyPunch?: (payload: {
        folder: string;
        chapterId: string;
        originalFile: string;
        workingFile?: string;
        punches?: Array<{
          id: string;
          chapter_id: string;
          path: string;
          t_start: number;
          t_end: number;
          trim_silence?: boolean;
          edit_status?: string;
        }>;
        pickupId?: string;
        expected?: string;
        heard?: string;
        tStart: number;
        tEnd: number;
        wavBase64: string;
        trimSilence?: boolean;
      }) => Promise<{
        ok: boolean;
        reason?: string;
        workingFile?: string;
        punch?: ChapterPunchDto;
        punches?: ChapterPunchDto[];
        appliedStart?: number;
        appliedEnd?: number;
        durationDelta?: number;
      }>;
      previewPunch?: (payload: {
        folder: string;
        originalFile: string;
        workingFile?: string;
        tStart: number;
        tEnd: number;
        wavBase64: string;
        trimSilence?: boolean;
      }) => Promise<{
        ok: boolean;
        reason?: string;
        currentWavBase64?: string;
        patchedWavBase64?: string;
      }>;
      undoLatestPunch?: (payload: {
        folder: string;
        chapterId: string;
        originalFile: string;
        workingFile?: string;
        punches?: ChapterPunchDto[];
      }) => Promise<{ ok: boolean; reason?: string; workingFile?: string; punches?: ChapterPunchDto[]; undonePunchId?: string }>;
      masterChapter?: (payload: {
        folder: string;
        chapterId?: string;
        workingFile: string;
        targetRmsDbfs?: number;
        presetId?: string;
      }) => Promise<{ ok: boolean; reason?: string; workingFile?: string; masteredFile?: string; rms_dbfs?: number }>;
      measureChapter?: (payload: {
        folder: string;
        file: string;
        presetId?: string;
      }) => Promise<{ ok: boolean; reason?: string; report?: import("../../../src/core/acx/measure").AcxReport }>;
      exportDelivery?: (payload: {
        folder: string;
        presetId?: string;
        chapters: Array<{
          id: string;
          title: string;
          workingFile?: string;
          masteredFile?: string;
          mastered?: boolean;
          pickups?: unknown[];
        }>;
      }) => Promise<{ ok: boolean; reason?: string; folder?: string; files?: string[] }>;
      startLiveFollow?: () => Promise<{ ok: boolean; streaming?: boolean; engine?: string; reason?: string }>;
      stopLiveFollow?: () => Promise<{ ok: boolean }>;
      restartLiveFollow?: (payload: { truncateToSeconds: number }) => Promise<{
        ok: boolean;
        streaming?: boolean;
        truncatedToSeconds?: number;
        reason?: string;
      }>;
      sendLivePcm?: (payload: { pcmBase64: string }) => void;
      transcribeHop?: (payload: { wavBase64: string }) => Promise<{
        ok: boolean;
        words?: Array<{ text: string; start: number; end: number; confidence?: number }>;
      }>;
      suggestGlossaryRespells?: (payload: { glossary: unknown[] }) => Promise<{
        ok?: boolean;
        reason?: string;
        glossary?: import("../../../src/core/project/types").GlossaryEntry[];
        filled?: number;
        unknown?: string[];
      }>;
      onLiveWords?: (
        callback: (words: Array<{ text: string; start: number; end: number; confidence?: number }>) => void,
      ) => (() => void) | void;
    };
  }
}
