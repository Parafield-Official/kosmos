import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { estimateDurationMinutes, MAX_CHAPTER_MINUTES } from "../../../../src/core/manuscript/split";
import { chapterCompletionPct } from "./book-stats";
import { ConfirmAlert, deleteChapterCopy } from "./ConfirmAlert";
import { chapterStage, readChapterContent, removeChapter, type BookChapter, type BookProject, type ChapterStage } from "./store";

export function ChaptersScreen({
  project,
  onOpenChapter,
  onEditChapter,
  onRead,
  onAddChapter,
  onChange,
  onOpenExport,
}: {
  project: BookProject;
  onOpenChapter: (chapterId: string) => void;
  onEditChapter: (chapterId: string) => void;
  onRead: (chapterId: string) => void;
  onAddChapter: (title: string) => void;
  onChange: (next: BookProject) => void;
  onOpenExport?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BookChapter | null>(null);

  const count = project.chapters.length;
  const even = count > 0 && count % 2 === 0;
  const completeAt = project.chapters.map((chapter) => chapterStopDone(chapter));
  const currentIndex = completeAt.findIndex((done) => !done);
  const allDone = count > 0 && currentIndex < 0;
  const mapRef = useRef<HTMLDivElement>(null);
  const [boardW, setBoardW] = useState(720);
  const layout = useMemo(() => questLayout(count, even, boardW), [count, even, boardW]);

  useLayoutEffect(() => {
    const node = mapRef.current;
    if (!node) {
      return;
    }
    function sync() {
      const width = mapRef.current?.clientWidth ?? 0;
      if (width > 1) {
        setBoardW((prev) => (Math.abs(prev - width) < 1 ? prev : width));
      }
    }
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [adding, count]);

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
      <header className="quest-head">
        <div className="quest-head-copy">
          <p className="quest-kicker">{even ? "Even trail" : "Odd trail"}</p>
          <h1 className="ma-title">Chapters</h1>
        </div>
        <button type="button" className="quest-add-btn" onClick={() => setAdding(true)}>
          <PlusGlyph />
          Add chapter
        </button>
      </header>

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

      {count === 0 && !adding ? (
        <div className="quest-empty">
          <p>No chapters yet. Add one, or analyze a manuscript from Home.</p>
        </div>
      ) : (
        <div
          ref={mapRef}
          className={`quest-map is-${even ? "even" : "odd"}${allDone ? " is-complete" : ""}`}
        >
          <div className="quest-map-space" style={{ height: layout.viewH }} aria-hidden="true" />
          {layout.path ? (
            <svg
              className="quest-vine"
              viewBox={layout.viewBox}
              width="100%"
              height={layout.viewH}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <mask id="quest-trail-cut" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
                  <rect x="-80" y="-80" width={layout.viewW + 160} height={layout.viewH + 160} fill="white" />
                  {layout.dots.map((dot, index) => (
                    <circle key={index} cx={dot.x} cy={dot.y} r={dot.cut} fill="black" />
                  ))}
                </mask>
              </defs>
              <g mask="url(#quest-trail-cut)" style={{ filter: "none" }}>
                <path className="quest-vine-road" d={layout.path} />
                {layout.segments.map((segment, index) => {
                  const toFinish = Boolean(layout.finish) && index === layout.segments.length - 1;
                  const walked = toFinish
                    ? allDone
                    : allDone || completeAt[index] || completeAt[index + 1];
                  return (
                    <path
                      className={walked ? "quest-vine-lit" : "quest-vine-wait"}
                      d={segment}
                      key={`lit-${index}`}
                    />
                  );
                })}
              </g>
            </svg>
          ) : null}

          {layout.dots.map((dot, index) => {
            const isFinish = Boolean(layout.finish) && index === layout.dots.length - 1;
            const finished = isFinish ? allDone : Boolean(completeAt[index]);
            const now = isFinish ? false : !allDone && index === currentIndex;
            return (
              <span
                key={`bead-${index}`}
                className={`quest-bead${isFinish ? " is-finish" : ""}${now ? " is-now" : finished ? " is-lit" : ""}`}
                style={{ left: dot.x, top: dot.y }}
                aria-hidden="true"
              />
            );
          })}

          {project.chapters.map((chapter, index) => {
            const point = layout.nodes[index];
            if (!point) {
              return null;
            }
            return (
              <QuestNode
                key={chapter.id}
                index={index + 1}
                chapter={chapter}
                project={project}
                side={point.side}
                top={point.y}
                current={index === currentIndex}
                onOpen={() => onOpenChapter(chapter.id)}
                onRead={() => onRead(chapter.id)}
                onEdit={() => onEditChapter(chapter.id)}
                onRemove={() => setRemoveTarget(chapter)}
              />
            );
          })}

          {layout.finish && onOpenExport ? (
            <QuestFinish
              side={layout.finish.side}
              top={layout.finish.y}
              ready={project.chapters.length > 0 && project.chapters.every((chapter) => chapter.mastered)}
              onOpen={onOpenExport}
            />
          ) : null}

          {adding ? (
            <div className="quest-add-card" style={{ top: layout.addTop }}>
              <input
                className="quest-add-input"
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
              <button type="button" className="quest-act is-primary" onClick={commitAdd}>
                Add
              </button>
            </div>
          ) : null}

        </div>
      )}
    </section>
  );
}

function n(value: number): string {
  return value.toFixed(1);
}

function chapterStopDone(chapter: BookChapter): boolean {
  return chapter.recordedPct >= 1 || chapter.mastered || chapterCompletionPct(chapter) >= 100;
}

function snakeSegment(prev: { x: number; y: number }, curr: { x: number; y: number }): string {
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  return `M ${n(prev.x)} ${n(prev.y)} C ${n(prev.x + dx * 0.08)} ${n(prev.y + dy * 0.36)}, ${n(curr.x - dx * 0.08)} ${n(curr.y - dy * 0.36)}, ${n(curr.x)} ${n(curr.y)}`;
}

function questStop(index: number, even: boolean, midX: number, amp: number, startY: number, step: number) {
  const onRight = even ? index % 2 === 0 : index % 2 === 1;
  return {
    x: midX + (onRight ? amp : -amp),
    y: startY + index * step,
    side: onRight ? ("right" as const) : ("left" as const),
  };
}

function questLayout(count: number, even: boolean, width: number) {
  const viewW = Math.max(width, 480);
  const midX = viewW / 2;
  const amp = viewW * 0.11;
  const startY = 104;
  const step = 268;
  const nodes = Array.from({ length: count }, (_, index) => questStop(index, even, midX, amp, startY, step));
  const last = nodes[nodes.length - 1] ?? null;
  const finish = count > 0 ? questStop(count, even, midX, amp, startY, step) : null;
  const stops = finish ? [...nodes, finish] : nodes;
  const segments: string[] = [];
  for (let index = 1; index < stops.length; index += 1) {
    const prev = stops[index - 1];
    const curr = stops[index];
    if (!prev || !curr) {
      continue;
    }
    segments.push(snakeSegment(prev, curr));
  }
  const viewH = (finish?.y ?? last?.y ?? startY) + 156;
  const cut = 20;
  return {
    nodes,
    finish,
    dots: stops.map((node) => ({ x: node.x, y: node.y, cut })),
    segments,
    path: segments.join(" "),
    viewBox: `0 0 ${n(viewW)} ${n(viewH)}`,
    viewH,
    viewW,
    addTop: finish ? finish.y + 148 : last ? last.y + 148 : 24,
  };
}

function QuestNode({
  index,
  chapter,
  project,
  side,
  top,
  current,
  onOpen,
  onRead,
  onEdit,
  onRemove,
}: {
  index: number;
  chapter: BookChapter;
  project: BookProject;
  side: "left" | "right";
  top: number;
  current: boolean;
  onOpen: () => void;
  onRead: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const pct = chapterCompletionPct(chapter);
  const words = Math.max(0, chapter.wordCount || 0);
  const overLength = estimateDurationMinutes(words) > MAX_CHAPTER_MINUTES;
  const stage = chapterStage(chapter);
  const done = pct >= 100;
  const action = chapterPrimaryAction(stage);

  return (
    <article
      className={`quest-node is-${side}${current ? " is-current" : ""}${done ? " is-done" : ""}`}
      style={{ top }}
    >
      <button type="button" className="quest-cover" onClick={onOpen} aria-label={`${action.label} ${chapter.title}`}>
        <span className="quest-folio" aria-hidden="true">
          <ChapterPagePreview project={project} chapter={chapter} />
        </span>
        {done ? <span className="quest-seal">Done</span> : null}
      </button>
      <div className="quest-meta">
        <div className="quest-copy">
          <p className="quest-index">{String(index).padStart(2, "0")}</p>
          <h2 className="quest-title">{chapter.title}</h2>
          <p className="quest-status">
            {stageLabel(stage)} · {pct}%
            {overLength ? ` · Over ${MAX_CHAPTER_MINUTES} min` : ""}
          </p>
        </div>
        <div className="quest-acts">
          <button type="button" className="quest-act is-primary" onClick={onOpen}>
            {action.icon}
            {action.label}
          </button>
        </div>
      </div>
      <div className="quest-node-dock" role="group" aria-label={`${chapter.title} tools`}>
        <button type="button" className="quest-dock-btn" onClick={onRead} aria-label="Read" title="Read">
          <ReadGlyph />
        </button>
        <span className="quest-dock-rule" aria-hidden="true" />
        <button type="button" className="quest-dock-btn" onClick={onEdit} aria-label="Edit" title="Edit">
          <EditGlyph />
        </button>
        <span className="quest-dock-rule" aria-hidden="true" />
        <button type="button" className="quest-dock-btn is-danger" onClick={onRemove} aria-label="Remove" title="Remove">
          <TrashGlyph />
        </button>
      </div>
    </article>
  );
}

function chapterPrimaryAction(stage: ChapterStage): { label: string; icon: ReactNode } {
  if (stage === "proofing") {
    return { label: "Proofread", icon: <ProofGlyph /> };
  }
  if (stage === "mastering" || stage === "done") {
    return { label: "Master", icon: <WaveGlyph /> };
  }
  return { label: "Record", icon: <MicGlyph /> };
}

function QuestFinish({
  side,
  top,
  ready,
  onOpen,
}: {
  side: "left" | "right";
  top: number;
  ready: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`quest-end is-${side}${ready ? " is-ready" : ""}`}
      style={{ top }}
      onClick={onOpen}
    >
      <span className="quest-end-sheen" aria-hidden="true" />
      <span className="quest-end-folio" aria-hidden="true">
        <ExportGlyph />
      </span>
      <span className="quest-end-meta">
        <span className="quest-end-copy">
          <p className="quest-end-index">ACX</p>
          <strong className="quest-end-title">Export</strong>
          <em className="quest-end-status">{ready ? "Pack the book" : "Open the pack desk"}</em>
        </span>
      </span>
    </button>
  );
}

function stageLabel(stage: ChapterStage): string {
  if (stage === "done") {
    return "Mastered";
  }
  if (stage === "mastering") {
    return "Sound mastering";
  }
  if (stage === "proofing") {
    return "Proofread";
  }
  if (stage === "recording") {
    return "Recording";
  }
  return "Not started";
}

function ChapterPagePreview({ project, chapter }: { project: BookProject; chapter: BookChapter }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readChapterContent(project, chapter.id).then((content) => {
      if (alive) {
        setHtml(content);
      }
    });
    return () => {
      alive = false;
    };
  }, [project, chapter.id]);

  const hasText = Boolean(html?.trim());

  return (
    <span className="quest-folio-inner">
      {html === null ? (
        <span className="quest-folio-empty">Loading…</span>
      ) : hasText ? (
        <span className="quest-folio-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="quest-folio-empty">
          <strong>{chapter.title}</strong>
          <em>No text yet</em>
        </span>
      )}
    </span>
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
  const ask = deleteChapterCopy(chapter.title, chapter.hasOriginalAudio || chapter.hasWorkingAudio);
  return (
    <ConfirmAlert
      title={ask.title}
      body={ask.body}
      confirm={ask.confirm}
      busy={busy}
      busyLabel="Deleting…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.2" y="2.2" width="5.6" height="8" rx="2.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.6 8.2a4.4 4.4 0 0 0 8.8 0M8 12.6V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ProofGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 2.6h5.6L12.4 5.4v8H4.2V2.6Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M9.6 2.8V5.4h2.6M6 8.2h4.2M6 10.6h3.1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function WaveGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.6 8h1.1M4.8 5.2v5.6M7 3.8v8.4M9.2 5.8v4.4M11.4 4.4v7.2M13.6 7.4v1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ExportGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.6v6.4M5.4 5 8 2.4 10.6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.4 9.2v2.6A1.2 1.2 0 0 0 4.6 13h6.8a1.2 1.2 0 0 0 1.2-1.2V9.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ReadGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.4 3.4h5.1c.9 0 1.6.7 1.6 1.6V13a2.2 2.2 0 0 0-2-1.4H2.4V3.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M13.6 3.4H8.5c-.9 0-1.6.7-1.6 1.6V13a2.2 2.2 0 0 1 2-1.4h4.7V3.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.2 3.4 12.6 6.8 6 13.4H2.6v-3.4L9.2 3.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M8.1 4.5 11.5 7.9" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 4.4h9.6M6.2 4.4V3.2h3.6v1.2M5.1 4.4l.5 8.2h4.8l.5-8.2" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}
