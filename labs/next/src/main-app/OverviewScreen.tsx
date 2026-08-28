import { useEffect, useMemo, useRef, useState } from "react";
import { estimateDurationMinutes, MAX_CHAPTER_MINUTES } from "../../../../src/core/manuscript/split";
import {
  addGlossaryWord,
  dismissGlossaryWord,
  ensureBookGlossary,
  isResolved,
  setGlossaryRespell,
} from "./glossary";
import { GlossaryPanel } from "./GlossaryPanel";
import { exportBookPack, masterChapterWorking } from "./punch";
import { removeSuppressedWord } from "./suppress";
import {
  bookInitials,
  bookProgress,
  chapterStage,
  type BookChapter,
  type BookProject,
  type ChapterStage,
} from "./store";

/** Aggregate book analysis shown in the overview hero: words, run time, recorded. */
function bookStats(chapters: BookChapter[]): {
  words: number;
  readTime: string;
  recorded: number;
} {
  let words = 0;
  let minutes = 0;
  let recorded = 0;
  for (const chapter of chapters) {
    const count = Math.max(0, chapter.wordCount || 0);
    words += count;
    minutes += estimateDurationMinutes(count);
    if (chapter.hasOriginalAudio) {
      recorded += 1;
    }
  }
  const hours = minutes / 60;
  const readTime = hours >= 1 ? `${hours.toFixed(1)} hr` : `${Math.max(1, Math.round(minutes))} min`;
  return { words, readTime, recorded };
}

const STAGE_LABEL: Record<ChapterStage, string> = {
  blank: "Not started",
  recording: "Recording",
  proofing: "Ready to proof",
  mastering: "Ready to master",
  done: "Done",
};

export function OverviewScreen({
  project,
  onBack,
  onOpenChapter,
  onEditChapter,
  onRead,
  onAddChapter,
  onAnalyze,
  onChooseManuscript,
  onChange,
  analyzeError,
}: {
  project: BookProject;
  onBack: () => void;
  onOpenChapter: (chapterId: string) => void;
  onEditChapter: (chapterId: string) => void;
  onRead: (chapterId: string) => void;
  onAddChapter: (title: string) => void;
  onAnalyze: () => void;
  onChooseManuscript: (file: File) => void;
  onChange: (next: BookProject) => void;
  analyzeError?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState(project.title);
  const [analyzeAsk, setAnalyzeAsk] = useState<"analyze" | "manuscript" | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const manuscriptRef = useRef<HTMLInputElement>(null);

  const progress = Math.round(bookProgress(project) * 100);
  const stats = useMemo(() => bookStats(project.chapters), [project.chapters]);
  const allProofed = project.chapters.length > 0 && project.chapters.every((chapter) => chapter.proofed);
  const allMastered = project.chapters.length > 0 && project.chapters.every((chapter) => chapter.mastered);
  const glossary = project.glossary ?? [];
  const unresolvedCount = glossary.filter((entry) => !isResolved(entry)).length;
  const glossaryEntries = [...glossary].sort((left, right) => Number(isResolved(left)) - Number(isResolved(right)));

  useEffect(() => {
    let alive = true;
    if (project.glossary !== undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      void ensureBookGlossary(project).then((next) => {
        if (alive && next) {
          onChange(next);
        }
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [project.id]);

  useEffect(() => {
    setBookTitle(project.title);
  }, [project.id, project.title]);

  function saveBookTitle(raw = bookTitle) {
    const next = raw.trim() || "Untitled book";
    setBookTitle(next);
    if (next !== project.title) {
      onChange({ ...project, title: next });
    }
  }

  const hasChapters = project.chapters.length > 0;
  const hasRecordings = project.chapters.some(
    (chapter) => chapter.hasOriginalAudio || chapter.hasWorkingAudio,
  );

  function requestAnalyze() {
    if (hasChapters) {
      setAnalyzeAsk("analyze");
      return;
    }
    onAnalyze();
  }

  function requestManuscript(file: File) {
    if (hasChapters) {
      setPendingFile(file);
      setAnalyzeAsk("manuscript");
      return;
    }
    onChooseManuscript(file);
  }

  function confirmAnalyze() {
    const kind = analyzeAsk;
    const file = pendingFile;
    setAnalyzeAsk(null);
    setPendingFile(null);
    if (kind === "manuscript" && file) {
      onChooseManuscript(file);
      return;
    }
    if (kind === "analyze") {
      onAnalyze();
    }
  }

  async function masterAll() {
    setActionError(null);
    setBusy(true);
    try {
      let next = project;
      for (const chapter of project.chapters) {
        if (!chapter.mastered) {
          next = await masterChapterWorking(next, chapter.id);
        }
      }
      onChange(next);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Mastering failed.");
    } finally {
      setBusy(false);
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

  function commitAdd() {
    const title = newTitle.trim() || `Chapter ${project.chapters.length + 1}`;
    onAddChapter(title);
    setNewTitle("");
    setAdding(false);
  }

  return (
    <section className="ma-screen ma-overview" aria-label={project.title}>
      <header className="ma-overview-head">
        <button type="button" className="ma-back" onClick={onBack} aria-label="Back to library">
          <ChevronLeft />
          <span>Library</span>
        </button>
        {project.completedAt ? <span className="ma-stage-chip ma-stage-done">Completed</span> : null}
      </header>

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
              onChange={(event) => {
                const value = event.target.value;
                setBookTitle(value);
                const next = value.trim();
                if (next && next !== project.title) {
                  onChange({ ...project, title: next });
                }
              }}
              onBlur={(event) => saveBookTitle(event.currentTarget.value)}
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
          <p className="ma-hero-author">{project.author || "Unknown author"}</p>
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
                <dt>Read time</dt>
                <dd>{stats.readTime}</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>{stats.recorded}/{project.chapters.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="ma-hero-stat">No chapters yet</p>
          )}
        </div>
      </div>

      <div className="ma-section-head">
        <h2 className="ma-section-title">Chapters</h2>
        <div className="ma-section-actions">
          {project.chapters.length > 0 ? (
            <button type="button" className="btn" onClick={() => onRead(project.chapters[0].id)}>
              Read
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => manuscriptRef.current?.click()}>
            {project.manuscript ? "Choose different manuscript" : "Choose manuscript"}
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
          {allProofed && !allMastered ? (
            <button type="button" className="btn" onClick={() => void masterAll()} disabled={busy}>
              {busy ? "Working…" : "Master all"}
            </button>
          ) : null}
          {allMastered && !project.completedAt ? (
            <button type="button" className="btn btn-clear" onClick={() => void exportBook()} disabled={busy}>
              {busy ? "Exporting…" : "Export book"}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add chapter
          </button>
        </div>
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

      {project.chapters.length > 0 ? (
        <GlossaryPanel
          title="Pronunciations"
          summary={
            glossary.length === 0
              ? "No names flagged in this book yet. Add one if a word needs a spelling."
              : unresolvedCount === 0
                ? `All ${glossary.length} ${glossary.length === 1 ? "name" : "names"} have a pronunciation.`
                : `${unresolvedCount} of ${glossary.length} need a pronunciation.`
          }
          entries={glossaryEntries}
          bookTotal={0}
          allowAdd
          emptyCopy="Add a word if the scanner missed a name. Resolving a word here clears it for every chapter."
          onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
          onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
          onAdd={(spelling, respell) => onChange(addGlossaryWord(project, spelling, respell))}
        />
      ) : null}

      {project.chapters.length > 0 ? (
        <section className="ma-glossary ma-suppress" aria-label="Words this book never flags">
          <header className="ma-glossary-head">
            <h2>Words this book never flags</h2>
            <p>
              {(project.suppressedWords ?? []).length === 0
                ? "None yet. On a Review flag, tap Never flag this word."
                : "Skipped on proof and while recording. Remove one to flag it again after the next proof."}
            </p>
          </header>
          {(project.suppressedWords ?? []).length > 0 ? (
            <ul className="ma-suppress-list">
              {(project.suppressedWords ?? []).map((word) => (
                <li key={word}>
                  <span>{word}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-clear"
                    aria-label={`Flag ${word} again`}
                    onClick={() => onChange(removeSuppressedWord(project, word))}
                  >
                    Flag again
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="ma-chapter-list">
        {project.chapters.map((chapter, index) => (
          <ChapterRow
            key={chapter.id}
            index={index + 1}
            chapter={chapter}
            onOpen={() => onOpenChapter(chapter.id)}
            onEdit={() => onEditChapter(chapter.id)}
          />
        ))}

        {adding ? (
          <div className="ma-chapter-add neu-inset">
            <input
              className="neu-input"
              autoFocus
              value={newTitle}
              placeholder={`Chapter ${project.chapters.length + 1}`}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitAdd();
                }
                if (event.key === "Escape") {
                  setAdding(false);
                  setNewTitle("");
                }
              }}
            />
            <button type="button" className="btn btn-clear" onClick={commitAdd}>
              Add
            </button>
          </div>
        ) : null}

        {project.chapters.length === 0 && !adding ? (
          <div className="ma-chapter-empty">
            {project.manuscript ? (
              <>
                <p>Manuscript uploaded. Analyze it to split the book into chapters, or pick a different file.</p>
                <button type="button" className="btn btn-clear" onClick={onAnalyze}>
                  Analyze manuscript
                </button>
              </>
            ) : (
              <>
                <p>No chapters yet. Choose a manuscript to split into chapters, or add one by hand.</p>
                <button type="button" className="btn btn-clear" onClick={() => manuscriptRef.current?.click()}>
                  Choose manuscript
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
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

function ChapterRow({
  index,
  chapter,
  onOpen,
  onEdit,
}: {
  index: number;
  chapter: BookChapter;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const stage = chapterStage(chapter);
  const pct = Math.round(Math.min(1, Math.max(0, chapter.recordedPct)) * 100);
  const words = Math.max(0, chapter.wordCount || 0);
  const overLength = estimateDurationMinutes(words) > MAX_CHAPTER_MINUTES;

  return (
    <div className="ma-chapter-row neu-card">
      <button type="button" className="ma-chapter-open" onClick={onOpen}>
        <span className="ma-chapter-index">{String(index).padStart(2, "0")}</span>
        <span className="ma-chapter-main">
          <span className="ma-chapter-title">{chapter.title}</span>
          <span className="ma-chapter-meta">
            <span>{words.toLocaleString()} words</span>
            {overLength ? (
              <span
                className="ma-chapter-warn"
                title={`Estimated over ${MAX_CHAPTER_MINUTES} minutes; ACX requires splitting this chapter.`}
              >
                Over {MAX_CHAPTER_MINUTES} min
              </span>
            ) : null}
          </span>
          <span className="ma-progress">
            <span className="ma-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className={`ma-stage-chip ma-stage-${stage}`}>{STAGE_LABEL[stage]}</span>
      </button>
      <button
        type="button"
        className="ma-chapter-edit"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        aria-label={`Edit ${chapter.title}`}
        title="Edit content"
      >
        <PencilIcon />
      </button>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

