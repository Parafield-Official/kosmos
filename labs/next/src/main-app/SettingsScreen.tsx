import { useEffect, useState } from "react";
import { GlassLookSwitch } from "../GlassLookSwitch";
import { clearOnboarded } from "../flow";
import type { AppUpdateStatus } from "../window";
import { FONT_SCALE_OPTIONS, readFontScale, writeFontScale, type FontScale } from "./display";
import {
  CONFIDENCE_OPTIONS,
  PAUSE_RANGE,
  RMS_RANGE,
  SENSITIVITY_OPTIONS,
  readEnginePrefs,
  writeEnginePrefs,
  type EnginePrefs,
} from "./engine-prefs";
import {
  PROMPT_THEME_OPTIONS,
  READING_FONT_OPTIONS,
  READING_FONT_STACKS,
  readPromptTheme,
  readReadingFont,
  writePromptTheme,
  writeReadingFont,
} from "./reading-prefs";
import { chooseWorkspace, getWorkspacePath } from "./store";
import type { PromptTheme, ReadingFont } from "./store";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [engine, setEngine] = useState<EnginePrefs>(() => readEnginePrefs());
  const [readingFont, setReadingFont] = useState<ReadingFont>(() => readReadingFont());
  const [promptTheme, setPromptTheme] = useState<PromptTheme>(() => readPromptTheme());
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  function chooseFontScale(scale: FontScale) {
    setFontScale(scale);
    writeFontScale(scale);
  }

  function patchEngine(patch: Partial<EnginePrefs>) {
    setEngine(writeEnginePrefs(patch));
  }

  function chooseReadingFont(font: ReadingFont) {
    setReadingFont(font);
    writeReadingFont(font);
  }

  function choosePromptTheme(theme: PromptTheme) {
    setPromptTheme(theme);
    writePromptTheme(theme);
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
        <h2 className="ma-set-section">Display</h2>

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

        <h2 className="ma-set-section">Reading</h2>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <ReadingFontIcon />
            <strong>Reading font</strong>
          </div>
          <p className="ma-set-sub">
            Typeface for the teleprompter, reader, and chapter text. Georgia is the book default; Courier is the
            classic prompt face; Verdana and Atkinson are easier at a distance.
          </p>
          <div className="ma-set-control">
            <div className="ma-seg ma-seg-fonts" role="radiogroup" aria-label="Reading font">
              {READING_FONT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={readingFont === option.value}
                  className={readingFont === option.value ? "ma-seg-btn is-on" : "ma-seg-btn"}
                  style={{ fontFamily: READING_FONT_STACKS[option.value] }}
                  onClick={() => chooseReadingFont(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <PageThemeIcon />
            <strong>Reading page</strong>
          </div>
          <p className="ma-set-sub">Paper colour behind the script. Cream is easiest in a bright room; dark is for a dim booth.</p>
          <div className="ma-set-control">
            <div className="ma-set-themes" role="radiogroup" aria-label="Reading page">
              {PROMPT_THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={promptTheme === option.value}
                  className={`ma-set-theme is-${option.value}${promptTheme === option.value ? " is-on" : ""}`}
                  onClick={() => choosePromptTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <h2 className="ma-set-section">Proofreading</h2>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <ProofIcon />
            <strong>Nearby flags</strong>
          </div>
          <p className="ma-set-sub">
            {SENSITIVITY_OPTIONS.find((option) => option.value === engine.proof_sensitivity)?.hint}
          </p>
          <div className="ma-set-control">
            <div className="ma-seg" role="radiogroup" aria-label="Nearby flags">
              {SENSITIVITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={engine.proof_sensitivity === option.value}
                  className={engine.proof_sensitivity === option.value ? "ma-seg-btn is-on" : "ma-seg-btn"}
                  onClick={() => patchEngine({ proof_sensitivity: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <PauseIcon />
            <strong>Long pause</strong>
          </div>
          <p className="ma-set-sub">
            A mid-sentence gap longer than this is flagged as a pause. Shorter breaths are ignored.
          </p>
          <div className="ma-set-control">
            <label className="ma-set-slider">
              <input
                type="range"
                min={PAUSE_RANGE.min}
                max={PAUSE_RANGE.max}
                step={PAUSE_RANGE.step}
                value={engine.pause_threshold_seconds}
                aria-label="Pause threshold in seconds"
                onChange={(event) => patchEngine({ pause_threshold_seconds: Number(event.target.value) })}
              />
              <span className="ma-set-slider-value">{engine.pause_threshold_seconds.toFixed(1)} s</span>
            </label>
          </div>
        </div>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <ShakyIcon />
            <strong>Shaky alerts</strong>
          </div>
          <p className="ma-set-sub">
            {CONFIDENCE_OPTIONS.find((option) => Math.abs(option.value - engine.proof_confidence_floor) < 0.001)?.hint}
            {" "}
            A shaky alert usually means the recogniser misheard, not that you misread.
          </p>
          <div className="ma-set-control">
            <div className="ma-seg" role="radiogroup" aria-label="Shaky alerts">
              {CONFIDENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={Math.abs(option.value - engine.proof_confidence_floor) < 0.001}
                  className={Math.abs(option.value - engine.proof_confidence_floor) < 0.001 ? "ma-seg-btn is-on" : "ma-seg-btn"}
                  onClick={() => patchEngine({ proof_confidence_floor: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <FilterIcon />
            <strong>Never-flagged words</strong>
          </div>
          <p className="ma-set-sub">
            Per book, not app-wide. On a Review flag, tap Never flag this word. The list lives on the book overview.
          </p>
        </div>

        <h2 className="ma-set-section">Sound &amp; mastering</h2>

        <div className="ma-set-item">
          <div className="ma-set-head">
            <MasterIcon />
            <strong>Loudness target</strong>
          </div>
          <p className="ma-set-sub">
            RMS used when mastering the working file. ACX accepts −23 to −18 dBFS; −20 is the usual aim.
          </p>
          <div className="ma-set-control">
            <label className="ma-set-slider">
              <input
                type="range"
                min={RMS_RANGE.min}
                max={RMS_RANGE.max}
                step={RMS_RANGE.step}
                value={engine.acx_target_rms_dbfs}
                aria-label="ACX target RMS in dBFS"
                onChange={(event) => patchEngine({ acx_target_rms_dbfs: Number(event.target.value) })}
              />
              <span className="ma-set-slider-value">{engine.acx_target_rms_dbfs.toFixed(1)} dBFS</span>
            </label>
          </div>
        </div>

        <h2 className="ma-set-section">App</h2>

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

function ProofIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M5 5h10l4 4v10H5V5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 5v4h4M8 13h8M8 16.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M4 12h4M16 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="9" y="7" width="2.4" height="10" rx="0.6" fill="currentColor" />
      <rect x="12.6" y="7" width="2.4" height="10" rx="0.6" fill="currentColor" />
    </svg>
  );
}

function ShakyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 15c1.4-3 2.4-7 4-7s2.2 5 3.8 5 2.4-8 4.2-8 2.6 10 4 10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MasterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M4 16V8m4 10V6m4 12v-7m4 7V9m4 7V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ReadingFontIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M5 19V6.5c0-.8.6-1.5 1.5-1.5H12v14H6.5A1.5 1.5 0 0 1 5 19z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 5h5.5c.8 0 1.5.7 1.5 1.5V19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PageThemeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 8h8M8 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
