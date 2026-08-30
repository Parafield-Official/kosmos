import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { bookInitials, readChapterAudioUrl, type BookProject } from "./store";
import { completionPct } from "./book-stats";
import { VaultPigment } from "./ThemeAtmosphere";
import { VaultLighting } from "./VaultLighting";
import { occupiedMask, peakSlotEnergy, slotLight } from "./vault-light-layout";
import { readLamps } from "./vault-lamps";
import "./vault.css";

const COLUMNS = 5;
const VISIBLE_ROWS = 3;

type OriginBox = { x: number; y: number; w: number; h: number };

export function VaultRoom({
  projects,
  loading,
  notice,
  pane = "home",
  nav = "home",
  overlay = null,
  onOpen,
  onHome,
  onCreate,
  onImport,
  onDelete,
  onSettings,
  onRead,
}: {
  projects: BookProject[];
  loading: boolean;
  notice: string | null;
  pane?: "home" | "glass";
  nav?: "home" | "settings" | "none";
  overlay?: ReactNode;
  onOpen: (project: BookProject) => void;
  onHome: () => void;
  onCreate: () => void;
  onImport: () => void;
  onDelete: (project: BookProject) => void;
  onSettings: () => void;
  onRead: (project: BookProject) => void;
}) {
  const [lamps] = useState(readLamps);
  const [compose, setCompose] = useState(false);
  const [inspect, setInspect] = useState<{ project: BookProject; origin: OriginBox } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const slots = Math.max(COLUMNS * VISIBLE_ROWS, Math.ceil(projects.length / COLUMNS) * COLUMNS);
  const localSheet = compose || Boolean(inspect);
  const glassOn = pane === "glass" || localSheet;
  const interactive = pane === "home" && !localSheet;
  const occupied = useMemo(
    () => occupiedMask(Array.from({ length: COLUMNS * VISIBLE_ROWS }, (_, index) => Boolean(projects[index]))),
    [projects],
  );
  const peakLight = useMemo(() => peakSlotEnergy(), []);

  function closeSheets() {
    setCompose(false);
    setInspect(null);
  }

  function pickCreate() {
    closeSheets();
    onCreate();
  }

  function pickImport() {
    closeSheets();
    onImport();
  }

  useEffect(() => {
    closeSheets();
  }, [pane, nav]);

  useEffect(() => {
    if (!localSheet) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSheets();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [localSheet]);

  return (
    <section
      className="vault"
      data-lit="true"
      data-state="open"
      data-pane={glassOn ? "glass" : "home"}
      data-lamps={lamps}
      data-overflow={projects.length > VISIBLE_ROWS * COLUMNS ? "true" : "false"}
      aria-label="Your workspace"
    >
      <div className="vault-shell">
        <div className="vault-opening">
          <VaultLighting lit occupied={occupied} lamps={lamps} />
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
                            interactive={interactive}
                            lifted={inspect?.project.id === project?.id}
                            onSelect={(origin) => {
                              if (!project) {
                                return;
                              }
                              setCompose(false);
                              setInspect({ project, origin });
                            }}
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

        <div className="vault-glass" aria-hidden="true">
          <span className="vault-glass-frost" />
          <span className="vault-glass-specular" />
          <span className="vault-glass-grain" />
        </div>

        {overlay && !localSheet ? <div className="vault-overlay">{overlay}</div> : null}

        {compose ? (
          <div className="vault-sheet-layer" onClick={closeSheets}>
            <ComposePanel onCreate={pickCreate} onImport={pickImport} />
          </div>
        ) : null}

        {inspect ? (
          <InspectPanel
            project={inspect.project}
            origin={inspect.origin}
            onClose={closeSheets}
            onEdit={() => {
              const project = inspect.project;
              closeSheets();
              onOpen(project);
            }}
            onRead={() => {
              const project = inspect.project;
              closeSheets();
              onRead(project);
            }}
          />
        ) : null}

        <div className="vault-dock" ref={dockRef} role="toolbar" aria-label="Workspace">
          <button
            type="button"
            className="vault-dock-btn"
            aria-label="Home"
            aria-current={nav === "home" ? "page" : undefined}
            onClick={() => {
              closeSheets();
              onHome();
            }}
          >
            <HomeGlyph />
          </button>
          <span className="vault-dock-compose">
            <button
              type="button"
              className={compose ? "vault-dock-btn is-hot" : "vault-dock-btn"}
              aria-label="Add or import project"
              aria-haspopup="dialog"
              aria-expanded={compose}
              onClick={() => {
                setInspect(null);
                setCompose((open) => !open);
              }}
            >
              <PlusGlyph />
            </button>
          </span>
          <button
            type="button"
            className="vault-dock-btn vault-dock-btn-settings"
            aria-label="Settings"
            aria-current={nav === "settings" ? "page" : undefined}
            onClick={() => {
              closeSheets();
              onSettings();
            }}
          >
            <GearGlyph />
          </button>
        </div>
      </div>

      {notice ? <p className="vault-note">{notice}</p> : null}
    </section>
  );
}

function VaultSlot({
  project,
  index,
  peakLight,
  lamps,
  interactive,
  lifted,
  onSelect,
  onDelete,
}: {
  project?: BookProject;
  index: number;
  peakLight: number;
  lamps: number;
  interactive: boolean;
  lifted: boolean;
  onSelect: (origin: OriginBox) => void;
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
      data-lifted={lifted ? "true" : "false"}
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
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onSelect({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
              }}
              aria-label={`${project.title}, ${progress}% complete`}
            >
              <VaultCoverArt project={project} />
              <span className="vault-cover-shade" />
              <span className="vault-cover-edge" />
            </button>
            {interactive ? (
              <button
                type="button"
                className="vault-remove"
                aria-label={`Remove ${project.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <TrashGlyph />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
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

function ComposePanel({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div
      className="vault-chooser"
      role="dialog"
      aria-labelledby="vault-chooser-title"
      onClick={(event) => event.stopPropagation()}
    >
      <p className="vault-chooser-kicker" id="vault-chooser-title">
        Add to your shelf
      </p>
      <button type="button" className="vault-chooser-row" onClick={onCreate}>
        <span className="vault-chooser-icon" aria-hidden="true">
          <PlusGlyph />
        </span>
        <span className="vault-chooser-copy">
          <strong>New project</strong>
          <span>Start a book from a title, author, and manuscript.</span>
        </span>
      </button>
      <span className="vault-chooser-rule" aria-hidden="true" />
      <button type="button" className="vault-chooser-row" onClick={onImport}>
        <span className="vault-chooser-icon" aria-hidden="true">
          <FolderGlyph />
        </span>
        <span className="vault-chooser-copy">
          <strong>Import existing</strong>
          <span>Open a Kosmos project that’s already on this computer.</span>
        </span>
      </button>
    </div>
  );
}

function InspectPanel({
  project,
  origin,
  onClose,
  onEdit,
  onRead,
}: {
  project: BookProject;
  origin: OriginBox;
  onClose: () => void;
  onEdit: () => void;
  onRead: () => void;
}) {
  const coverRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [fly, setFly] = useState({ ...origin, tx: 0, ty: 0, sx: 1, sy: 1, go: false });
  const [landed, setLanded] = useState(false);
  const [listening, setListening] = useState(false);
  const progress = completionPct(project);
  const complete = project.chapters.length > 0 && project.chapters.every((chapter) => chapter.mastered);
  const canRead = project.chapters.length > 0;
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useLayoutEffect(() => {
    if (reduceMotion) {
      setLanded(true);
      return;
    }
    const target = coverRef.current?.getBoundingClientRect();
    if (!target) {
      setLanded(true);
      return;
    }
    setFly({
      x: origin.x,
      y: origin.y,
      w: origin.w,
      h: origin.h,
      tx: target.x - origin.x,
      ty: target.y - origin.y,
      sx: target.width / Math.max(origin.w, 1),
      sy: target.height / Math.max(origin.h, 1),
      go: false,
    });
    const frame = requestAnimationFrame(() => {
      setFly((current) => ({ ...current, go: true }));
    });
    const fallback = window.setTimeout(() => setLanded(true), 620);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [origin, reduceMotion]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  async function listen() {
    if (!complete || listening) {
      return;
    }
    const files = project.chapters.map((chapter) => chapter.masteredFile).filter((file): file is string => Boolean(file));
    if (!files.length) {
      return;
    }
    setListening(true);
    let index = 0;
    const playNext = async () => {
      const file = files[index];
      if (!file) {
        setListening(false);
        return;
      }
      const url = await readChapterAudioUrl(project, file);
      if (!url) {
        index += 1;
        await playNext();
        return;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        index += 1;
        void playNext();
      });
      try {
        await audio.play();
      } catch {
        URL.revokeObjectURL(url);
        setListening(false);
      }
    };
    await playNext();
  }

  return (
    <div className="vault-sheet-layer" onClick={onClose}>
      {!landed ? (
        <div
          className={fly.go ? "vault-inspect-fly is-go" : "vault-inspect-fly"}
          style={
            {
              "--x": `${fly.x}px`,
              "--y": `${fly.y}px`,
              "--w": `${fly.w}px`,
              "--h": `${fly.h}px`,
              "--tx": `${fly.tx}px`,
              "--ty": `${fly.ty}px`,
              "--sx": fly.sx,
              "--sy": fly.sy,
            } as CSSProperties
          }
          onTransitionEnd={() => setLanded(true)}
        >
          <VaultCoverArt project={project} />
        </div>
      ) : null}
      <article
        className={landed || reduceMotion ? "vault-inspect is-in" : "vault-inspect"}
        role="dialog"
        aria-labelledby="vault-inspect-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vault-inspect-cover" ref={coverRef} data-landed={landed ? "true" : "false"}>
          <VaultCoverArt project={project} />
        </div>
        <div className="vault-inspect-copy">
          <h2 className="vault-inspect-title" id="vault-inspect-title">
            {project.title}
          </h2>
          <p className="vault-inspect-author">{project.author.trim() || "Unknown author"}</p>
          <div className="vault-inspect-meter" aria-label={`${progress}% complete`}>
            <span className="vault-inspect-meter-track">
              <i style={{ width: `${progress}%` }} />
            </span>
            <span className="vault-inspect-meter-label">{progress}% complete</span>
          </div>
          <div className="vault-inspect-actions">
            <button type="button" className="vault-inspect-btn" onClick={onEdit}>
              <EditGlyph />
              <span>Edit</span>
            </button>
            <button
              type="button"
              className="vault-inspect-btn"
              aria-disabled={!complete}
              disabled={!complete}
              onClick={() => void listen()}
            >
              <ListenGlyph />
              <span>{listening ? "Playing" : "Listen"}</span>
            </button>
            <button type="button" className="vault-inspect-btn" disabled={!canRead} onClick={onRead}>
              <ReadGlyph />
              <span>Read</span>
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function HomeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.4 11.2 12 4.7l7.6 6.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.6 10.4V19h10.8v-8.6" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.2A1.7 1.7 0 0 1 5.7 6.5h4.1L12 8.6h6.3A1.7 1.7 0 0 1 20 10.3v6.5A1.7 1.7 0 0 1 18.3 18.5H5.7A1.7 1.7 0 0 1 4 16.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13.4 6.4 17.6 10.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ListenGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M7 12.2v3.1a1.6 1.6 0 0 0 1.6 1.6H10V12.2H7ZM17 12.2h-3v4.7h1.4A1.6 1.6 0 0 0 17 15.3v-3.1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 6.2A1.4 1.4 0 0 1 5.9 5h4.2c.7 0 1.4.6 1.4 1.4V19a2.2 2.2 0 0 0-2-1.4H5.9A1.4 1.4 0 0 1 4.5 16.2V6.2Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
      <path
        d="M19.5 6.2A1.4 1.4 0 0 0 18.1 5h-2.6c-.7 0-1.4.6-1.4 1.4V19a2.2 2.2 0 0 1 2-1.4h2A1.4 1.4 0 0 0 19.5 16.2V6.2Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M10 7V5.4A1.4 1.4 0 0 1 11.4 4h1.2A1.4 1.4 0 0 1 14 5.4V7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 7l.65 12.1A1.6 1.6 0 0 0 10.44 20.5h3.12a1.6 1.6 0 0 0 1.59-1.4L15.8 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10.2 10.6v6M13.8 10.6v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}