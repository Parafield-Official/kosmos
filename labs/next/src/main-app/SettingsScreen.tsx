import { useEffect, useState, type ReactNode } from "react";
import { GlassLookSwitch } from "../GlassLookSwitch";
import { CONTACT_EMAIL, CONTACT_MAILTO, INTRO_DISCORD, INTRO_DISCORD_APP, clearOnboarded } from "../flow";
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

  const busy = checking || ["checking", "available", "downloading"].includes(update?.phase ?? "");
  const updateMessage = update?.skipped ? "Updates are unavailable in this development copy."
    : update?.phase === "ready" ? `Kosmos ${update.version} is ready to install`
    : update?.phase === "downloading" ? `Downloading Kosmos ${update.version ?? "update"}`
    : update?.phase === "available" ? `Preparing to download Kosmos ${update.version}`
    : update?.phase === "error" ? "Update could not finish"
    : busy ? "Checking for updates…"
    : update?.phase === "up-to-date" ? "You’re up to date"
    : "Automatic updates";

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

      <aside className="ma-community-banner" aria-label="Join the community">
        <div className="ma-community-copy">
          <p className="ma-community-kicker">Join the community</p>
          <h2>Talk with authors and narrators</h2>
          <p>Ask a question, share feedback, or suggest what to build next. We read everything.</p>
        </div>
        <div className="ma-community-actions">
          <button type="button" className="ma-community-discord" onClick={() => void openDiscord()}>
            <DiscordGlyph />
            Join Discord
          </button>
          <button type="button" className="ma-community-mail" onClick={() => void openMail()}>
            {CONTACT_EMAIL}
          </button>
        </div>
      </aside>

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
              <p className="ma-set-value">{appVersion ? `Installed version ${appVersion}` : "Loading installed version…"}</p>
              <div className="ma-update-status" role="status" aria-live="polite">
                {update?.phase === "downloading" || update?.phase === "available" ? (
                  <>
                    <progress aria-label="Update download progress" max={100}
                      value={update.phase === "downloading" && Number.isFinite(update.percent) ? Math.max(0, Math.min(100, update.percent!)) : undefined} />
                    <p>{update.phase === "available" ? "Connecting to the download…" : `${Math.round(update.percent ?? 0)}% downloaded`}
                      {update.total ? ` · ${Math.round((update.transferred ?? 0) / 1e6)} / ${Math.round(update.total / 1e6)} MB` : ""}</p>
                    <p>You can keep working. Restart after the download finishes to install the update.</p>
                  </>
                ) : update?.phase === "ready" ? <p>Download complete. Finish recording, then restart Kosmos to use the new version.</p>
                  : update?.phase === "error" ? <>
                    <p>Your current version still works. Try again or download the installer.</p>
                    {update.message ? <details><summary>Show error details</summary><p>{update.message}</p></details> : null}
                  </> : <p>Updates download automatically. A restart applies the new version.</p>}
              </div>
              <div className="ma-set-control-row">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || update?.skipped || update?.canInstall}
                  onClick={() => void checkForUpdates()}
                >
                  {busy ? update?.phase === "checking" || checking ? "Checking…" : "Downloading…" : update?.phase === "error" ? "Try again" : "Check for updates"}
                </button>
                {update?.canInstall ? (
                  <button
                    type="button"
                    className="btn btn-clear"
                    onClick={() => void window.kosmosNext?.installAppUpdate?.()}
                  >
                    Restart to update
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => void window.kosmosNext?.openReleasePage?.()}>
                  Download installer
                </button>
              </div>
            </SetItem>
            <p className="ma-third-party-notice">
              Includes the Parakeet speech model under CC BY 4.0. {" "}
              <button type="button" onClick={() => void window.kosmosNext?.openThirdPartyNotices?.()}>
                Third-party notices
              </button>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

async function openDiscord() {
  const open = window.kosmosNext?.openDiscord;
  if (open) {
    await open({ appUrl: INTRO_DISCORD_APP, webUrl: INTRO_DISCORD });
    return;
  }
  window.open(INTRO_DISCORD, "_blank", "noopener,noreferrer");
}

async function openMail() {
  const open = window.kosmosNext?.openMail;
  if (open) {
    await open();
    return;
  }
  window.location.href = CONTACT_MAILTO;
}

function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
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
