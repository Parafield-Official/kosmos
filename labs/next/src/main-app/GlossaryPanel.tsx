import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GlossaryEntry } from "../../../../src/core/project/types";
import { ReplaceClipAsk, useClipRecorder } from "./clip-record";
import { isResolved } from "./glossary";
import { readChapterAudioUrl, type BookProject } from "./store";

export function GlossaryPanel({
  title,
  summary,
  entries,
  bookTotal,
  allowAdd,
  emptyCopy,
  project,
  onRespell,
  onDismiss,
  onAdd,
  onClip,
  onReorder,
}: {
  title: string;
  summary: string;
  entries: GlossaryEntry[];
  bookTotal: number;
  allowAdd?: boolean;
  emptyCopy: string;
  project?: BookProject;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onAdd?: (spelling: string, respell: string) => void;
  onClip?: (id: string, blob: Blob) => void;
  onReorder?: (ids: string[]) => void;
}) {
  const [draftSpelling, setDraftSpelling] = useState("");
  const [draftRespell, setDraftRespell] = useState("");
  const open = entries.filter((entry) => !isResolved(entry));
  const saved = entries.filter(isResolved);
  const mixed = open.length > 0 && saved.length > 0;

  function submitAdd() {
    const spelling = draftSpelling.trim();
    if (!spelling || !onAdd) {
      return;
    }
    onAdd(spelling, draftRespell.trim());
    setDraftSpelling("");
    setDraftRespell("");
  }

  return (
    <section className={`ma-glossary${entries.length === 0 ? " is-empty" : ""}`} aria-label={title}>
      <header className="ma-glossary-head">
        <h2>{title}</h2>
        <p>{summary}</p>
        {bookTotal > 0 ? <p className="ma-glossary-book">{bookTotal} flagged in the book</p> : null}
      </header>

      <div className="ma-glossary-pane">
        {entries.length === 0 ? (
          <p className="ma-glossary-empty">{emptyCopy}</p>
        ) : mixed ? (
          <>
            <p className="ma-glossary-group">Needs a guide</p>
            <GlossaryList entries={open} project={project} onRespell={onRespell} onDismiss={onDismiss} onClip={onClip} onReorder={onReorder} />
            <p className="ma-glossary-group">Resolved</p>
            <GlossaryList entries={saved} project={project} onRespell={onRespell} onDismiss={onDismiss} onClip={onClip} />
          </>
        ) : (
          <GlossaryList entries={entries} project={project} onRespell={onRespell} onDismiss={onDismiss} onClip={onClip} onReorder={onReorder} />
        )}
      </div>

      {allowAdd && onAdd ? (
        <div className="ma-glossary-add">
          <input
            className="neu-input ma-word-input"
            value={draftSpelling}
            placeholder="Word or phrase"
            aria-label="Word or phrase to pronounce"
            onChange={(event) => setDraftSpelling(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitAdd();
              }
            }}
          />
          <input
            className="neu-input ma-guide-input"
            value={draftRespell}
            placeholder="Guide"
            aria-label="Pronunciation guide"
            onChange={(event) => setDraftRespell(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitAdd();
              }
            }}
          />
          <button type="button" className="btn btn-clear" disabled={!draftSpelling.trim()} onClick={submitAdd}>
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}

function useReorder<T>(items: T[], onReorder?: (next: T[]) => void) {
  const [drag, setDrag] = useState<{
    from: number;
    over: number;
    y: number;
    height: number;
    originY: number;
    armed: boolean;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const showGrip = Boolean(onReorder);
  const canDrag = showGrip && items.length > 1;

  function shiftFor(index: number): number {
    if (!drag?.armed) {
      return 0;
    }
    if (index === drag.from) {
      return drag.y;
    }
    if (drag.from < drag.over && index > drag.from && index <= drag.over) {
      return -drag.height;
    }
    if (drag.from > drag.over && index < drag.from && index >= drag.over) {
      return drag.height;
    }
    return 0;
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (!canDrag || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const row = event.currentTarget.closest("li");
    const list = row?.parentElement;
    const gap = list ? Number.parseFloat(getComputedStyle(list).rowGap || "0") : 0;
    const height = (row?.getBoundingClientRect().height ?? 48) + (Number.isFinite(gap) ? gap : 0);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: index, over: index, y: 0, height, originY: event.clientY, armed: false });
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) {
      return;
    }
    const raw = event.clientY - current.originY;
    if (!current.armed && Math.abs(raw) < 10) {
      return;
    }
    const max = (items.length - 1 - current.from) * current.height;
    const min = -current.from * current.height;
    const y = rubberband(raw, min, max);
    const over = Math.max(0, Math.min(items.length - 1, current.from + Math.round(y / current.height)));
    setDrag({ ...current, armed: true, y, over });
  }

  function endDrag() {
    const current = dragRef.current;
    if (current?.armed && onReorder && current.over !== current.from) {
      onReorder(arrayMove(items, current.from, current.over));
    }
    dragRef.current = null;
    setDrag(null);
  }

  return { drag, shiftFor, startDrag, moveDrag, endDrag, showGrip };
}

export function GlossaryList({
  entries,
  project,
  highlightId,
  onRespell,
  onDismiss,
  onClip,
  onReorder,
}: {
  entries: GlossaryEntry[];
  project?: BookProject;
  highlightId?: string | null;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onClip?: (id: string, blob: Blob) => void;
  onReorder?: (ids: string[]) => void;
}) {
  const reorder = useReorder(entries, onReorder ? (next) => onReorder(next.map((entry) => entry.id)) : undefined);

  return (
    <ul className={`ma-glossary-list${reorder.drag ? " is-dragging" : ""}`}>
      {entries.map((entry, index) => (
        <GlossaryRow
          key={entry.id}
          entry={entry}
          project={project}
          highlight={entry.id === highlightId}
          dragging={reorder.drag?.from === index && Boolean(reorder.drag.armed)}
          shift={reorder.shiftFor(index)}
          onRespell={onRespell}
          onDismiss={onDismiss}
          onClip={onClip}
          onGripPointerDown={reorder.showGrip ? (event) => reorder.startDrag(event, index) : undefined}
          onGripPointerMove={reorder.showGrip ? reorder.moveDrag : undefined}
          onGripPointerUp={reorder.showGrip ? reorder.endDrag : undefined}
        />
      ))}
    </ul>
  );
}

export function SkipWordList({
  words,
  onRemove,
  onReorder,
}: {
  words: string[];
  onRemove: (word: string) => void;
  onReorder?: (words: string[]) => void;
}) {
  const reorder = useReorder(words, onReorder);

  return (
    <ul className={`ma-suppress-list ma-skip-list${reorder.drag ? " is-dragging" : ""}`}>
      {words.map((word, index) => {
        const shift = reorder.shiftFor(index);
        const dragging = Boolean(reorder.drag?.from === index && reorder.drag.armed);
        return (
          <li
            key={`${word}:${index}`}
            className={dragging ? "is-dragging" : undefined}
            style={shift ? { transform: `translateY(${shift}px)` } : undefined}
          >
            {reorder.showGrip ? (
              <button
                type="button"
                className="ma-block-grip"
                aria-label={`Reorder ${word}`}
                onPointerDown={(event) => reorder.startDrag(event, index)}
                onPointerMove={reorder.moveDrag}
                onPointerUp={reorder.endDrag}
                onPointerCancel={reorder.endDrag}
                onLostPointerCapture={reorder.endDrag}
              >
                <GripGlyph />
              </button>
            ) : null}
            <span className="ma-scroll-x">{word}</span>
            <button
              type="button"
              className="ma-word-act is-danger"
              aria-label={`Flag ${word} again`}
              onClick={() => onRemove(word)}
            >
              <UndoGlyph />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function rubberband(value: number, min: number, max: number): number {
  if (value < min) {
    const extra = min - value;
    return min - (extra * 48) / (48 + extra);
  }
  if (value > max) {
    const extra = value - max;
    return max + (extra * 48) / (48 + extra);
  }
  return value;
}

export function GlossaryDeck({
  entries,
  project,
  highlightId,
  onRespell,
  onDismiss,
  onClip,
}: {
  entries: GlossaryEntry[];
  project?: BookProject;
  highlightId?: string | null;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onClip?: (id: string, blob: Blob) => void;
}) {
  const [index, setIndex] = useState(0);
  const count = entries.length;
  const ids = entries.map((item) => item.id).join("|");
  const safeIndex = count === 0 ? 0 : ((index % count) + count) % count;
  const entry = entries[safeIndex];

  useEffect(() => {
    setIndex(0);
  }, [ids]);

  useEffect(() => {
    if (!highlightId) {
      return;
    }
    const next = entries.findIndex((item) => item.id === highlightId);
    if (next >= 0) {
      setIndex(next);
    }
  }, [highlightId, ids]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (count < 2) {
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => value + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => value - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (!entry) {
    return <p className="ma-glossary-empty">Nothing resolved yet.</p>;
  }

  return (
    <div className="ma-pronounce-deck">
      <p className="ma-pronounce-deck-count">
        {safeIndex + 1} of {count}
      </p>
      <div className="ma-pronounce-deck-stage">
        <button
          type="button"
          className="ma-pronounce-deck-arrow"
          aria-label="Previous card"
          disabled={count < 2}
          onClick={() => setIndex((value) => value - 1)}
        >
          <PrevGlyph />
        </button>
        <GlossaryRow
          key={entry.id}
          variant="card"
          entry={entry}
          project={project}
          highlight={entry.id === highlightId}
          onRespell={onRespell}
          onDismiss={onDismiss}
          onClip={onClip}
        />
        <button
          type="button"
          className="ma-pronounce-deck-arrow"
          aria-label="Next card"
          disabled={count < 2}
          onClick={() => setIndex((value) => value + 1)}
        >
          <NextGlyph />
        </button>
      </div>
    </div>
  );
}

function GlossaryRow({
  entry,
  project,
  highlight,
  variant = "row",
  dragging,
  shift = 0,
  onRespell,
  onDismiss,
  onClip,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
}: {
  entry: GlossaryEntry;
  project?: BookProject;
  highlight?: boolean;
  variant?: "row" | "card";
  dragging?: boolean;
  shift?: number;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onClip?: (id: string, blob: Blob) => void;
  onGripPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onGripPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onGripPointerUp?: () => void;
}) {
  const [respell, setRespell] = useState(entry.respell ?? "");
  const [playing, setPlaying] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingUrlRef = useRef<string | null>(null);
  const transientPlaybackUrlRef = useRef<string | null>(null);
  const playGenerationRef = useRef(0);
  const aliveRef = useRef(true);
  const respellRef = useRef(respell);
  const rowRef = useRef<HTMLElement | null>(null);
  const saved = (entry.respell ?? "").trim();
  const canRecord = Boolean(onClip);
  const hasClip = Boolean(entry.clip_path || pendingUrl);
  respellRef.current = respell;
  const recorder = useClipRecorder(
    onClip
      ? (blob) => {
          const url = URL.createObjectURL(blob);
          stopAudio();
          setPendingUrl((prev) => {
            if (prev) {
              URL.revokeObjectURL(prev);
            }
            pendingUrlRef.current = url;
            return url;
          });
          const nextGuide = respellRef.current.trim();
          if (nextGuide !== (entry.respell ?? "").trim()) {
            onRespell(entry.id, nextGuide);
          }
          onClip(entry.id, blob);
        }
      : undefined,
  );

  useEffect(() => {
    setRespell(entry.respell ?? "");
  }, [entry.respell]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopAudio();
      if (pendingUrlRef.current) {
        URL.revokeObjectURL(pendingUrlRef.current);
        pendingUrlRef.current = null;
      }
    };
  }, []);

  function stopAudio() {
    playGenerationRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    audioRef.current = null;
    if (transientPlaybackUrlRef.current) {
      URL.revokeObjectURL(transientPlaybackUrlRef.current);
      transientPlaybackUrlRef.current = null;
    }
    if (aliveRef.current) {
      setPlaying(false);
    }
  }

  function commitGuide(nextTarget?: EventTarget | null) {
    if (nextTarget instanceof Node && rowRef.current?.contains(nextTarget)) {
      return;
    }
    if (respell.trim() === saved) {
      return;
    }
    onRespell(entry.id, respell);
  }

  async function togglePlay() {
    const localUrl = pendingUrl;
    if (!localUrl && (!project || !entry.clip_path)) {
      return;
    }
    if (playing) {
      stopAudio();
      return;
    }
    const generation = ++playGenerationRef.current;
    const url = localUrl ?? (project && entry.clip_path ? await readChapterAudioUrl(project, entry.clip_path) : null);
    if (!url) {
      return;
    }
    if (generation !== playGenerationRef.current || !aliveRef.current) {
      if (!localUrl) {
        URL.revokeObjectURL(url);
      }
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    transientPlaybackUrlRef.current = localUrl ? null : url;
    audio.onended = stopAudio;
    audio.onerror = stopAudio;
    setPlaying(true);
    try {
      await audio.play();
    } catch {
      stopAudio();
    }
  }

  const Tag = variant === "card" ? "article" : "li";
  const set = saved || hasClip;
  const className =
    variant === "card"
      ? `ma-pronounce-card${set ? " is-set" : ""}${hasClip ? " has-clip" : ""}${highlight || recorder.fresh ? " is-arrive" : ""}`
      : `ma-glossary-row${set ? " is-set" : ""}${hasClip ? " has-clip" : ""}${highlight || recorder.fresh ? " is-arrive" : ""}${dragging ? " is-dragging" : ""}`;
  const acts = (
    <div className="ma-word-acts">
      {canRecord ? (
        <button
          type="button"
          className={`ma-word-act${recorder.recording ? " is-live" : ""}`}
          aria-label={recorder.recording ? `Stop recording ${entry.spelling}` : `Record ${entry.spelling}`}
          title={recorder.recording ? "Stop" : "Record"}
          onClick={() => recorder.request(hasClip)}
        >
          {recorder.recording ? <WaveGlyph /> : <MicGlyph />}
        </button>
      ) : null}
      {hasClip ? (
        <button
          type="button"
          className={`ma-clip-file${playing ? " is-live" : ""}${recorder.fresh ? " is-fresh" : ""}`}
          aria-label={playing ? `Pause ${entry.spelling}` : `Play ${entry.spelling}`}
          title={playing ? "Pause" : "Play clip"}
          onClick={() => void togglePlay()}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
          <span>Clip</span>
        </button>
      ) : null}
      <button
        type="button"
        className="ma-word-act is-danger"
        aria-label={`Remove ${entry.spelling}`}
        title="Remove"
        onClick={() => onDismiss(entry.id)}
      >
        <TrashGlyph />
      </button>
    </div>
  );
  const guideField = (
    <input
      className="neu-input ma-guide-input"
      value={respell}
      placeholder="Guide"
      aria-label={`Pronunciation guide for ${entry.spelling}`}
      onChange={(event) => setRespell(event.target.value)}
      onBlur={(event) => commitGuide(event.relatedTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitGuide();
          event.currentTarget.blur();
        }
      }}
    />
  );

  return (
    <Tag
      className={className}
      style={variant === "row" && (dragging || shift) ? { transform: `translateY(${shift}px)` } : undefined}
      ref={(node: HTMLElement | null) => {
        rowRef.current = node;
      }}
    >
      {variant === "row" && onGripPointerDown ? (
        <button
          type="button"
          className="ma-block-grip"
          aria-label={`Reorder ${entry.spelling}`}
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
          onLostPointerCapture={onGripPointerUp}
        >
          <GripGlyph />
        </button>
      ) : null}
      <strong className="ma-scroll-x">{entry.spelling}</strong>
      {guideField}
      {acts}
      {recorder.ask ? (
        <ReplaceClipAsk word={entry.spelling} onCancel={recorder.cancelAsk} onConfirm={recorder.confirmReplace} />
      ) : null}
    </Tag>
  );
}

function GripGlyph() {
  return (
    <svg viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="3" r="1.15" />
      <circle cx="8" cy="3" r="1.15" />
      <circle cx="4" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="4" cy="13" r="1.15" />
      <circle cx="8" cy="13" r="1.15" />
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

function WaveGlyph() {
  return (
    <span className="ma-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.4 12.4 8 5.2 12.6V3.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.4h1.8v9.2H5zM9.2 3.4H11v9.2H9.2z" fill="currentColor" />
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

function UndoGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 7.2H12a3 3 0 0 1 0 6H9.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6.4 4.8 4 7.2l2.4 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PrevGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10.2 3.4 5.4 8l4.8 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NextGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.8 3.4 10.6 8 5.8 12.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
