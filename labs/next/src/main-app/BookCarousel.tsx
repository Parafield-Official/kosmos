import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { bookProgress, type BookProject } from "./store";

/** Slides shown on each side of the centred book before they fade out. */
const SIDE = 3;

/**
 * A rotatable coverflow of the user's books. The centred book is the stage: it
 * is a real 3D object you can turn with the cursor, and clicking it opens the
 * book. Books to either side recede and dim. A horizontal tick meter under the
 * stage mirrors the same position — scrub or click it to move through the shelf.
 */
export function BookCarousel({
  projects,
  onOpen,
  onDelete,
}: {
  projects: BookProject[];
  onOpen: (project: BookProject) => void;
  onDelete: (project: BookProject) => void;
}) {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const clampIndex = useCallback(
    (index: number) => Math.max(0, Math.min(projects.length - 1, index)),
    [projects.length],
  );

  useEffect(() => {
    setActive((current) => clampIndex(current));
  }, [clampIndex]);

  const move = useCallback(
    (direction: number) => setActive((current) => clampIndex(current + direction)),
    [clampIndex],
  );

  // Wheel over the carousel steps one book per gesture, without scrolling the page.
  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    let last = 0;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 4) {
        return;
      }
      event.preventDefault();
      const now = Date.now();
      if (now - last < 130) {
        return;
      }
      last = now;
      move(delta > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [move]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      setActive(0);
    } else if (event.key === "End") {
      setActive(projects.length - 1);
    }
  };

  const activeProject = projects[active];

  return (
    <div
      className="ma-carousel"
      ref={rootRef}
      tabIndex={0}
      role="listbox"
      aria-label="Your books"
      aria-activedescendant={activeProject ? `ma-slide-${activeProject.id}` : undefined}
      onKeyDown={onKeyDown}
    >
      <Scrubber className="ma-carousel-stage" active={active} onScrub={(index) => setActive(clampIndex(index))} stepPx={150}>
        {projects.map((project, index) => {
          const delta = index - active;
          const abs = Math.abs(delta);
          if (abs > SIDE + 1) {
            return null;
          }
          return (
            <Slide
              key={project.id}
              project={project}
              delta={delta}
              isCenter={delta === 0}
              onOpen={() => onOpen(project)}
              onFocusBook={() => setActive(index)}
              onDelete={() => onDelete(project)}
            />
          );
        })}
      </Scrubber>

      <BookMeter projects={projects} active={active} onPick={(index) => setActive(clampIndex(index))} />
    </div>
  );
}

/**
 * A pointer-draggable region. Dragging horizontally scrubs the active index;
 * a click that never turned into a drag is passed through to the children.
 */
function Scrubber({
  className,
  active,
  onScrub,
  stepPx,
  children,
}: {
  className: string;
  active: number;
  onScrub: (index: number) => void;
  stepPx: number;
  children: ReactNode;
}) {
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, start: active, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    const dx = event.clientX - state.x;
    if (Math.abs(dx) > 6) {
      state.moved = true;
    }
    onScrub(state.start - Math.round(dx / stepPx));
  };
  const end = () => {
    const state = drag.current;
    // Keep "moved" readable for one tick so a click handler can ignore drags.
    if (state) {
      window.setTimeout(() => {
        drag.current = null;
      }, 0);
      drag.current = { ...state };
    }
  };

  return (
    <div
      className={className}
      data-dragging={drag.current?.moved ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      onClickCapture={(event) => {
        if (drag.current?.moved) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}

function Slide({
  project,
  delta,
  isCenter,
  onOpen,
  onFocusBook,
  onDelete,
}: {
  project: BookProject;
  delta: number;
  isCenter: boolean;
  onOpen: () => void;
  onFocusBook: () => void;
  onDelete: () => void;
}) {
  const abs = Math.abs(delta);
  const hidden = abs > SIDE;
  const progress = Math.round(bookProgress(project) * 100);
  const [tilt, setTilt] = useState<{ rx: number; ry: number } | null>(null);

  // Rest orientation: the centred book shows a hint of its spine; side books
  // turn toward the middle so their depth reads.
  const restRy = isCenter ? -13 : delta < 0 ? 32 : -32;
  const restRx = isCenter ? 6 : 3;
  const ry = tilt ? tilt.ry : restRy;
  const rx = tilt ? tilt.rx : restRx;

  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isCenter) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ ry: restRy + px * 52, rx: restRx - py * 34 });
  };

  const style = {
    "--d": delta,
    "--abs": abs,
    "--rx": `${rx.toFixed(1)}deg`,
    "--ry": `${ry.toFixed(1)}deg`,
    opacity: hidden ? 0 : abs === SIDE ? 0.34 : 1,
    zIndex: 100 - abs,
    pointerEvents: hidden ? "none" : "auto",
  } as CSSProperties;

  return (
    <div
      id={`ma-slide-${project.id}`}
      className={`ma-carousel-slide${isCenter ? " is-center" : ""}`}
      style={style}
      role="option"
      aria-selected={isCenter}
      aria-hidden={hidden || undefined}
    >
      <button
        type="button"
        className="ma-slide-hit"
        tabIndex={isCenter ? 0 : -1}
        aria-label={isCenter ? `Open ${project.title}` : `Show ${project.title}`}
        onClick={() => (isCenter ? onOpen() : onFocusBook())}
        onPointerMove={onMove}
        onPointerLeave={() => setTilt(null)}
      >
        <span className="ma-book3d" style={{ "--rx": `${rx}deg`, "--ry": `${ry}deg` } as CSSProperties}>
          <span className="ma-face ma-face-front">
            <span className="ma-book-cover">
              {project.coverDataUrl ? (
                <img src={project.coverDataUrl} alt="" className="ma-book-art" />
              ) : (
                <GeneratedCover project={project} />
              )}
              {project.completedAt ? (
                <span className="ma-book-badge ma-badge-done">Completed</span>
              ) : null}
              {progress > 0 && progress < 100 ? (
                <span className="ma-book-progress" aria-hidden="true">
                  <span className="ma-book-progress-fill" style={{ width: `${progress}%` }} />
                </span>
              ) : null}
            </span>
          </span>
          <span className="ma-face ma-face-back" />
          <span className="ma-face ma-face-spine">
            <span className="ma-spine-title">{project.title}</span>
          </span>
          <span className="ma-face ma-face-fore" />
          <span className="ma-face ma-face-top" />
          <span className="ma-face ma-face-bottom" />
        </span>
      </button>

      {isCenter ? (
        <button type="button" className="ma-slide-delete" aria-label={`Delete ${project.title}`} onClick={onDelete}>
          <TrashIcon />
        </button>
      ) : null}
      <span className="ma-slide-veil" aria-hidden="true" />
    </div>
  );
}

/** The horizontal ridge under the stage. The bar over the centred book is the
 *  peak; height falls away to each side. Scrub or click it to move the shelf. */
function BookMeter({
  projects,
  active,
  onPick,
}: {
  projects: BookProject[];
  active: number;
  onPick: (index: number) => void;
}) {
  const activeProject = projects[active];
  return (
    <div className="ma-meter">
      <div className="ma-meter-title" key={activeProject?.id}>
        {activeProject?.title}
      </div>
      <Scrubber className="ma-meter-window" active={active} onScrub={onPick} stepPx={26}>
        <div className="ma-meter-track" style={{ "--active": active } as CSSProperties}>
          {projects.map((project, index) => {
            const dist = Math.abs(index - active);
            const height = Math.exp(-(dist * dist) / (2 * 3.4 * 3.4)); // mountain, peak at active
            return (
              <button
                key={project.id}
                type="button"
                className="ma-meter-tick"
                data-on={index === active ? "" : undefined}
                style={{ "--h": height.toFixed(3) } as CSSProperties}
                aria-label={project.title}
                title={project.title}
                onClick={() => onPick(index)}
              >
                <span className="ma-meter-bar" />
              </button>
            );
          })}
        </div>
      </Scrubber>
    </div>
  );
}

/** A themed text cover for books without artwork. */
function GeneratedCover({ project }: { project: BookProject }) {
  return (
    <span className="ma-book-gen">
      <span className="ma-book-gen-mark" aria-hidden="true">
        <KosmosGlyph />
      </span>
      <span className="ma-book-gen-title">{project.title}</span>
      <span className="ma-book-gen-author">{project.author || "Unknown author"}</span>
    </span>
  );
}

function KosmosGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="2.3" fill="currentColor" />
      <path d="M4.2 12a7.8 7.8 0 0 1 11.8-6.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19.8 12a7.8 7.8 0 0 1-11.8 6.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M7 7l.8 12.2A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.8L17 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
