import { useEffect, useState } from "react";
import { GlassLookSwitch } from "../GlassLookSwitch";
import { clearOnboarded } from "../flow";
import type { AppUpdateStatus } from "../window";
import { FONT_SCALE_OPTIONS, readFontScale, writeFontScale, type FontScale } from "./display";
import { chooseWorkspace, getWorkspacePath } from "./store";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  function chooseFontScale(scale: FontScale) {
    setFontScale(scale);
    writeFontScale(scale);
  }

  useEffect(() => {
    let alive = true;
    void window.kosmosNext?.getAppInfo?.().then((info) => {
      if (alive) {
        setAppVersion(info.version);
        setUpdate(info.update);
      }
    });
    const off = window.kosmosNext?.onAppUpdate?.((status) => setUpdate(status));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  async function checkForUpdates() {
    if (checking || !window.kosmosNext?.checkForUpdates) {
      return;
    }
    setChecking(true);
    try {
      const status = await window.kosmosNext.checkForUpdates();
      if (status) {
        setUpdate(status);
      }
    } finally {
      setChecking(false);
    }
  }

  const updateMessage = update?.text
    ? update.text
    : update?.skipped
      ? "This development copy does not check for updates."
      : "Up to date.";

  useEffect(() => {
    let alive = true;
    void getWorkspacePath().then((path) => {
      if (alive) {
        setWorkspace(path);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  async function pickWorkspace() {
    if (picking) {
      return;
    }
    setPicking(true);
    try {
      const path = await chooseWorkspace();
      if (path) {
        setWorkspace(path);
      } else {
        const current = await getWorkspacePath();
        setWorkspace(current);
      }
    } finally {
      setPicking(false);
    }
  }

  function restartOnboarding() {
    clearOnboarded();
    window.dispatchEvent(new Event("kosmos-onboarding-restart"));
  }

  return (
    <section className="ma-screen ma-settings" aria-label="Settings">
      <header className="ma-overview-head">
        <button type="button" className="ma-back" onClick={onBack} aria-label="Back">
          <ChevronLeft />
          <span>Back</span>
        </button>
      </header>

      <h1 className="ma-title">Settings</h1>

      <div className="ma-set-list">
        <div className="ma-set-item">
          <div className="ma-set-head">
            <ThemeIcon />
            <strong>Theme</strong>
          </div>
          <p className="ma-set-sub">Glass appearance across Kosmos.</p>
          <div className="ma-set-control">
            <GlassLookSwitch compact />
          </div>
        </div>

        <div className="ma-set-divider" />

        <div className="ma-set-item">
          <div className="ma-set-head">
            <TextSizeIcon />
            <strong>Text size</strong>
          </div>
          <p className="ma-set-sub">Overall size of text across the whole app.</p>
          <div className="ma-set-control">
            <div className="ma-seg" role="radiogroup" aria-label="Text size">
              {FONT_SCALE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={fontScale === option.value}
                  className={fontScale === option.value ? "ma-seg-btn is-on" : "ma-seg-btn"}
                  onClick={() => chooseFontScale(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ma-set-divider" />

        <div className="ma-set-item">
          <div className="ma-set-head">
            <FolderIcon />
            <strong>Workspace</strong>
          </div>
          <p className="ma-set-sub">Pick an empty folder on your computer. New books are saved inside it.</p>
          <p className="ma-set-value" title={workspace ?? undefined}>
            {workspace ?? "No workspace chosen yet."}
          </p>
          <div className="ma-set-control">
            <button type="button" className="btn" disabled={picking} onClick={() => void pickWorkspace()}>
              {picking ? "Opening picker…" : workspace ? "Change workspace" : "Choose workspace"}
            </button>
          </div>
        </div>

        <div className="ma-set-divider" />

        <div className="ma-set-item">
          <div className="ma-set-head">
            <RestartIcon />
            <strong>Restart onboarding</strong>
          </div>
          <p className="ma-set-sub">
            Re-run the welcome flow. Microphone and speech-model access stay as they are.
          </p>
          <div className="ma-set-control">
            <button type="button" className="btn ma-danger-btn" onClick={restartOnboarding}>
              <RestartIcon />
              Reset
            </button>
          </div>
        </div>

        <div className="ma-set-divider" />

        <div className="ma-set-item">
          <div className="ma-set-head">
            <InfoIcon />
            <strong>About Kosmos Labs</strong>
          </div>
          <p className="ma-set-value">{appVersion ? `Version ${appVersion}` : "Version unavailable"}</p>
          <p className="ma-set-sub">{updateMessage}</p>
          <div className="ma-set-control ma-set-control-row">
            <button
              type="button"
              className="btn"
              disabled={checking || update?.skipped}
              onClick={() => void checkForUpdates()}
            >
              {checking ? "Checking…" : "Check for updates"}
            </button>
            <button type="button" className="btn" onClick={() => void window.kosmosNext?.openReleasePage?.()}>
              View releases
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v5M12 7.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TextSizeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M4 7V5h10v2M9 5v14M7 19h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 12V11h6v1M17 11v8M15.5 19h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M3 7V5a2 2 0 0 1 2-2h4.17a2 2 0 0 1 1.42.58l1.82 1.84A2 2 0 0 0 13.83 6H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 1 1 2.5 5.8M4 12V7m0 5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
