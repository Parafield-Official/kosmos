import { useCallback, useEffect, useRef, useState } from "react";
import {
  bookProgress,
  createBook,
  deleteBook,
  getWorkspacePath,
  linkExternal,
  loadProjects,
  moveIntoWorkspace,
  openBook,
  persistBook,
  saveProject,
  writeManuscript,
  type BookProject,
} from "./store";
import { NewProjectDialog } from "./NewProjectDialog";

export function LibraryScreen({
  onOpen,
  onCreated,
}: {
  onOpen: (project: BookProject) => void;
  onCreated: (project: BookProject, file?: File) => void;
}) {
  const [projects, setProjects] = useState<BookProject[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [externalPrompt, setExternalPrompt] = useState<BookProject | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(shelfRef);
  const hasBridge = Boolean(window.kosmosNext?.listProjects);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, ws] = await Promise.all([loadProjects(), getWorkspacePath()]);
    setProjects(list);
    setWorkspace(ws);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onWorkspaceChanged() {
      void refresh();
    }
    window.addEventListener("kosmos-workspace-changed", onWorkspaceChanged);
    return () => window.removeEventListener("kosmos-workspace-changed", onWorkspaceChanged);
  }, [refresh]);

  /** Make sure a workspace folder exists before creating a book. */
  async function ensureWorkspace(): Promise<boolean> {
    if (!hasBridge || workspace) {
      return true;
    }
    if (window.kosmosNext?.requestFolderAccess) {
      const result = await window.kosmosNext.requestFolderAccess();
      if (result.granted) {
        await refresh();
        return true;
      }
      return false;
    }
    return true;
  }

  async function startNewBook() {
    if (await ensureWorkspace()) {
      setDialogOpen(true);
    }
  }

  async function openExisting() {
    if (hasBridge) {
      const result = await openBook();
      if (result.project && result.external) {
        setExternalPrompt(result.project);
      } else if (result.project) {
        onOpen(result.project);
      } else if (result.invalid) {
        setNotice("That folder isn’t a Kosmos project (no project.json).");
      }
      return;
    }
    importRef.current?.click();
  }

  function importExisting(file: File | undefined) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BookProject;
        if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.chapters)) {
          return;
        }
        saveProject(parsed);
        onOpen(parsed);
      } catch {
        // Ignore malformed files.
      }
    };
    reader.readAsText(file);
  }

  return (
    <section className="ma-screen ma-library" aria-label="Your books">
      <header className="ma-library-head">
        <div>
          <h1 className="ma-title">Your books</h1>
          {workspace ? <p className="ma-workspace-path" title={workspace}>{workspace}</p> : null}
        </div>
        <div className="ma-library-actions">
          <button type="button" className="btn" onClick={() => void openExisting()}>
            Open existing
          </button>
          <button type="button" className="btn btn-clear" onClick={() => void startNewBook()}>
            New book
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="ma-visually-hidden"
            onChange={(event) => importExisting(event.target.files?.[0])}
          />
        </div>
      </header>

      {notice ? <p className="ma-note">{notice}</p> : null}

      {loading ? (
        <div className="ma-empty">
          <p className="ma-empty-copy">Loading your workspace…</p>
        </div>
      ) : projects.length === 0 ? (
        <EmptyShelf onCreate={() => void startNewBook()} />
      ) : (
        <div className="ma-shelf" role="list" ref={shelfRef}>
          {chunk(projects, columns).map((row, rowIndex) => (
            <div className="ma-shelf-row" key={rowIndex}>
              <div className="ma-shelf-stage">
                <div className="ma-shelf-rig">
                  <div
                    className="ma-shelf-books"
                    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                  >
                    {row.map((project) => (
                      <BookCard
                        key={project.id}
                        project={project}
                        onOpen={() => onOpen(project)}
                        onDelete={async () => {
                          await deleteBook(project);
                          await refresh();
                        }}
                      />
                    ))}
                  </div>
                  <div className="ma-shelf-plank" aria-hidden="true">
                    <span className="ma-shelf-top" />
                    <span className="ma-shelf-front" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialogOpen ? (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={async (input) => {
            setDialogOpen(false);
            try {
              let project = await createBook({
                title: input.title,
                author: input.author,
                coverDataUrl: input.coverDataUrl,
              });
              if (input.manuscript) {
                const name = await writeManuscript(project.folder, input.manuscript);
                if (name) {
                  project = await persistBook({ ...project, manuscript: name });
                }
              }
              onCreated(project, input.manuscript);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not create the book.");
            }
          }}
        />
      ) : null}

      {externalPrompt ? (
        <ExternalPrompt
          project={externalPrompt}
          onClose={() => setExternalPrompt(null)}
          onMove={async () => {
            const moved = await moveIntoWorkspace(externalPrompt);
            setExternalPrompt(null);
            onOpen(moved ?? externalPrompt);
          }}
          onKeep={async () => {
            const linked = await linkExternal(externalPrompt);
            setExternalPrompt(null);
            onOpen(linked);
          }}
        />
      ) : null}
    </section>
  );
}

function ExternalPrompt({
  project,
  onMove,
  onKeep,
  onClose,
}: {
  project: BookProject;
  onMove: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ma-scrim" role="dialog" aria-modal="true" aria-label="Book outside workspace" onClick={onClose}>
      <div className="ma-dialog neu-panel" onClick={(event) => event.stopPropagation()}>
        <h2 className="ma-dialog-title">Outside your workspace</h2>
        <p className="ma-dialog-sub">
          “{project.title}” lives outside your workspace. Move it in, or keep it where it is and link it to
          your shelf.
        </p>
        <div className="ma-dialog-actions">
          <button type="button" className="btn" onClick={onKeep}>
            Keep &amp; link
          </button>
          <button type="button" className="btn btn-clear" onClick={onMove}>
            Move into workspace
          </button>
        </div>
      </div>
    </div>
  );
}

function BookCard({
  project,
  onOpen,
  onDelete,
}: {
  project: BookProject;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const progress = Math.round(bookProgress(project) * 100);
  const label = project.author ? `${project.title} — ${project.author}` : project.title;

  return (
    <div className="ma-book" role="listitem">
      <button type="button" className="ma-book-hit" onClick={onOpen} aria-label={`Open ${label}`} title={label}>
        <span className="ma-book-cover">
          {project.coverDataUrl ? (
            <img src={project.coverDataUrl} alt="" className="ma-book-art" />
          ) : (
            <GeneratedCover project={project} />
          )}
          {project.completedAt ? <span className="ma-book-badge ma-badge-done">Completed</span> : null}
          {project.external ? <span className="ma-book-badge ma-badge-linked">Linked</span> : null}
          {progress > 0 && progress < 100 ? (
            <span className="ma-book-progress" aria-hidden="true">
              <span className="ma-book-progress-fill" style={{ width: `${progress}%` }} />
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        className="ma-book-delete"
        aria-label={`Delete ${project.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/** A themed text cover for books without artwork. */
function GeneratedCover({ project }: { project: BookProject }) {
  const hue = hashHue(project.title || project.id);
  const style = {
    background: `linear-gradient(150deg, hsl(${hue} 46% 34%) 0%, hsl(${(hue + 24) % 360} 52% 22%) 100%)`,
  };
  return (
    <span className="ma-book-gen" style={style}>
      <span className="ma-book-gen-mark" aria-hidden="true">
        <KosmosGlyph />
      </span>
      <span className="ma-book-gen-title">{project.title}</span>
      <span className="ma-book-gen-author">{project.author || "Unknown author"}</span>
    </span>
  );
}

function hashHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function chunk<T>(items: T[], size: number): T[][] {
  const safe = Math.max(1, size);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += safe) {
    rows.push(items.slice(i, i + safe));
  }
  return rows;
}

/** Books per shelf row, based on the shelf width. */
function useColumns(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      setCols(Math.max(2, Math.min(6, Math.floor(width / 190) || 1)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return cols;
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

function EmptyShelf({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="ma-empty">
      <div className="ma-empty-art neu-inset" aria-hidden="true">
        <BookIcon />
      </div>
      <h2 className="ma-empty-title">Start your first book</h2>
      <p className="ma-empty-copy">Create a project, add a chapter, and record your first take.</p>
      <button type="button" className="btn btn-clear" onClick={onCreate}>
        New book
      </button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h5.5a1.5 1.5 0 0 0 1.5-1.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
