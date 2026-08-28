import { useEffect, useState } from "react";
import { estimateDurationMinutes, MAX_CHAPTER_MINUTES } from "../../../../src/core/manuscript/split";
import { chapterCompletionPct } from "./book-stats";
import { bookInitials, removeChapter, type BookChapter, type BookProject } from "./store";

export function ChaptersScreen({
  project,
  onOpenChapter,
  onEditChapter,
  onRead,
  onAddChapter,
  onChange,
}: {
  project: BookProject;
  onOpenChapter: (chapterId: string) => void;
  onEditChapter: (chapterId: string) => void;
  onRead: (chapterId: string) => void;
  onAddChapter: (title: string) => void;
  onChange: (next: BookProject) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BookChapter | null>(null);

  function commitAdd() {
    const title = newTitle.trim() || `Chapter ${project.chapters.length + 1}`;
    onAddChapter(title);
    setNewTitle("");
    setAdding(false);
  }

  async function confirmRemove() {
    const chapter = removeTarget;
    if (!chapter) {
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      onChange(await removeChapter(project, chapter.id));
      setRemoveTarget(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not remove that chapter.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ma-screen ma-chapters" aria-label="Chapters">
      <div className="ma-section-head">
        <h1 className="ma-title">Chapters</h1>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Add chapter
        </button>
      </div>

      {actionError ? <p className="ma-error">{actionError}</p> : null}

      {removeTarget ? (
        <RemoveChapterConfirm
          chapter={removeTarget}
          busy={busy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => {
            if (!busy) {
              setRemoveTarget(null);
            }
          }}
        />
      ) : null}

      <div className="ma-chapter-orbs">
        {project.chapters.map((chapter, index) => (
          <ChapterOrb
            key={chapter.id}
            index={index + 1}
            chapter={chapter}
            coverDataUrl={project.coverDataUrl}
            initials={bookInitials(project)}
            onOpen={() => onOpenChapter(chapter.id)}
            onRead={() => onRead(chapter.id)}
            onEdit={() => onEditChapter(chapter.id)}
            onRemove={() => setRemoveTarget(chapter)}
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
      </div>

      {project.chapters.length === 0 && !adding ? (
        <div className="ma-chapter-empty">
          <p>No chapters yet. Add one, or analyze a manuscript from the dashboard.</p>
        </div>
      ) : null}
    </section>
  );
}

function ChapterOrb({
  index,
  chapter,
  coverDataUrl,
  initials,
  onOpen,
  onRead,
  onEdit,
  onRemove,
}: {
  index: number;
  chapter: BookChapter;
  coverDataUrl?: string;
  initials: string;
  onOpen: () => void;
  onRead: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const pct = chapterCompletionPct(chapter);
  const words = Math.max(0, chapter.wordCount || 0);
  const overLength = estimateDurationMinutes(words) > MAX_CHAPTER_MINUTES;

  return (
    <article className="ma-orb">
      <button type="button" className="ma-orb-hit" onClick={onOpen} aria-label={`Open ${chapter.title}`}>
        <span className="ma-orb-disc neu-card">
          {coverDataUrl ? (
            <img src={coverDataUrl} alt="" className="ma-orb-cover" />
          ) : (
            <span className="ma-orb-initials">{initials}</span>
          )}
          <span className="ma-orb-ring" style={{ ["--orb-pct" as string]: `${pct}%` }} aria-hidden="true" />
        </span>
        <span className="ma-orb-index">{String(index).padStart(2, "0")}</span>
        <span className="ma-orb-title">{chapter.title}</span>
        <span className="ma-orb-meta">
          {pct}% complete
          {overLength ? ` · Over ${MAX_CHAPTER_MINUTES} min` : ""}
        </span>
      </button>
      <div className="ma-orb-actions">
        <button type="button" className="btn btn-sm" onClick={onRead}>
          Read
        </button>
        <button type="button" className="btn btn-sm" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-sm" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}

function RemoveChapterConfirm({
  chapter,
  busy,
  onConfirm,
  onCancel,
}: {
  chapter: BookChapter;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const hasTape = chapter.hasOriginalAudio || chapter.hasWorkingAudio;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="ma-scrim" role="presentation" onClick={onCancel}>
      <div
        className="ma-alert neu-panel"
        role="alertdialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ma-alert-copy">
          <h2 className="ma-alert-title">Remove this chapter?</h2>
          <p className="ma-alert-sub">
            {hasTape
              ? `“${chapter.title}” and its recordings will be permanently deleted. This can’t be undone.`
              : `“${chapter.title}” will be permanently deleted. This can’t be undone.`}
          </p>
        </div>
        <div className="ma-alert-actions">
          <button type="button" className="ma-alert-btn" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className="ma-alert-btn ma-alert-btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
