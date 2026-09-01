import { useEffect, useMemo, useRef, useState } from "react";
import { bookProgress, type BookProject } from "./store";
import { SHELF_COLUMNS_EVENT, readShelfColumns, type ShelfColumns } from "./shelf-prefs";
import { createShelfScene, type ShelfBook, type ShelfHover, type ShelfScene } from "./shelf-scene";

/**
 * The library wall: one continuous plaster mass with three ribbon niches carved
 * into it, lit from inside. The wall is a real three.js scene; everything the
 * user reads — the hovered title, the delete affordance — is HTML floated over
 * the canvas so type stays crisp and focusable.
 *
 * When WebGL is unavailable the caller falls back to the flat shelf.
 */
export function ShelfWall({
  projects,
  accentHex,
  onOpen,
  onDelete,
  onUnsupported,
}: {
  projects: BookProject[];
  accentHex: string;
  onOpen: (project: BookProject) => void;
  onDelete: (project: BookProject) => void;
  onUnsupported: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ShelfScene | null>(null);
  const [columns, setColumns] = useState<ShelfColumns>(() => readShelfColumns());
  const [hover, setHover] = useState<ShelfHover | null>(null);

  // Keep the callbacks the scene fires pointed at the latest props without
  // rebuilding the scene on every render.
  const handlers = useRef({ onOpen, onDelete, projects });
  handlers.current = { onOpen, onDelete, projects };

  const books = useMemo<ShelfBook[]>(
    () =>
      projects.map((project) => ({
        id: project.id,
        title: project.title,
        author: project.author,
        coverUrl: project.coverDataUrl,
        progress: bookProgress(project),
        completed: Boolean(project.completedAt),
      })),
    [projects],
  );

  useEffect(() => {
    function onColumns(event: Event) {
      setColumns((event as CustomEvent<ShelfColumns>).detail);
    }
    window.addEventListener(SHELF_COLUMNS_EVENT, onColumns);
    return () => window.removeEventListener(SHELF_COLUMNS_EVENT, onColumns);
  }, []);

  // Build once. Books, columns, and pigment are pushed in afterwards so a
  // setting change never tears the wall down and rebuilds it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let scene: ShelfScene;
    try {
      scene = createShelfScene({
        canvas,
        onOpen: (id) => {
          const project = handlers.current.projects.find((item) => item.id === id);
          if (project) {
            handlers.current.onOpen(project);
          }
        },
        onHover: (next) => setHover(next),
      });
    } catch {
      onUnsupported();
      return;
    }
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, [onUnsupported]);

  useEffect(() => {
    sceneRef.current?.setBooks(books);
  }, [books]);

  useEffect(() => {
    sceneRef.current?.setColumns(columns);
  }, [columns]);

  useEffect(() => {
    sceneRef.current?.setAccent(accentHex);
  }, [accentHex]);

  const hovered = hover ? projects.find((project) => project.id === hover.id) : null;

  return (
    <div className="ma-shelf" data-columns={columns}>
      <canvas ref={canvasRef} className="ma-shelf-canvas" aria-hidden="true" />

      {hovered && hover ? (
        <div
          className="ma-shelf-tag"
          style={{ left: `${hover.x}px`, top: `${hover.y}px` }}
          onPointerEnter={() => sceneRef.current?.holdHover(true)}
          onPointerLeave={() => sceneRef.current?.holdHover(false)}
        >
          <span className="ma-shelf-tag-title">{hovered.title}</span>
          {hovered.author ? <span className="ma-shelf-tag-author">{hovered.author}</span> : null}
          <button
            type="button"
            className="ma-shelf-tag-delete"
            aria-label={`Delete ${hovered.title}`}
            onClick={() => onDelete(hovered)}
          >
            <TrashIcon />
          </button>
        </div>
      ) : null}

      {/* The shelf is a picture; this list is what a screen reader walks. */}
      <ul className="ma-shelf-index">
        {projects.map((project) => (
          <li key={project.id}>
            <button type="button" className="ma-shelf-index-btn" onClick={() => onOpen(project)}>
              {project.title}
              {project.author ? <span className="ma-shelf-index-author">{project.author}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
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
