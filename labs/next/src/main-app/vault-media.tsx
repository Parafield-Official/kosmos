import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { readChapterAudioUrl, readChapterContent, type BookProject } from "./store";
import { readPromptTheme } from "./reading-prefs";

const SPEEDS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

function bookHasAudiobook(project: BookProject): boolean {
  return project.chapters.length > 0 && project.chapters.every((chapter) => chapter.mastered && Boolean(chapter.masteredFile));
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function shuffleIds(ids: string[], keepFirst: string): string[] {
  const rest = ids.filter((id) => id !== keepFirst);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = rest[index];
    const other = rest[swap];
    if (current === undefined || other === undefined) {
      continue;
    }
    rest[index] = other;
    rest[swap] = current;
  }
  return ids.includes(keepFirst) ? [keepFirst, ...rest] : rest;
}

function MediaFrame({
  embedded,
  onBack,
  children,
}: {
  embedded?: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className={embedded ? "vault-media-embed" : "vault-sheet-layer"} onClick={embedded ? undefined : onBack}>
      {children}
    </div>
  );
}

export function VaultReadSheet({
  project,
  onBack,
  embedded,
}: {
  project: BookProject;
  onBack: () => void;
  embedded?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [paper] = useState(() => readPromptTheme());
  const scrollRef = useRef<HTMLDivElement>(null);
  const chapter = project.chapters[index] ?? null;
  const chapterKey = chapter?.id;
  const last = Math.max(0, project.chapters.length - 1);

  useEffect(() => {
    if (!chapterKey) {
      setHtml("");
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void readChapterContent(project, chapterKey).then((content) => {
      if (!alive) {
        return;
      }
      setHtml(content);
      setLoading(false);
      scrollRef.current?.scrollTo({ top: 0 });
    });
    return () => {
      alive = false;
    };
  }, [project, chapterKey]);

  function go(delta: number) {
    setIndex((current) => Math.min(last, Math.max(0, current + delta)));
  }

  return (
    <MediaFrame embedded={embedded} onBack={onBack}>
      <article
        className="vault-read"
        role="dialog"
        aria-labelledby="vault-read-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="vault-read-head">
          <button type="button" className="vault-media-back" onClick={onBack}>
            <BackGlyph />
            <span>Back</span>
          </button>
          <h2 className="vault-read-chapter-name" id="vault-read-title">
            {chapter?.title ?? "Untitled"}
          </h2>
        </header>
        <div className={`vault-read-page is-${paper} ma-prose`} ref={scrollRef}>
          {loading ? (
            <p className="vault-read-empty">Loading…</p>
          ) : html.trim() ? (
            <div className="vault-read-prose" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="vault-read-empty">This chapter has no text yet.</p>
          )}
        </div>
        <footer className="vault-read-nav">
          <button type="button" className="vault-media-text-btn" disabled={index === 0} onClick={() => go(-1)}>
            Previous
          </button>
          <span className="vault-read-index">
            {index + 1} / {project.chapters.length}
          </span>
          <button type="button" className="vault-media-text-btn" disabled={index >= last} onClick={() => go(1)}>
            Next
          </button>
        </footer>
      </article>
    </MediaFrame>
  );
}

export function VaultListenSheet({
  seed,
  library,
  renderCover,
  onBack,
  embedded,
}: {
  seed: BookProject;
  library: BookProject[];
  renderCover: (project: BookProject) => ReactNode;
  onBack: () => void;
  embedded?: boolean;
}) {
  const shelf = useMemo(() => {
    if (embedded) {
      return bookHasAudiobook(seed) ? [seed] : [];
    }
    const completed = library.filter(bookHasAudiobook);
    if (completed.some((item) => item.id === seed.id)) {
      return completed;
    }
    return bookHasAudiobook(seed) ? [seed, ...completed] : completed;
  }, [embedded, library, seed]);
  const shelfIds = useMemo(() => shelf.map((item) => item.id), [shelf]);
  const [bookId, setBookId] = useState(seed.id);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [order, setOrder] = useState(() => (shelfIds.includes(seed.id) ? shelfIds : [seed.id, ...shelfIds]));
  const [shuffle, setShuffle] = useState(false);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof SPEEDS)[number]>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wantPlayRef = useRef(true);
  const seekingRef = useRef(false);
  const rateRef = useRef(rate);
  const durationRef = useRef(duration);
  const shelfRef = useRef(shelf);
  const seedRef = useRef(seed);
  const advanceRef = useRef<() => void>(() => undefined);

  rateRef.current = rate;
  durationRef.current = duration;
  shelfRef.current = shelf;
  seedRef.current = seed;

  const book = shelf.find((item) => item.id === bookId) ?? seed;
  const chapter = book.chapters[chapterIndex] ?? null;
  const canSkip = !embedded && shelf.length > 1;
  const orderIndex = Math.max(0, order.indexOf(bookId));
  const atStart = orderIndex <= 0;
  const atEnd = orderIndex >= order.length - 1;
  const played = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    setOrder((current) => {
      const next = shelfIds.filter((id) => current.includes(id) || id === bookId);
      const missing = shelfIds.filter((id) => !next.includes(id));
      const merged = [...next, ...missing].filter((id) => shelfIds.includes(id));
      return merged.length ? merged : shelfIds;
    });
  }, [shelfIds, bookId]);

  useEffect(() => {
    const current = shelfRef.current.find((item) => item.id === bookId) ?? seedRef.current;
    const file = current.chapters[chapterIndex]?.masteredFile;
    const audio = new Audio();
    audioRef.current = audio;
    audio.playbackRate = rateRef.current;
    let objectUrl: string | null = null;
    let revoked = false;

    function onTime() {
      if (seekingRef.current) {
        return;
      }
      setCurrentTime(audio.currentTime);
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    }

    function onPlay() {
      setPlaying(true);
    }

    function onPause() {
      if (!seekingRef.current) {
        setPlaying(false);
      }
    }

    function onEnded() {
      advanceRef.current();
    }

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    async function load() {
      if (!file) {
        return;
      }
      const url = await readChapterAudioUrl(current, file);
      if (revoked || !url) {
        return;
      }
      objectUrl = url;
      audio.src = url;
      audio.playbackRate = rateRef.current;
      setCurrentTime(0);
      if (!wantPlayRef.current) {
        return;
      }
      try {
        await audio.play();
      } catch {
        wantPlayRef.current = false;
        setPlaying(false);
      }
    }

    void load();

    return () => {
      revoked = true;
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [bookId, chapterIndex]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  function skipBook(delta: number) {
    if (!canSkip) {
      return;
    }
    const liveOrder = order.filter((id) => shelfIds.includes(id));
    const index = liveOrder.indexOf(bookId);
    let next = index + delta;
    if (loop) {
      next = (next + liveOrder.length) % liveOrder.length;
    } else if (next < 0 || next >= liveOrder.length) {
      return;
    }
    const nextId = liveOrder[next];
    if (!nextId) {
      return;
    }
    setBookId(nextId);
    setChapterIndex(0);
    setCurrentTime(0);
  }

  advanceRef.current = () => {
    if (chapterIndex < book.chapters.length - 1) {
      setChapterIndex((current) => current + 1);
      return;
    }
    if (canSkip) {
      const liveOrder = order.filter((id) => shelfIds.includes(id));
      const index = liveOrder.indexOf(bookId);
      if (index < liveOrder.length - 1) {
        const nextId = liveOrder[index + 1];
        if (nextId) {
          setBookId(nextId);
          setChapterIndex(0);
          return;
        }
      } else if (loop) {
        const first = liveOrder[0];
        if (first) {
          if (first === bookId && chapterIndex === 0) {
            restartCurrent();
            return;
          }
          setBookId(first);
          setChapterIndex(0);
          return;
        }
      }
    } else if (!embedded && loop) {
      if (chapterIndex === 0) {
        restartCurrent();
        return;
      }
      setChapterIndex(0);
      return;
    }
    wantPlayRef.current = false;
    setPlaying(false);
  };

  function restartCurrent() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    setCurrentTime(0);
    wantPlayRef.current = true;
    void audio.play();
  }

  function previous() {
    if (currentTime > 3) {
      restartCurrent();
      return;
    }
    skipBook(-1);
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      wantPlayRef.current = false;
      audio.pause();
      return;
    }
    wantPlayRef.current = true;
    try {
      await audio.play();
    } catch {
      wantPlayRef.current = false;
      setPlaying(false);
    }
  }

  function cycleSpeed() {
    const index = SPEEDS.indexOf(rate);
    setRate(SPEEDS[(index + 1) % SPEEDS.length] ?? 1);
  }

  function toggleShuffle() {
    setShuffle((on) => {
      const next = !on;
      setOrder(next ? shuffleIds(shelfIds, bookId) : shelfIds);
      return next;
    });
  }

  function seekFromClientX(clientX: number, el: HTMLElement) {
    const box = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(box.width, 1)));
    const length = durationRef.current;
    const time = ratio * length;
    setCurrentTime(time);
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = ratio * audio.duration;
    }
  }

  function onSeekPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (duration <= 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    seekingRef.current = true;
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function onSeekPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!seekingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function onSeekPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    seekingRef.current = false;
  }

  return (
    <MediaFrame embedded={embedded} onBack={onBack}>
      <article
        className={embedded ? "vault-listen is-simple" : "vault-listen"}
        role="dialog"
        aria-labelledby="vault-listen-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="vault-media-back" onClick={onBack}>
          <BackGlyph />
          <span>Back</span>
        </button>
        <div className="vault-listen-cover">{renderCover(book)}</div>
        <h2 className="vault-listen-title" id="vault-listen-title">
          {book.title}
        </h2>
        <p className="vault-listen-author">{book.author.trim() || "Unknown author"}</p>
        <p className="vault-listen-chapter">{chapter?.title ?? "Audiobook"}</p>

        <div
          className="vault-listen-seek"
          role="slider"
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
          tabIndex={0}
          onPointerDown={onSeekPointerDown}
          onPointerMove={onSeekPointerMove}
          onPointerUp={onSeekPointerUp}
          onPointerCancel={onSeekPointerUp}
          onKeyDown={(event) => {
            if (duration <= 0) {
              return;
            }
            const step = event.shiftKey ? 10 : 5;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const audio = audioRef.current;
              if (!audio) {
                return;
              }
              audio.currentTime = Math.min(
                duration,
                Math.max(0, audio.currentTime + (event.key === "ArrowRight" ? step : -step)),
              );
              setCurrentTime(audio.currentTime);
            }
          }}
        >
          <span className="vault-listen-seek-track">
            <i style={{ width: `${played * 100}%` }} />
          </span>
        </div>
        <div className="vault-listen-times">
          <span>{formatClock(currentTime)}</span>
          <span>{formatClock(duration)}</span>
        </div>

        <div className="vault-listen-transport">
          {embedded ? null : (
            <button
              type="button"
              className={shuffle ? "vault-listen-icon is-on" : "vault-listen-icon"}
              aria-pressed={shuffle}
              aria-label="Shuffle completed audiobooks"
              disabled={!canSkip}
              onClick={toggleShuffle}
            >
              <ShuffleGlyph />
            </button>
          )}
          {embedded ? null : (
            <button
              type="button"
              className="vault-listen-icon"
              aria-label="Previous audiobook"
              disabled={currentTime <= 3 && (!canSkip || (!loop && atStart))}
              onClick={previous}
            >
              <SkipPrevGlyph />
            </button>
          )}
          <button
            type="button"
            className="vault-listen-play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => void togglePlay()}
          >
            {playing ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          {embedded ? null : (
            <button
              type="button"
              className="vault-listen-icon"
              aria-label="Next audiobook"
              disabled={!canSkip || (!loop && atEnd)}
              onClick={() => skipBook(1)}
            >
              <SkipNextGlyph />
            </button>
          )}
          {embedded ? null : (
            <button
              type="button"
              className={loop ? "vault-listen-icon is-on" : "vault-listen-icon"}
              aria-pressed={loop}
              aria-label="Loop"
              onClick={() => setLoop((on) => !on)}
            >
              <LoopGlyph />
            </button>
          )}
        </div>
        {embedded ? null : (
          <button type="button" className="vault-listen-speed" aria-label="Playback speed" onClick={cycleSpeed}>
            {rate === 1 ? "1×" : `${rate}×`}
          </button>
        )}
      </article>
    </MediaFrame>
  );
}

function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 5.5 8 12l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShuffleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h2.8c.9 0 1.7.4 2.2 1.1L16.8 17c.5.7 1.3 1.1 2.2 1.1H21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18.2 5.8 21 8l-2.8 2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.2 14.8 21 17l-2.8 2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17h2.8c.9 0 1.7-.4 2.2-1.1L11 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SkipPrevGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18.5 6.2 11 12l7.5 5.8V6.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6.4 6.4v11.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SkipNextGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 6.2 13 12l-7.5 5.8V6.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M17.6 6.4v11.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.2 5.8v12.4L18.6 12 8.2 5.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 6.4h2.4v11.2H8V6.4ZM13.6 6.4H16v11.2h-2.4V6.4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function LoopGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.2 7.2h8.2a3.4 3.4 0 0 1 3.4 3.4v1.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M16.2 5.4 18.8 7.2 16.2 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M16.8 16.8H8.6A3.4 3.4 0 0 1 5.2 13.4v-1.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M7.8 18.6 5.2 16.8 7.8 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
