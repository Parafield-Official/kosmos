import { useEffect, useMemo, useRef, useState } from "react";
import { bookStats, completionPct } from "./book-stats";
import { exportBookPack } from "./punch";
import { bookInitials, type BookProject } from "./store";

export function DashboardScreen({
  project,
  onChange,
  onRead,
  onGoChapters,
  onAnalyze,
  onChooseManuscript,
  analyzeError,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
  onRead: () => void;
  onGoChapters: () => void;
  onAnalyze: () => void;
  onChooseManuscript: (file: File) => void;
  analyzeError?: string | null;
}) {
  const [bookTitle, setBookTitle] = useState(project.title);
  const [bookAuthor, setBookAuthor] = useState(project.author);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  async function exportBook() {
    setActionError(null);
    setBusy(true);
    try {
      onChange(await exportBookPack(project));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ma-screen ma-dashboard" aria-label="Dashboard">
      <div className="ma-overview-hero neu-card">
        <span className="ma-hero-cover neu-inset">
          {project.coverDataUrl ? (
            <img src={project.coverDataUrl} alt="" className="ma-book-art" />
          ) : (
            <span className="ma-book-spine">{bookInitials(project)}</span>
          )}
        </span>
        <div className="ma-hero-meta">
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
          <div className="ma-hero-progress">
            <span className="ma-progress ma-progress-lg">
              <span className="ma-progress-fill" style={{ width: `${progress}%` }} />
            </span>
            <span className="ma-hero-progress-label">{progress}% complete</span>
          </div>
          {project.chapters.length > 0 ? (
            <dl className="ma-hero-stats">
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
              <div>
                <dt>Recorded</dt>
                <dd>
                  {stats.recorded}/{project.chapters.length}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="ma-hero-stat">No chapters yet</p>
          )}
        </div>
      </div>

      <div className="ma-dash-controls">
        {project.chapters.length > 0 ? (
          <button type="button" className="btn" onClick={onRead}>
            Read
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => manuscriptRef.current?.click()}>
          {project.manuscript ? "Update manuscript" : "Choose manuscript"}
        </button>
        <input
          ref={manuscriptRef}
          type="file"
          accept=".txt,.md,.markdown,.docx,.epub,.pdf,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              requestManuscript(file);
            }
          }}
        />
        {project.manuscript ? (
          <button type="button" className="btn" onClick={requestAnalyze}>
            {project.chapters.length > 0 ? "Re-analyze" : "Analyze manuscript"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-clear"
          onClick={() => void exportBook()}
          disabled={busy || !allMastered}
        >
          {busy ? "Exporting…" : "Export audio ACX"}
        </button>
      </div>

      {actionError ? <p className="ma-error">{actionError}</p> : null}
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
