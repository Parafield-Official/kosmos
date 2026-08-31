import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { estimateDurationMinutes, MAX_CHAPTER_MINUTES } from "../../../../src/core/manuscript/split";
import { chapterCompletionPct } from "./book-stats";
import { chapterStage, readChapterContent, removeChapter, type BookChapter, type BookProject, type ChapterStage } from "./store";

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

  const count = project.chapters.length;
  const even = count > 0 && count % 2 === 0;
  const currentIndex = project.chapters.findIndex((chapter) => chapterCompletionPct(chapter) < 100);
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
      const width = node.clientWidth;
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
          style={{ minHeight: layout.viewH }}
        >
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
              {layout.segments.map((segment, index) => (
                <path
                  className={allDone || index < Math.max(currentIndex, 0) ? "quest-vine-lit" : "quest-vine-wait"}
                  d={segment}
                  key={`lit-${index}`}
                />
              ))}
            </g>
          </svg>

          {layout.dots.map((dot, index) => {
            const now = !allDone && index === currentIndex;
            const lit = allDone || index <= currentIndex;
            return (
              <span
                key={`bead-${index}`}
                className={`quest-bead${now ? " is-now" : lit ? " is-lit" : ""}`}
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

          {allDone ? (
            <p className="quest-complete" role="status">
              Trail complete. Every chapter is mastered.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function n(value: number): string {
  return value.toFixed(1);
}

function snakeSegment(
  prev: { x: number; y: number },
  curr: { x: number; y: number },
  midX: number,
  bulge: number,
): string {
  const dy = curr.y - prev.y;
  const dirPrev = Math.sign(prev.x - midX) || 1;
  const dirCurr = Math.sign(curr.x - midX) || -1;
  return [
    `M ${n(prev.x)} ${n(prev.y)}`,
    `C ${n(prev.x + dirPrev * bulge)} ${n(prev.y + dy * 0.22)}, ${n(midX + dirPrev * bulge * 0.28)} ${n(prev.y + dy * 0.48)}, ${n(midX)} ${n((prev.y + curr.y) / 2)}`,
    `C ${n(midX + dirCurr * bulge * 0.28)} ${n(curr.y - dy * 0.48)}, ${n(curr.x + dirCurr * bulge)} ${n(curr.y - dy * 0.22)}, ${n(curr.x)} ${n(curr.y)}`,
  ].join(" ");
}

function questLayout(count: number, even: boolean, width: number) {
  const viewW = Math.max(width, 480);
  const midX = viewW / 2;
  const amp = viewW * 0.152;
  const bulge = viewW * 0.18;
  const startY = 108;
  const step = 244;
  const nodes = Array.from({ length: count }, (_, index) => {
    const onRight = even ? index % 2 === 0 : index % 2 === 1;
    return {
      x: midX + (onRight ? amp : -amp),
      y: startY + index * step,
      side: onRight ? ("right" as const) : ("left" as const),
    };
  });
  const segments: string[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const prev = nodes[index - 1];
    const curr = nodes[index];
    if (!prev || !curr) {
      continue;
    }
    segments.push(snakeSegment(prev, curr, midX, bulge));
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const dirFirst = first ? Math.sign(first.x - midX) || 1 : 1;
  const dirLast = last ? Math.sign(last.x - midX) || 1 : 1;
  const lead = first
    ? `M ${n(midX)} 28 C ${n(midX)} 64, ${n(first.x - dirFirst * 36)} ${n(first.y - 46)}, ${n(first.x)} ${n(first.y)}`
    : "";
  const tail = last
    ? `M ${n(last.x)} ${n(last.y)} C ${n(last.x - dirLast * 36)} ${n(last.y + 46)}, ${n(midX)} ${n(last.y + 84)}, ${n(midX)} ${n(last.y + 112)}`
    : "";
  const viewH = startY + Math.max(count - 1, 0) * step + 132;
  const cut = 30;
  return {
    nodes,
    dots: nodes.map((node) => ({ x: node.x, y: node.y, cut })),
    segments,
    path: [lead, ...segments, tail].filter(Boolean).join(" "),
    viewBox: `0 0 ${n(viewW)} ${n(viewH)}`,
    viewH,
    viewW,
    addTop: last ? last.y + 118 : 24,
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

  return (
    <article
      className={`quest-node is-${side}${current ? " is-current" : ""}${done ? " is-done" : ""}`}
      style={{ top }}
    >
      <button type="button" className="quest-cover" onClick={onOpen} aria-label={`Record ${chapter.title}`}>
        <span className="quest-folio" aria-hidden="true">
          <ChapterPagePreview project={project} chapter={chapter} />
        </span>
        <span className="quest-ring" style={{ ["--quest-pct" as string]: `${pct}%` }} />
        {done ? <span className="quest-seal">Done</span> : null}
      </button>
      <div className="quest-meta">
        <p className="quest-index">{String(index).padStart(2, "0")}</p>
        <h2 className="quest-title">{chapter.title}</h2>
        <p className="quest-status">
          {stageLabel(stage)} · {pct}%
          {overLength ? ` · Over ${MAX_CHAPTER_MINUTES} min` : ""}
        </p>
        <div className="quest-meter" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="quest-acts">
          <button type="button" className="quest-act is-primary" onClick={onOpen}>
            <MicGlyph />
            {done ? "Open" : current ? "Continue" : "Record"}
          </button>
          <button type="button" className="quest-act" onClick={onRead} aria-label="Read" title="Read">
            <ReadGlyph />
          </button>
          <button type="button" className="quest-act" onClick={onEdit} aria-label="Edit" title="Edit">
            <EditGlyph />
          </button>
          <button type="button" className="quest-act is-danger" onClick={onRemove} aria-label="Remove" title="Remove">
            <TrashGlyph />
          </button>
        </div>
      </div>
    </article>
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
