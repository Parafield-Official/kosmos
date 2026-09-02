import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { bookInitials, type BookProject } from "./store";
import { completionPct } from "./book-stats";
import { VaultPigment } from "./ThemeAtmosphere";
import { VaultLighting } from "./VaultLighting";
import { occupiedMask, peakSlotEnergy, slotLight } from "./vault-light-layout";
import { readLamps, VAULT_LAMPS_EVENT } from "./vault-lamps";
import { VaultListenSheet, VaultReadSheet } from "./vault-media";
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
  createSheet = null,
  onOpen,
  onHome,
  onCreate,
  onImport,
  onSettings,
  onCreateClose,
}: {
  projects: BookProject[];
  loading: boolean;
  notice: string | null;
  pane?: "home" | "glass";
  nav?: "home" | "settings" | "none";
  overlay?: ReactNode;
  createSheet?: ReactNode;
  onOpen: (project: BookProject) => void;
  onHome: () => void;
  onCreate: () => void;
  onImport: () => void;
  onSettings: () => void;
  onCreateClose?: () => void;
}) {
  const [lamps, setLamps] = useState(readLamps);
  const [compose, setCompose] = useState(false);
  const [inspect, setInspect] = useState<{ project: BookProject; origin: OriginBox } | null>(null);
  const [inspectView, setInspectView] = useState<"card" | "read" | "listen">("card");
  const dockRef = useRef<HTMLDivElement>(null);
  const slots = Math.max(COLUMNS * VISIBLE_ROWS, Math.ceil(projects.length / COLUMNS) * COLUMNS);
  const localSheet = compose || Boolean(inspect) || Boolean(createSheet);
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
    setInspectView("card");
  }

  function pickCreate() {
    void onCreate();
  }

  function pickImport() {
    closeSheets();
    onImport();
  }

  useEffect(() => {
    closeSheets();
    onCreateClose?.();
  }, [pane, nav]);

  useEffect(() => {
    if (createSheet) {
      setCompose(false);
    }
  }, [createSheet]);

  useEffect(() => {
    function onLamps() {
      setLamps(readLamps());
    }
    window.addEventListener(VAULT_LAMPS_EVENT, onLamps);
    return () => window.removeEventListener(VAULT_LAMPS_EVENT, onLamps);
  }, []);

  useEffect(() => {
    setInspect((current) => {
      if (!current) {
        return current;
      }
      const next = projects.find((project) => project.id === current.project.id);
      return next ? { ...current, project: next } : null;
    });
  }, [projects]);

  useEffect(() => {
    if (!localSheet) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (inspect && inspectView !== "card") {
        setInspectView("card");
        return;
      }
      if (createSheet) {
        onCreateClose?.();
        return;
      }
      closeSheets();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [localSheet, inspect, inspectView, createSheet]);

  return (
    <section
      className="vault"
      data-lit="true"
      data-state="open"
      data-pane={glassOn ? "glass" : "home"}
      data-lamps={lamps}
      data-overflow={projects.length > VISIBLE_ROWS * COLUMNS ? "true" : "false"}
      aria-label="Your workspace"
      style={
        {
          "--lamp-0": (lamps >> 0) & 1,
          "--lamp-1": (lamps >> 1) & 1,
          "--lamp-2": (lamps >> 2) & 1,
          "--lamp-3": (lamps >> 3) & 1,
          "--lamp-4": (lamps >> 4) & 1,
          "--lamp-count":
            ((lamps >> 0) & 1) + ((lamps >> 1) & 1) + ((lamps >> 2) & 1) + ((lamps >> 3) & 1) + ((lamps >> 4) & 1),
        } as CSSProperties
      }
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
                    data-on={((lamps >> index) & 1) === 1 ? "true" : "false"}
                    style={{ "--splay": `${(index - 2) * 4}deg` } as CSSProperties}
                  />
                ))}
              </span>
              <span className="vault-pools" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <i
                    className="vault-pool"
                    key={index}
                    data-on={((lamps >> index) & 1) === 1 ? "true" : "false"}
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
                              setInspectView("card");
                              setInspect({ project, origin });
                            }}
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

        {compose && !createSheet ? (
          <div className="vault-sheet-layer" onClick={closeSheets}>
            <ComposePanel onCreate={pickCreate} onImport={pickImport} />
          </div>
        ) : null}

        {createSheet ? (
          <div className="vault-sheet-layer" onClick={() => onCreateClose?.()}>
            {createSheet}
          </div>
        ) : null}

        {inspect ? (
          <>
            <div className={inspectView === "card" ? undefined : "vault-sheet-park"}>
              <InspectPanel
                key={inspect.project.id}
                project={inspect.project}
                origin={inspect.origin}
                onClose={closeSheets}
                onEdit={() => {
                  const project = inspect.project;
                  closeSheets();
                  onOpen(project);
                }}
                onRead={() => setInspectView("read")}
                onListen={() => setInspectView("listen")}
              />
            </div>
            {inspectView === "read" ? (
              <VaultReadSheet
                project={inspect.project}
                onBack={() => setInspectView("card")}
              />
            ) : null}
            {inspectView === "listen" ? (
              <VaultListenSheet
                seed={inspect.project}
                library={projects}
                renderCover={(project) => <VaultCoverArt project={project} />}
                onBack={() => setInspectView("card")}
              />
            ) : null}
          </>
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
          <span className="vault-dock-rule" aria-hidden="true" />
          <span className="vault-dock-compose">
            <button
              type="button"
              className={compose ? "vault-dock-btn is-hot" : "vault-dock-btn"}
              aria-label="Add or import project"
              aria-haspopup="dialog"
              aria-expanded={compose}
              onClick={() => {
                setInspect(null);
                setInspectView("card");
                setCompose((open) => !open);
              }}
            >
              <PlusGlyph />
            </button>
          </span>
          <span className="vault-dock-rule" aria-hidden="true" />
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
}: {
  project?: BookProject;
  index: number;
  peakLight: number;
  lamps: number;
  interactive: boolean;
  lifted: boolean;
  onSelect: (origin: OriginBox) => void;
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
      data-col-lit={((lamps >> col) & 1) === 1 ? "true" : "false"}
      data-lifted={lifted ? "true" : "false"}
      style={
        {
          "--irr": Math.min(1.35, light.irr / Math.max(peakLight, 1e-6)),
          "--cover-irr": Math.min(1.4, light.cover / Math.max(peakLight, 1e-6)),
          "--key-x": light.keyX,
          "--col-lit": (lamps >> col) & 1,
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
  onListen,
}: {
  project: BookProject;
  origin: OriginBox;
  onClose: () => void;
  onEdit: () => void;
  onRead: () => void;
  onListen: () => void;
}) {
  const coverRef = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState({ ...origin, tx: 0, ty: 0, sx: 1, sy: 1, go: false });
  const [landed, setLanded] = useState(false);
  const progress = completionPct(project);
  const canListen =
    project.chapters.length > 0 && project.chapters.every((chapter) => chapter.mastered && Boolean(chapter.masteredFile));
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
    setLanded(false);
    const target = coverRef.current?.getBoundingClientRect();
    if (!target || target.width < 2 || target.height < 2) {
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
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setFly((current) => ({ ...current, go: true }));
      });
    });
    const fallback = window.setTimeout(() => setLanded(true), 680);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(fallback);
    };
  }, [origin, reduceMotion]);

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
          onTransitionEnd={(event) => {
            if (event.propertyName === "transform") {
              setLanded(true);
            }
          }}
        >
          <VaultCoverArt project={project} />
        </div>
      ) : null}
      <article
        className={fly.go || landed || reduceMotion ? "vault-inspect is-in" : "vault-inspect"}
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
            <button type="button" className="vault-inspect-btn" disabled={!canListen} onClick={onListen}>
              <ListenGlyph />
              <span>Listen</span>
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
        strokeWidth="2.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.6 10.4V19h10.8v-8.6" stroke="currentColor" strokeWidth="2.15" strokeLinejoin="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2.15" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="2.15"
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
