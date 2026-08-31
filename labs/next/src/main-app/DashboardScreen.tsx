import { useEffect, useMemo, useRef, useState } from "react";
import { bookStats, completionPct } from "./book-stats";
import { bookInitials, type BookProject } from "./store";
import { VaultListenSheet, VaultReadSheet } from "./vault-media";

export function DashboardScreen({
  project,
  onChange,
  onGoChapters,
  onAnalyze,
  onChooseManuscript,
  analyzeError,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
  onGoChapters: () => void;
  onAnalyze: () => void;
  onChooseManuscript: (file: File) => void;
  analyzeError?: string | null;
}) {
  const [bookTitle, setBookTitle] = useState(project.title);
  const [bookAuthor, setBookAuthor] = useState(project.author);
  const [surface, setSurface] = useState<"board" | "read" | "listen">("board");
  const [analyzeAsk, setAnalyzeAsk] = useState<"analyze" | "manuscript" | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const manuscriptRef = useRef<HTMLInputElement>(null);

  const progress = completionPct(project);
  const stats = useMemo(() => bookStats(project.chapters), [project.chapters]);
  const allMastered = project.chapters.length > 0 && project.chapters.every((chapter) => chapter.mastered);
  const hasChapters = project.chapters.length > 0;
  const hasRecordings = project.chapters.some(
    (chapter) => chapter.hasOriginalAudio || chapter.hasWorkingAudio,
  );

  useEffect(() => {
    setBookTitle(project.title);
    setBookAuthor(project.author);
  }, [project.id, project.title, project.author]);

  function saveTitle(raw = bookTitle) {
    const next = raw.trim() || "Untitled book";
    setBookTitle(next);
    if (next !== project.title) {
      onChange({ ...project, title: next });
    }
  }

  function saveAuthor(raw = bookAuthor) {
    const next = raw.trim();
    setBookAuthor(next);
    if (next !== project.author) {
      onChange({ ...project, author: next });
    }
  }

  function requestAnalyze() {
    if (hasChapters) {
      setAnalyzeAsk("analyze");
      return;
    }
    onAnalyze();
    onGoChapters();
  }

  function requestManuscript(file: File) {
    if (hasChapters) {
      setPendingFile(file);
      setAnalyzeAsk("manuscript");
      return;
    }
    onChooseManuscript(file);
    onGoChapters();
  }

  function confirmAnalyze() {
    const kind = analyzeAsk;
    const file = pendingFile;
    setAnalyzeAsk(null);
    setPendingFile(null);
    if (kind === "manuscript" && file) {
      onChooseManuscript(file);
      onGoChapters();
      return;
    }
    if (kind === "analyze") {
      onAnalyze();
      onGoChapters();
    }
  }

  if (surface === "read") {
    return (
      <section className="ma-screen ma-dashboard is-media" aria-label="Reading">
        <VaultReadSheet
          embedded
          project={project}
          onBack={() => setSurface("board")}
        />
      </section>
    );
  }

  if (surface === "listen") {
    return (
      <section className="ma-screen ma-dashboard is-media" aria-label="Listening">
        <VaultListenSheet
          embedded
          seed={project}
          library={[project]}
          renderCover={(item) => <DashCover project={item} />}
          onBack={() => setSurface("board")}
        />
      </section>
    );
  }

  return (
    <section className="ma-screen ma-dashboard" aria-label="Home">
      <article className="ma-dash-hero">
        <div className="ma-dash-cover">
          <DashCover project={project} />
        </div>
        <div className="ma-dash-copy">
          <div className="ma-dash-identity">
            <h1 className="ma-title">
              <input
                className="ma-title-input"
                value={bookTitle}
                aria-label="Book title"
                onChange={(event) => setBookTitle(event.target.value)}
                onBlur={(event) => saveTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setBookTitle(project.title);
                    event.currentTarget.blur();
                  }
                }}
              />
            </h1>
            <p className="ma-hero-author">
              <input
                className="ma-title-input ma-author-input"
                value={bookAuthor}
                aria-label="Author"
                placeholder="Author"
                onChange={(event) => setBookAuthor(event.target.value)}
                onBlur={(event) => saveAuthor(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setBookAuthor(project.author);
                    event.currentTarget.blur();
                  }
                }}
              />
            </p>
            <div className="ma-dash-meter" aria-label={`${progress}% complete`}>
              <span className="ma-dash-meter-track">
                <i style={{ width: `${progress}%` }} />
              </span>
              <span className="ma-dash-meter-label">{progress}% complete</span>
            </div>
          </div>

          <div className="ma-dash-acts">
            <button type="button" className="ma-dash-act" disabled={!hasChapters} onClick={() => setSurface("read")}>
              <ReadGlyph />
              <span>Read</span>
            </button>
            <button type="button" className="ma-dash-act" disabled={!allMastered} onClick={() => setSurface("listen")}>
              <ListenGlyph />
              <span>Listen</span>
            </button>
            <button type="button" className="ma-dash-act" onClick={() => manuscriptRef.current?.click()}>
              <ManuscriptGlyph />
              <span>{project.manuscript ? "Update" : "Choose manuscript"}</span>
            </button>
            {project.manuscript ? (
              <button type="button" className="ma-dash-act" onClick={requestAnalyze}>
                <AnalyzeGlyph />
                <span>{project.chapters.length > 0 ? "Re-analyze" : "Analyze"}</span>
              </button>
            ) : null}
          </div>
        </div>
      </article>

      {hasChapters ? (
        <dl className="ma-dash-stats">
          <div>
            <dt>Chapters</dt>
            <dd>{project.chapters.length}</dd>
          </div>
          <div>
            <dt>Words</dt>
            <dd>{stats.words.toLocaleString()}</dd>
          </div>
          <div>
            <dt>PFH</dt>
            <dd>{stats.pfh}</dd>
          </div>
        </dl>
      ) : (
        <p className="ma-dash-empty">No chapters yet — choose a manuscript to start.</p>
      )}

      <input
        ref={manuscriptRef}
        type="file"
        accept=".txt,.md,.markdown,.docx,.epub,.pdf,text/plain"
        className="ma-visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            requestManuscript(file);
          }
        }}
      />

      {analyzeError ? <p className="ma-error">{analyzeError}</p> : null}

      {analyzeAsk ? (
        <AnalyzeConfirm
          replaceManuscript={analyzeAsk === "manuscript"}
          hasRecordings={hasRecordings}
          onConfirm={confirmAnalyze}
          onCancel={() => {
            setAnalyzeAsk(null);
            setPendingFile(null);
          }}
        />
      ) : null}
    </section>
  );
}

function DashCover({ project }: { project: BookProject }) {
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

function ManuscriptGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4.5h7.2L18.5 9v10.5A1.5 1.5 0 0 1 17 21H7A1.5 1.5 0 0 1 5.5 19.5v-14A1.5 1.5 0 0 1 7 4.5Z" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
      <path d="M14 4.6V9h4.4" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
    </svg>
  );
}

function AnalyzeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.5 18.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" stroke="currentColor" strokeWidth="1.65" />
      <path d="m15.6 15.6 4.2 4.2" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}

function AnalyzeConfirm({
  replaceManuscript,
  hasRecordings,
  onConfirm,
  onCancel,
}: {
  replaceManuscript: boolean;
  hasRecordings: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="ma-scrim" role="presentation" onClick={onCancel}>
      <div
        className="ma-alert neu-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ma-reanalyze-title"
        aria-describedby="ma-reanalyze-sub"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ma-alert-copy">
          <h2 className="ma-alert-title" id="ma-reanalyze-title">
            {replaceManuscript ? "Replace manuscript?" : "Re-analyze this book?"}
          </h2>
          <p className="ma-alert-sub" id="ma-reanalyze-sub">
            {hasRecordings
              ? "This rebuilds every chapter from the manuscript. Recordings, proof flags, and mastering on the current chapters will be lost."
              : "This rebuilds every chapter from the manuscript. Chapter text and proof flags on the current chapters will be replaced."}
          </p>
        </div>
        <div className="ma-alert-actions">
          <button type="button" className="ma-alert-btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="ma-alert-btn ma-alert-btn-danger" onClick={onConfirm}>
            {replaceManuscript ? "Replace" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  );
}
