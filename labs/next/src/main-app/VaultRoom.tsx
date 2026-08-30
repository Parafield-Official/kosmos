import { useMemo, useState, type CSSProperties } from "react";
import { GlassButton } from "../ui/liquid";
import { frostSettings } from "../ui/liquid-settings";
import { bookInitials, type BookProject } from "./store";
import { completionPct } from "./book-stats";
import { VaultPigment } from "./ThemeAtmosphere";
import { VaultLighting } from "./VaultLighting";
import { occupiedMask, peakSlotEnergy, slotLight, LAMP_ALL } from "./vault-light-layout";
import "./vault.css";

const VAULT_LIT_KEY = "kosmos-vault-lit";
const VAULT_LAMPS_KEY = "kosmos-vault-lamps";
const COLUMNS = 5;
const VISIBLE_ROWS = 3;

type VaultState = "lock" | "open";

function readLamps(): number {
  try {
    const raw = window.sessionStorage.getItem(VAULT_LAMPS_KEY);
    if (raw == null) return LAMP_ALL;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= LAMP_ALL) return value;
  } catch {
    // Session memory is optional.
  }
  return LAMP_ALL;
}

function writeLamps(value: number) {
  try {
    window.sessionStorage.setItem(VAULT_LAMPS_KEY, String(value));
  } catch {
    // Session memory is optional.
  }
}

function readLit(): boolean {
  try {
    return window.sessionStorage.getItem(VAULT_LIT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLit() {
  try {
    window.sessionStorage.setItem(VAULT_LIT_KEY, "1");
  } catch {
    // Session memory is optional; the vault still opens.
  }
}

function clearLit() {
  try {
    window.sessionStorage.removeItem(VAULT_LIT_KEY);
  } catch {
    // Session memory is optional; the vault still locks.
  }
}

function folderLabel(path: string | null) {
  if (!path) {
    return "No folder yet";
  }
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function VaultRoom({
  projects,
  workspace,
  loading,
  notice,
  onOpen,
  onCreate,
  onImport,
  onDelete,
  onSettings,
}: {
  projects: BookProject[];
  workspace: string | null;
  loading: boolean;
  notice: string | null;
  onOpen: (project: BookProject) => void;
  onCreate: () => void;
  onImport: () => void;
  onDelete: (project: BookProject) => void;
  onSettings: () => void;
}) {
  const [state, setState] = useState<VaultState>(() => (readLit() ? "open" : "lock"));
  const [lamps, setLamps] = useState(readLamps);
  const [picked, setPicked] = useState<BookProject | null>(null);
  const slots = Math.max(COLUMNS * VISIBLE_ROWS, Math.ceil(projects.length / COLUMNS) * COLUMNS);
  const lit = state !== "lock";
  const lampsAllOn = lamps === LAMP_ALL;

  function setLampMask(next: number) {
    const value = next & LAMP_ALL;
    writeLamps(value);
    setLamps(value);
  }

  function toggleLamp(index: number) {
    setLampMask(lamps ^ (1 << index));
  }

  function toggleAllLamps() {
    setLampMask(lampsAllOn ? 0 : LAMP_ALL);
  }
  const occupied = useMemo(
    () => occupiedMask(Array.from({ length: COLUMNS * VISIBLE_ROWS }, (_, index) => Boolean(projects[index]))),
    [projects],
  );
  const peakLight = useMemo(() => peakSlotEnergy(), []);

  function enter() {
    writeLit();
    setState("open");
  }

  function leave() {
    clearLit();
    setPicked(null);
    setState("lock");
  }

  return (
    <section
      className="vault"
      data-lit={lit ? "true" : "false"}
      data-state={state}
      data-lamps={lamps}
      data-overflow={projects.length > VISIBLE_ROWS * COLUMNS ? "true" : "false"}
      aria-label={lit ? "Your workspace" : "Kosmos"}
    >
      <div className="vault-shell">
        <div className="vault-opening">
          <VaultLighting lit={lit} occupied={occupied} lamps={lamps} />
          <div className="vault-stage">
            <div className="vault-world">
              <div className="vault-ceiling" aria-hidden="true">
                <VaultPigment salt={0xce11} />
                <span className="vault-spots">
                  {Array.from({ length: 5 }, (_, index) => (
                    <span className="vault-spot-unit" key={index} data-on={((lamps >> index) & 1) === 1 ? "true" : "false"}>
                      <i className="vault-spot-trim" />
                      <i className="vault-spot-bowl" />
                      <i className="vault-spot-lens" />
                    </span>
                  ))}
                </span>
                <span className="vault-join vault-join-ceiling" />
              </div>
              <span className="vault-volume" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <i
                    className="vault-shaft"
                    key={index}
                    style={{ "--splay": `${(index - 2) * 4}deg` } as CSSProperties}
                  />
                ))}
              </span>
              <div className="vault-floor" aria-hidden="true">
                <VaultPigment salt={0xf100} />
                <span className="vault-floor-sheen" />
                <span className="vault-join vault-join-floor" />
              </div>
              <div className="vault-wall vault-wall-l" aria-hidden="true">
                <VaultPigment salt={0x5a1e} />
                <span className="vault-join vault-join-wall" />
              </div>
              <div className="vault-wall vault-wall-r" aria-hidden="true">
                <VaultPigment salt={0x5a1f} />
                <span className="vault-join vault-join-wall" />
              </div>
              <div className="vault-back">
                <VaultPigment salt={0xbac} />
                <span className="vault-join vault-join-back" />
                <div className="vault-grid-scroll">
                  {loading ? (
                    <p className="vault-loading">Loading your workspace…</p>
                  ) : (
                    <div className="vault-grid">
                      {Array.from({ length: slots }, (_, index) => {
                        const project = projects[index];
                        return (
                          <VaultSlot
                            key={project?.id ?? `empty-${index}`}
                            project={project}
                            index={index}
                            peakLight={peakLight}
                            lamps={lamps}
                            interactive={state === "open"}
                            onSelect={() => project && setPicked(project)}
                            onDelete={() => project && onDelete(project)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="vault-reveal" aria-hidden="true">
          <span className="vault-reveal-t" />
          <span className="vault-reveal-b" />
          <span className="vault-reveal-l" />
          <span className="vault-reveal-r" />
        </div>
        <div className="vault-jamb" aria-hidden="true" />

        <div className="vault-pane" aria-hidden="true">
          <span className="vault-pane-glass" />
          <span className="vault-pane-edge" />
        </div>

        {state === "lock" ? (
          <div className="vault-glass" aria-hidden="true">
            <span className="vault-glass-frost" />
            <span className="vault-glass-specular" />
            <span className="vault-glass-grain" />
          </div>
        ) : null}

        <div className="vault-chrome">
          {state === "lock" ? (
            <div className="vault-lock">
              <GlassButton variant="frost" settings={frostSettings} className="vault-enter" type="button" onClick={enter}>
                Enter workspace
              </GlassButton>
            </div>
          ) : null}
        </div>

        {state === "open" ? (
          <>
            <div className="vault-open-copy">
              <h1 className="vault-title">Your workspace</h1>
              <div className="vault-open-row">
                <p className="vault-meta">
                  <span>
                    {loading
                      ? "Loading"
                      : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
                  </span>
                </p>
                <button
                  type="button"
                  className="vault-place"
                  title={workspace ?? undefined}
                  aria-label={workspace ? `Workspace folder ${workspace}` : "No workspace folder yet"}
                >
                  <FolderGlyph />
                  <span className="vault-place-name">{folderLabel(workspace)}</span>
                  {workspace ? <span className="vault-place-path">{workspace}</span> : null}
                </button>
              </div>
            </div>
            <div className="vault-lamp-dock" role="toolbar" aria-label="Gallery lights">
              <button
                type="button"
                className="vault-lamp-all"
                aria-pressed={lampsAllOn}
                onClick={toggleAllLamps}
              >
                All
              </button>
              <span className="vault-dock-rule" aria-hidden="true" />
              {Array.from({ length: 5 }, (_, index) => {
                const on = ((lamps >> index) & 1) === 1;
                return (
                  <button
                    key={index}
                    type="button"
                    className="vault-lamp-pip"
                    data-on={on ? "true" : "false"}
                    aria-label={`Light ${index + 1}`}
                    aria-pressed={on}
                    onClick={() => toggleLamp(index)}
                  />
                );
              })}
            </div>
            <div className="vault-dock" role="toolbar" aria-label="Workspace">
              <button type="button" className="vault-dock-btn" aria-label="Lock workspace" onClick={leave}>
                <LockGlyph />
              </button>
              <span className="vault-dock-rule" aria-hidden="true" />
              <button type="button" className="vault-dock-btn" aria-label="Create project" onClick={onCreate}>
                <PlusGlyph />
              </button>
              <span className="vault-dock-rule" aria-hidden="true" />
              <button type="button" className="vault-dock-btn" aria-label="Import project" onClick={onImport}>
                <FolderGlyph />
              </button>
              <span className="vault-dock-rule" aria-hidden="true" />
              <button type="button" className="vault-dock-btn" aria-label="Settings" onClick={onSettings}>
                <GearGlyph />
              </button>
            </div>
          </>
        ) : null}
      </div>

      {notice ? <p className="vault-note">{notice}</p> : null}

      {picked ? (
        <BookDetail
          project={picked}
          onClose={() => setPicked(null)}
          onOpen={() => {
            const project = picked;
            setPicked(null);
            onOpen(project);
          }}
          onDelete={() => {
            const project = picked;
            setPicked(null);
            onDelete(project);
          }}
        />
      ) : null}
    </section>
  );
}
function VaultSlot({
  project,
  index,
  peakLight,
  lamps,
  interactive,
  onSelect,
  onDelete,
}: {
  project?: BookProject;
  index: number;
  peakLight: number;
  lamps: number;
  interactive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const row = Math.floor(index / COLUMNS);
  const col = index % COLUMNS;
  const light = slotLight(row, col, 0.5808, lamps);
  const progress = project ? completionPct(project) : 0;

  return (
    <div
      className={project ? "vault-slot" : "vault-slot is-empty"}
      data-row={row}
      data-col={col}
      style={
        {
          "--irr": Math.min(1.35, light.irr / Math.max(peakLight, 1e-6)),
          "--cover-irr": Math.min(1.4, light.cover / Math.max(peakLight, 1e-6)),
          "--key-x": light.keyX,
        } as CSSProperties
      }
    >
      <div className="vault-niche">
        <span className="vault-niche-well" aria-hidden="true">
          <i className="vault-niche-ceil" />
          <i className="vault-niche-l" />
          <i className="vault-niche-r" />
          <i className="vault-niche-floor" />
        </span>
        {project ? (
          <div className="vault-book">
            <span className="vault-book-spine" aria-hidden="true" />
            <button
              type="button"
              className="vault-cover"
              disabled={!interactive}
              onClick={onSelect}
              aria-label={`${project.title}, ${progress}% complete`}
            >
              <VaultCoverArt project={project} />
              <span className="vault-cover-shade" />
              <span className="vault-cover-edge" />
            </button>
          </div>
        ) : null}
      </div>
      {interactive && project ? (
        <button type="button" className="vault-remove" aria-label={`Remove ${project.title}`} onClick={onDelete}>
          <RemoveGlyph />
        </button>
      ) : null}
    </div>
  );
}

function VaultCoverArt({ project }: { project: BookProject }) {
  if (project.coverDataUrl) {
    return <img src={project.coverDataUrl} alt="" className="vault-cover-img" />;
  }
  return (
    <span className="vault-cover-gen">
      <span className="vault-cover-initials">{bookInitials(project)}</span>
      <span className="vault-cover-gen-title">{project.title}</span>
    </span>
  );
}

function BookDetail({
  project,
  onClose,
  onOpen,
  onDelete,
}: {
  project: BookProject;
  onClose: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const progress = completionPct(project);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="vault-sheet-scrim" role="presentation" onClick={onClose}>
      <article
        className="vault-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vault-sheet-book" aria-hidden="true">
          <span className="vault-sheet-spine" />
          <span className="vault-sheet-page" />
          <span className="vault-sheet-front">
            <VaultCoverArt project={project} />
          </span>
        </div>
        <div className="vault-sheet-copy">
          <h2 className="vault-sheet-title" id="vault-sheet-title">
            {project.title}
          </h2>
          <p className="vault-sheet-author">{project.author.trim() || "Unknown author"}</p>
          <dl className="vault-sheet-meta">
            <div>
              <dt>Completion</dt>
              <dd>{progress}%</dd>
            </div>
            <div>
              <dt>Chapters</dt>
              <dd>{project.chapters.length}</dd>
            </div>
          </dl>
          <div className="vault-sheet-actions">
            <GlassButton variant="frost" type="button" onClick={onOpen}>
              Open
            </GlassButton>
            <GlassButton variant="frost" type="button" onClick={onDelete}>
              Remove
            </GlassButton>
          </div>
        </div>
      </article>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <rect x="6" y="11" width="12" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 14.2v3.2M10.4 15.8h3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M4 8.2A1.7 1.7 0 0 1 5.7 6.5h4.1L12 8.6h6.3A1.7 1.7 0 0 1 20 10.3v6.5A1.7 1.7 0 0 1 18.3 18.5H5.7A1.7 1.7 0 0 1 4 16.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RemoveGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}