import { useEffect, useState, type ReactNode } from "react";
import { GlassLookSwitch } from "../GlassLookSwitch";
import { clearOnboarded } from "../flow";
import type { AppUpdateStatus } from "../window";
import { FONT_SCALE_OPTIONS, readFontScale, writeFontScale, type FontScale } from "./display";
import {
  CONFIDENCE_OPTIONS,
  PAUSE_RANGE,
  PROOF_MARK_OPTIONS,
  RMS_RANGE,
  SENSITIVITY_OPTIONS,
  SPEC_PRESET_OPTIONS,
  readEnginePrefs,
  writeEnginePrefs,
  type EnginePrefs,
  type ProofMarkKind,
} from "./engine-prefs";
import {
  PROMPT_THEME_GROUPS,
  READING_FONT_OPTIONS,
  READING_FONT_STACKS,
  readPromptTheme,
  readReadingFont,
  writePromptTheme,
  writeReadingFont,
} from "./reading-prefs";
import { chooseWorkspace, getWorkspacePath } from "./store";
import type { PromptTheme, ReadingFont } from "./store";
import { ThemeColourPicker } from "./ThemeColourPicker";
import { readThemeAccent, type ThemeAccent } from "./theme";
import { LAMP_ALL, readLamps, writeLamps } from "./vault-lamps";

function SetItem({
  icon,
  title,
  sub,
  children,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ma-set-item">
      <div className="ma-set-copy">
        <div className="ma-set-head">
          {icon}
          <strong>{title}</strong>
        </div>
        {sub ? <p className="ma-set-sub">{sub}</p> : null}
      </div>
      {children ? <div className="ma-set-control">{children}</div> : null}
    </div>
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [engine, setEngine] = useState<EnginePrefs>(() => readEnginePrefs());
  const [readingFont, setReadingFont] = useState<ReadingFont>(() => readReadingFont());
  const [promptTheme, setPromptTheme] = useState<PromptTheme>(() => readPromptTheme());
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>(() => readThemeAccent());
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
      <header className="ma-set-masthead">
        <button type="button" className="vault-media-back" onClick={onBack} aria-label="Back">
          <ChevronLeft />
          <span>Back</span>
        </button>
        <h1 className="ma-title">Settings</h1>
        <span className="ma-set-masthead-space" aria-hidden="true" />
      </header>

      <div className="ma-set-columns">
        <div className="ma-set-col">
          <p className="ma-set-kicker">Display</p>
          <div className="ma-set-card">
            <SetItem icon={<ThemeIcon />} title="Theme" sub="Glass appearance across Kosmos.">
              <GlassLookSwitch compact />
            </SetItem>
            <SetItem icon={<AccentIcon />} title="Theme colour" sub="Atmosphere for the room. The canvas stays white.">
              <ThemeColourPicker accent={themeAccent} onAccent={setThemeAccent} />
            </SetItem>
            <SetItem icon={<TextSizeIcon />} title="Text size" sub="Size of text across the whole app.">
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
            </SetItem>
            <SetItem icon={<LampIcon />} title="Gallery lights" sub="Five ceiling cans. All off, or each one on its own.">
              <GalleryLights />
            </SetItem>
          </div>

          <p className="ma-set-kicker">Reading</p>
          <div className="ma-set-card">
            <SetItem icon={<ReadingFontIcon />} title="Reading font" sub="Teleprompter, reader, and chapter text.">
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
            </SetItem>
            <SetItem icon={<PageThemeIcon />} title="Reading page" sub="Digital pages or physical paper.">
              <div className="ma-set-paper-groups">
                {PROMPT_THEME_GROUPS.map((group) => (
                  <div className="ma-set-paper-group" key={group.label}>
                    <p className="ma-set-paper-label">{group.label}</p>
                    <div className="ma-set-themes" role="radiogroup" aria-label={group.label}>
                      {group.options.map((option) => (
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
                ))}
              </div>
            </SetItem>
          </div>
        </div>

        <div className="ma-set-col">
          <p className="ma-set-kicker">Proofreading</p>
          <div className="ma-set-card">
            <SetItem
              icon={<ProofIcon />}
              title="Nearby flags"
              sub={SENSITIVITY_OPTIONS.find((option) => option.value === engine.proof_sensitivity)?.hint}
            >
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
            </SetItem>
            <SetItem icon={<PauseIcon />} title="Long pause" sub="Gaps longer than this are flagged. Shorter breaths are ignored.">
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
            </SetItem>
            <SetItem
              icon={<ShakyIcon />}
              title="Shaky alerts"
              sub={CONFIDENCE_OPTIONS.find((option) => Math.abs(option.value - engine.proof_confidence_floor) < 0.001)?.hint}
            >
              <div className="ma-seg" role="radiogroup" aria-label="Shaky alerts">
                {CONFIDENCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={Math.abs(option.value - engine.proof_confidence_floor) < 0.001}
                    className={
                      Math.abs(option.value - engine.proof_confidence_floor) < 0.001 ? "ma-seg-btn is-on" : "ma-seg-btn"
                    }
                    onClick={() => patchEngine({ proof_confidence_floor: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </SetItem>
            <SetItem icon={<FilterIcon />} title="Marks on the page" sub="Which mismatches appear on the manuscript.">
              <div className="ma-seg" role="group" aria-label="Marks on the page">
                {PROOF_MARK_OPTIONS.map((option) => {
                  const on = engine.mark_kinds.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={on}
                      title={option.hint}
                      className={on ? "ma-seg-btn is-on" : "ma-seg-btn"}
                      onClick={() => {
                        const next = on
                          ? engine.mark_kinds.filter((kind) => kind !== option.value)
                          : [...engine.mark_kinds, option.value];
                        if (next.length === 0) {
                          return;
                        }
                        patchEngine({ mark_kinds: next as ProofMarkKind[] });
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </SetItem>
            <SetItem icon={<FilterIcon />} title="Never-flagged words" sub="Per book. On a proof flag, tap Never flag this word.">
              <p className="ma-set-value">Set from a proof flag</p>
            </SetItem>
          </div>

          <p className="ma-set-kicker">Sound</p>
          <div className="ma-set-card">
            <SetItem icon={<MasterIcon />} title="Loudness target" sub="RMS for the mastered file. ACX accepts -23 to -18 dBFS.">
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
            </SetItem>
            <SetItem
              icon={<MasterIcon />}
              title="Delivery target"
              sub={SPEC_PRESET_OPTIONS.find((option) => option.value === engine.spec_preset_id)?.hint}
            >
              <div className="ma-seg" role="radiogroup" aria-label="Delivery target">
                {SPEC_PRESET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={engine.spec_preset_id === option.value}
                    className={engine.spec_preset_id === option.value ? "ma-seg-btn is-on" : "ma-seg-btn"}
                    onClick={() => patchEngine({ spec_preset_id: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </SetItem>
            <SetItem icon={<MasterIcon />} title="Audio format" sub="Used for chapter exports.">
              <p className="ma-set-value">Mono (ACX default)</p>
            </SetItem>
          </div>

          <p className="ma-set-kicker">App</p>
          <div className="ma-set-card">
            <SetItem icon={<FolderIcon />} title="Workspace" sub="An empty folder. New books are saved inside it.">
              <p className="ma-set-value" title={workspace ?? undefined}>
                {workspace ?? "No workspace chosen yet."}
              </p>
              <button type="button" className="btn" disabled={picking} onClick={() => void pickWorkspace()}>
                {picking ? "Opening picker…" : workspace ? "Change workspace" : "Choose workspace"}
              </button>
            </SetItem>
            <SetItem
              icon={<RestartIcon />}
              title="Restart onboarding"
              sub="Welcome flow again. Microphone and speech-model access stay as they are."
            >
              <button type="button" className="btn ma-danger-btn" onClick={restartOnboarding}>
                Reset
              </button>
            </SetItem>
            <SetItem icon={<InfoIcon />} title="About Kosmos Labs" sub={updateMessage}>
              <p className="ma-set-value">{appVersion ? `Version ${appVersion}` : "Version unavailable"}</p>
              <div className="ma-set-control-row">
                <button
                  type="button"
                  className="btn"
                  disabled={checking || update?.skipped}
                  onClick={() => void checkForUpdates()}
                >
                  {checking ? "Checking…" : "Check for updates"}
                </button>
                {update?.canInstall ? (
                  <button
                    type="button"
                    className="btn btn-clear"
                    onClick={() => void window.kosmosNext?.installAppUpdate?.()}
                  >
                    Get update
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => void window.kosmosNext?.openReleasePage?.()}>
                  View releases
                </button>
              </div>
            </SetItem>
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

function LampIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6.5" rx="5.2" ry="2.1" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.2 7.2 9 14.5h6l1.8-7.3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.4 14.5v2.8M14.6 14.5v2.8M10.2 20h3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function GalleryLights() {
  const [lamps, setLamps] = useState(readLamps);
  const allOn = lamps === LAMP_ALL;

  function setMask(next: number) {
    setLamps(writeLamps(next));
  }

  return (
    <div className="ma-lamp-plate" role="toolbar" aria-label="Gallery lights">
      <button
        type="button"
        className="ma-lamp-paddle is-master"
        data-on={allOn ? "true" : "false"}
        aria-pressed={allOn}
        onClick={() => setMask(allOn ? 0 : LAMP_ALL)}
      >
        <i />
        <span>All</span>
      </button>
      {Array.from({ length: 5 }, (_, index) => {
        const on = ((lamps >> index) & 1) === 1;
        return (
          <button
            key={index}
            type="button"
            className="ma-lamp-paddle"
            data-on={on ? "true" : "false"}
            aria-label={`Light ${index + 1}`}
            aria-pressed={on}
            onClick={() => setMask(lamps ^ (1 << index))}
          >
            <i />
            <span>{index + 1}</span>
          </button>
        );
      })}
    </div>
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

function AccentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M4 15.5c2.5-7 6.2-10.5 11-10.5 3.3 0 5 1.8 5 4.3 0 4.8-5 9.7-11.2 9.7C5.8 19 3.2 18 4 15.5Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15.8" cy="9.1" r="2.1" fill="currentColor" />
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
