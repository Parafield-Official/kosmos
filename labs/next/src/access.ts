export type AccessState = "prompt" | "granted" | "denied";

export type MicrophoneAccess = {
  state: AccessState;
  status?: string;
};

export type FolderAccess = {
  state: AccessState;
  path?: string;
};

export type SpeechModelAccess = {
  state: AccessState;
};

export type AccessSnapshot = {
  mic: MicrophoneAccess;
  folder: FolderAccess;
  speechModel: SpeechModelAccess;
};

export const CLEARED_ACCESS: AccessSnapshot = {
  mic: { state: "prompt" },
  folder: { state: "prompt" },
  speechModel: { state: "prompt" },
};

const MIC_SESSION_CLEARED_KEY = "kosmos-mic-session-cleared";

function readClearedFlag(): boolean {
  try {
    return window.sessionStorage.getItem(MIC_SESSION_CLEARED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeClearedFlag(cleared: boolean) {
  try {
    if (cleared) {
      window.sessionStorage.setItem(MIC_SESSION_CLEARED_KEY, "1");
    } else {
      window.sessionStorage.removeItem(MIC_SESSION_CLEARED_KEY);
    }
  } catch {
    // Private windows can refuse storage; the in-memory flag still works.
  }
}

let ignoreGrantedMic = readClearedFlag();

export function accessBridgeReady(): boolean {
  return Boolean(
    window.kosmosNext?.requestMicrophoneAccess &&
      window.kosmosNext?.requestFolderAccess &&
      window.kosmosNext?.getMicrophoneAccess &&
      window.kosmosNext?.getFolderAccess,
  );
}

async function microphoneFromBridge(): Promise<MicrophoneAccess | null> {
  if (!window.kosmosNext?.getMicrophoneAccess) {
    return null;
  }
  const result = await window.kosmosNext.getMicrophoneAccess();
  if (result.granted) {
    return { state: "granted", status: result.status };
  }
  if (result.status === "denied" || result.status === "restricted") {
    return { state: "denied", status: result.status };
  }
  return { state: "prompt", status: result.status };
}

async function microphoneFromBrowser(): Promise<MicrophoneAccess> {
  if (!navigator.permissions?.query) {
    return { state: "prompt" };
  }
  try {
    const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (perm.state === "granted") {
      return { state: "granted", status: perm.state };
    }
    if (perm.state === "denied") {
      return { state: "denied", status: perm.state };
    }
    return { state: "prompt", status: perm.state };
  } catch {
    return { state: "prompt" };
  }
}

export function microphoneSessionCleared(): boolean {
  return ignoreGrantedMic || readClearedFlag();
}

export async function readMicrophoneAccess(): Promise<MicrophoneAccess> {
  if (microphoneSessionCleared()) {
    return { state: "prompt" };
  }
  if (window.kosmosNext?.getMicrophoneAccess) {
    const bridge = await microphoneFromBridge();
    if (bridge) {
      return bridge;
    }
  }
  return microphoneFromBrowser();
}

export async function requestMicrophoneAccess(): Promise<MicrophoneAccess> {
  ignoreGrantedMic = false;
  writeClearedFlag(false);
  if (window.kosmosNext?.requestMicrophoneAccess) {
    await window.kosmosNext.requestMicrophoneAccess();
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return { state: "denied", status: "unsupported" };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return { state: "granted" };
  } catch {
    const current = await readMicrophoneAccess();
    return current.state === "denied" ? current : { state: "denied", status: current.status };
  }
}

async function folderFromBridge(): Promise<FolderAccess | null> {
  if (!window.kosmosNext?.getFolderAccess) {
    return null;
  }
  const result = await window.kosmosNext.getFolderAccess();
  if (result.granted) {
    return { state: "granted", path: result.path };
  }
  return { state: "prompt" };
}

export async function readFolderAccess(): Promise<FolderAccess> {
  const bridge = await folderFromBridge();
  if (bridge?.state === "granted") {
    return bridge;
  }
  return { state: "prompt" };
}

async function speechModelFromBridge(): Promise<SpeechModelAccess | null> {
  if (!window.kosmosNext?.getSpeechModelAccess) {
    return null;
  }
  const result = await window.kosmosNext.getSpeechModelAccess();
  if (result.granted) {
    return { state: "granted" };
  }
  return { state: "prompt" };
}

export async function readSpeechModelAccess(): Promise<SpeechModelAccess> {
  const bridge = await speechModelFromBridge();
  if (bridge) {
    return bridge;
  }
  return { state: "prompt" };
}

export async function requestSpeechModelDownload(
  onProgress?: (fraction: number) => void,
): Promise<SpeechModelAccess> {
  const existing = await readSpeechModelAccess().catch(() => ({ state: "prompt" as const }));
  if (existing.state === "granted") {
    return existing;
  }

  const off = window.kosmosNext?.onSpeechModelProgress?.((progress) => {
    onProgress?.(progress.fraction ?? 0);
  });

  try {
    if (window.kosmosNext?.downloadSpeechModel) {
      const result = await window.kosmosNext.downloadSpeechModel();
      if (result.granted) {
        return { state: "granted" };
      }
      return readSpeechModelAccess();
    }
    return { state: "denied" };
  } catch {
    return readSpeechModelAccess();
  } finally {
    off?.();
  }
}

export async function requestFolderAccess(): Promise<FolderAccess> {
  if (window.kosmosNext?.requestFolderAccess) {
    const result = await window.kosmosNext.requestFolderAccess();
    if (result.granted) {
      return { state: "granted", path: result.path };
    }
    return readFolderAccess();
  }

  try {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (!picker) {
      return { state: "denied" };
    }
    await picker.call(window);
    return { state: "granted" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return readFolderAccess();
    }
    return { state: "denied" };
  }
}

export async function openMicrophoneSettings() {
  await window.kosmosNext?.openMicrophoneSettings?.();
}

export function applyClearedAccess() {
  ignoreGrantedMic = true;
  writeClearedFlag(true);
}

export async function resetAccessState(): Promise<AccessSnapshot> {
  applyClearedAccess();
  try {
    if (window.kosmosNext?.resetAccess) {
      await window.kosmosNext.resetAccess();
    }
  } catch {
    // Main process may be an older Electron instance; the session flag still clears the UI.
  }
  window.dispatchEvent(new Event("kosmos-access-reset"));
  return CLEARED_ACCESS;
}

export async function syncAccessState(): Promise<AccessSnapshot> {
  const [mic, folder, speechModel] = await Promise.all([
    readMicrophoneAccess().catch(() => ({ state: "prompt" as const })),
    readFolderAccess().catch(() => ({ state: "prompt" as const })),
    readSpeechModelAccess().catch(() => ({ state: "prompt" as const })),
  ]);
  return { mic, folder, speechModel };
}
