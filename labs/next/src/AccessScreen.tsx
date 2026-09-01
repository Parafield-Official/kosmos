import { useEffect, useLayoutEffect, useState } from "react";
import {
  accessBridgeReady,
  microphoneSessionCleared,
  openMicrophoneSettings,
  requestFolderAccess,
  requestMicrophoneAccess,
  readSpeechModelAccess,
  requestSpeechModelDownload,
  syncAccessState,
  type AccessSnapshot,
  type AccessState,
} from "./access";
import {
  ACCESS_HEADING,
  ACCESS_MIC_TITLE,
  ACCESS_MIC_DENIED,
  ACCESS_MIC_PROMPT,
  ACCESS_MIC_PENDING,
  ACCESS_MIC_GRANTED,
  ACCESS_OPEN_MIC_SETTINGS,
  ACCESS_SPEECH_TITLE,
  ACCESS_SPEECH_PROMPT,
  ACCESS_SPEECH_PENDING,
  ACCESS_SPEECH_GRANTED,
  ACCESS_SPEECH_DENIED,
  ACCESS_FOLDER_TITLE,
  ACCESS_FOLDER_PROMPT,
  ACCESS_FOLDER_PENDING,
  ACCESS_FOLDER_GRANTED,
  ACCESS_FOLDER_DENIED,
  ACCESS_BRIDGE_MISSING,
} from "./flow";

function applySnapshot(
  snapshot: AccessSnapshot,
  setMic: (state: AccessState) => void,
  setFolder: (state: AccessState) => void,
  setFolderPath: (path: string | undefined) => void,
  setSpeechModel: (state: AccessState) => void,
) {
  setMic(snapshot.mic.state);
  setFolder(snapshot.folder.state);
  setFolderPath(snapshot.folder.path);
  setSpeechModel(snapshot.speechModel.state);
}

export function AccessScreen({
  onComplete,
  initialSnapshot = null,
}: {
  onComplete: () => void;
  initialSnapshot?: AccessSnapshot | null;
}) {
  const [mic, setMic] = useState<AccessState>(initialSnapshot?.mic.state ?? "prompt");
  const [folder, setFolder] = useState<AccessState>(initialSnapshot?.folder.state ?? "prompt");
  const [folderPath, setFolderPath] = useState<string | undefined>(initialSnapshot?.folder.path);
  const [speechModel, setSpeechModel] = useState<AccessState>(initialSnapshot?.speechModel.state ?? "prompt");
  const [busy, setBusy] = useState<"mic" | "folder" | "speech" | null>(null);
  const [speechProgress, setSpeechProgress] = useState(0);
  const [bridgeReady, setBridgeReady] = useState(true);

  useLayoutEffect(() => {
    setBridgeReady(accessBridgeReady() || !window.kosmosNext);

    let alive = true;
    void syncAccessState().then((snapshot) => {
      if (!alive) {
        return;
      }
      applySnapshot(snapshot, setMic, setFolder, setFolderPath, setSpeechModel);
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!initialSnapshot) {
      return;
    }
    setMic((prev) => mergeAccessState(prev, initialSnapshot.mic.state));
    setFolder((prev) => mergeAccessState(prev, initialSnapshot.folder.state));
    setSpeechModel((prev) => mergeAccessState(prev, initialSnapshot.speechModel.state));
    if (initialSnapshot.folder.path) {
      setFolderPath(initialSnapshot.folder.path);
    }
  }, [initialSnapshot]);

  useEffect(() => {
    function refresh() {
      if (microphoneSessionCleared()) {
        return;
      }
      void syncAccessState().then((snapshot) => {
        applySnapshot(snapshot, setMic, setFolder, setFolderPath, setSpeechModel);
      });
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  async function grantMic() {
    if (busy || mic === "granted") {
      return;
    }
    setBusy("mic");
    try {
      const result = await requestMicrophoneAccess();
      setMic(result.state);
    } finally {
      setBusy(null);
    }
  }

  async function grantSpeechModel() {
    if (busy || speechModel === "granted") {
      return;
    }
    setBusy("speech");
    setSpeechProgress(0);
    try {
      const cached = await readSpeechModelAccess().catch(() => ({ state: "prompt" as const }));
      if (cached.state === "granted") {
        setSpeechModel("granted");
        return;
      }
      const result = await requestSpeechModelDownload((fraction) => {
        setSpeechProgress(fraction);
      });
      setSpeechModel(result.state);
    } finally {
      setBusy(null);
      setSpeechProgress(0);
    }
  }

  async function grantFolder() {
    if (busy) {
      return;
    }
    setBusy("folder");
    try {
      const result = await requestFolderAccess();
      setFolder(result.state);
      setFolderPath(result.path);
    } finally {
      setBusy(null);
    }
  }

  // Detection always runs so the indicator reflects a model downloaded in the
  // main app. Having the model is enforced in production, but never hard-blocks
  // Continue during development.
  const speechRequired = !import.meta.env.DEV && Boolean(window.kosmosNext?.downloadSpeechModel);
  const ready = mic === "granted" && folder === "granted" && (!speechRequired || speechModel === "granted");

  return (
    <section className="intro flow-screen access-screen" aria-label="Permissions">
      <div className="access-stack">
        <h2 className="access-heading">{ACCESS_HEADING}</h2>

        {!bridgeReady && window.kosmosNext ? (
          <p className="access-note access-note-warn">{ACCESS_BRIDGE_MISSING}</p>
        ) : null}

        <div className="access-items">
          <button
            type="button"
            className={rowClass(mic, busy === "mic")}
            onClick={() => void grantMic()}
            disabled={busy === "mic" || mic === "granted"}
          >
            <span className="access-icon" aria-hidden="true">
              <MicIcon />
            </span>
            <span className="access-text">
              <strong>{ACCESS_MIC_TITLE}</strong>
              <span>{micCopy(mic, busy === "mic")}</span>
            </span>
            <span className="access-check" aria-hidden="true">
              {mic === "granted" ? <CheckIcon /> : <ChevronIcon />}
            </span>
          </button>

          {mic === "denied" && window.kosmosNext?.openMicrophoneSettings ? (
            <button type="button" className="access-settings-link" onClick={() => void openMicrophoneSettings()}>
              {ACCESS_OPEN_MIC_SETTINGS}
            </button>
          ) : null}

          <button
            type="button"
            className={rowClass(speechModel, busy === "speech")}
            onClick={() => void grantSpeechModel()}
            disabled={busy === "speech" || speechModel === "granted" || !window.kosmosNext?.downloadSpeechModel}
          >
            <span className="access-icon" aria-hidden="true">
              <SpeechIcon />
            </span>
            <span className="access-text">
              <strong>{ACCESS_SPEECH_TITLE}</strong>
              <span>{speechCopy(speechModel, busy === "speech", speechProgress)}</span>
            </span>
            <span className="access-check" aria-hidden="true">
              {speechModel === "granted" ? <CheckIcon /> : <ChevronIcon />}
            </span>
          </button>

          <button
            type="button"
            className={rowClass(folder, busy === "folder", folder === "granted")}
            onClick={() => void grantFolder()}
            disabled={busy === "folder"}
          >
            <span className="access-icon" aria-hidden="true">
              <FolderIcon />
            </span>
            <span className="access-text">
              <strong>{ACCESS_FOLDER_TITLE}</strong>
              <span>{folderCopy(folder, busy === "folder", folderPath)}</span>
            </span>
            <span className="access-check" aria-hidden="true">
              {folder === "granted" ? <CheckIcon /> : <ChevronIcon />}
            </span>
          </button>
        </div>

        <button type="button" className="continue btn" disabled={!ready} onClick={onComplete}>
          Continue
        </button>
      </div>
    </section>
  );
}

function mergeAccessState(local: AccessState, incoming: AccessState): AccessState {
  if (local === "granted" || incoming === "granted") {
    return "granted";
  }
  if (local === "denied" || incoming === "denied") {
    return "denied";
  }
  return incoming;
}

function rowClass(state: AccessState, pending: boolean, changeable = false) {
  if (state === "granted") return changeable ? "access-row granted changeable" : "access-row granted";
  if (state === "denied") return "access-row denied";
  if (pending) return "access-row pending";
  return "access-row";
}

function micCopy(state: AccessState, pending: boolean) {
  if (pending) return ACCESS_MIC_PENDING;
  if (state === "granted") return ACCESS_MIC_GRANTED;
  if (state === "denied") return ACCESS_MIC_DENIED;
  return ACCESS_MIC_PROMPT;
}

function speechCopy(state: AccessState, pending: boolean, progress: number) {
  if (pending) {
    const pct = Math.round(progress * 100);
    return pct > 0 ? `${ACCESS_SPEECH_PENDING} ${pct}%` : `${ACCESS_SPEECH_PENDING}…`;
  }
  if (state === "granted") return ACCESS_SPEECH_GRANTED;
  if (state === "denied") return ACCESS_SPEECH_DENIED;
  return ACCESS_SPEECH_PROMPT;
}

function folderCopy(state: AccessState, pending: boolean, path?: string) {
  if (pending) return ACCESS_FOLDER_PENDING;
  if (state === "granted") {
    return path ? shortPath(path) : ACCESS_FOLDER_GRANTED;
  }
  if (state === "denied") return ACCESS_FOLDER_DENIED;
  return ACCESS_FOLDER_PROMPT;
}

function shortPath(path: string) {
  if (path.length <= 42) return path;
  return `…${path.slice(-39)}`;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18v3M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SpeechIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M12 4v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 10.5 12 14l3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path
        d="M3 7V5a2 2 0 0 1 2-2h4.17a2 2 0 0 1 1.42.58l1.82 1.84A2 2 0 0 0 13.83 6H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M6 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
