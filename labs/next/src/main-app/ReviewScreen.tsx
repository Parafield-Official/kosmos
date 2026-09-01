import { useEffect, useMemo, useRef, useState } from "react";
import { pickupKindPresentation } from "../../../../src/core/proof/pickup-display";
import { buildPickupSession } from "../../../../src/core/proof/pickup-session";
import { pickupLineBounds } from "../../../../src/core/teleprompter/session-tape";
import { BoothReadingPanel } from "./BoothReadingPanel";
import { BoothSheet } from "./BoothSheet";
import { paragraphsFromHtml } from "./booth";
import { flagKindLabel } from "./flag-kind";
import { PunchRecorder } from "./PunchRecorder";
import { applyPunchRecording, previewPunchRecording } from "./punch";
import { ReviewScript } from "./ReviewScript";
import { markKindEnabled } from "./engine-prefs";
import {
  readBoothFontPx,
  readPromptTheme,
  writeBoothFontPx,
  writePromptTheme,
} from "./reading-prefs";
import { originalChapterTranscript, workingChapterTranscript } from "./review-timing";
import { addSuppressedWord, suppressLabel } from "./suppress";
import {
  applyChapterPickups,
  readChapterAudioUrl,
  readChapterContent,
  type BookProject,
  type ChapterPickup,
  type PromptHighlightMode,
} from "./store";

/**
 * Listen to flagged ranges on original vs working, keep a take, or punch a
 * retake into the working file.
 */
export function ReviewScreen({
  project,
  chapterId,
  onBack,
  onChange,
  embedded,
  onStartOver,
}: {
  project: BookProject;
  chapterId: string;
  onBack: () => void;
  onChange: (next: BookProject) => void;
  embedded?: boolean;
  onStartOver?: () => void;
}) {
  const chapter = useMemo(
    () => project.chapters.find((item) => item.id === chapterId) ?? null,
    [project, chapterId],
  );
  const [punching, setPunching] = useState<ChapterPickup | null>(null);
  const [sessionIds, setSessionIds] = useState<string[] | null>(null);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playAt, setPlayAt] = useState<number | null>(null);
  const [manuscript, setManuscript] = useState("");
  const [highlight, setHighlight] = useState<PromptHighlightMode>("word");
  const [theme, setTheme] = useState(readPromptTheme);
  const [fontPx, setFontPx] = useState(readBoothFontPx);
  const [lineSpacing, setLineSpacing] = useState(1.55);
  const [readingOpen, setReadingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreId, setMoreId] = useState<string | null>(null);
  const originalUrl = useRef<string | null>(null);
  const workingUrl = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readChapterContent(project, chapterId).then((html) => {
      if (!cancelled) {
        setManuscript(paragraphsFromHtml(html).join("\n"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project, chapterId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!chapter) {
        return;
      }
      if (originalUrl.current) {
        URL.revokeObjectURL(originalUrl.current);
        originalUrl.current = null;
      }
      if (workingUrl.current) {
        URL.revokeObjectURL(workingUrl.current);
        workingUrl.current = null;
      }
      if (chapter.originalFile) {
        const url = await readChapterAudioUrl(project, chapter.originalFile);
        if (!cancelled) {
          originalUrl.current = url;
        }
      }
      if (chapter.workingFile) {
        const url = await readChapterAudioUrl(project, chapter.workingFile);
        if (!cancelled) {
          workingUrl.current = url;
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      if (originalUrl.current) {
        URL.revokeObjectURL(originalUrl.current);
      }
      if (workingUrl.current) {
        URL.revokeObjectURL(workingUrl.current);
      }
    };
  }, [chapter, project]);

  const transcript = useMemo(
    () => (chapter && manuscript ? workingChapterTranscript(manuscript, chapter) : []),
    [chapter, manuscript],
  );
  const originalTranscript = useMemo(
    () => (chapter && manuscript ? originalChapterTranscript(manuscript, chapter) : []),
    [chapter, manuscript],
  );

  if (!chapter) {
    return (
      <section className="ma-screen ma-review" aria-label="Review">
        <button type="button" className="ma-back" onClick={onBack}>
          <ChevronLeft />
          <span>{project.title}</span>
        </button>
        <p className="ma-chapter-empty">This chapter no longer exists.</p>
      </section>
    );
  }

  const current = chapter;

  const open = (current.pickups ?? [])
    .filter((pickup) => pickup.status === "open" && markKindEnabled(pickup.kind))
    .sort((left, right) => (left.line_start ?? left.t_start) - (right.line_start ?? right.t_start));
  const morePickup = open.find((item) => item.id === moreId) ?? null;
  const resolved = (current.pickups ?? []).filter((pickup) => pickup.status !== "open");
  const punches = (current.punches ?? []).filter((punch) => punch.edit_status !== "reverted");
  const focusedPickupId = playing?.includes("-") ? playing.slice(playing.indexOf("-") + 1) : null;

  function stopPlayback() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
    setPlayAt(null);
  }

  function playRange(slot: "original" | "working", pickup: ChapterPickup) {
    const url = slot === "original" ? originalUrl.current : workingUrl.current;
    if (!url) {
      return;
    }
    stopPlayback();
    const bounds = pickupLineBounds(pickup);
    const pad = bounds.wordOnly ? 0.5 : 0.15;
    const audio = new Audio(url);
    audioRef.current = audio;
    const startAt = Math.max(0, bounds.start - pad);
    audio.currentTime = startAt;
    const stopAt = bounds.end + pad;
    const key = `${slot}-${pickup.id}`;
    setPlaying(key);
    setPlayAt(startAt);
    const onTime = () => {
      setPlayAt(audio.currentTime);
      if (audio.currentTime >= stopAt) {
        audio.pause();
        audio.removeEventListener("timeupdate", onTime);
        setPlaying(null);
        setPlayAt(null);
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", () => {
      setPlaying(null);
      setPlayAt(null);
    });
    void audio.play().catch(() => {
      setPlaying(null);
      setPlayAt(null);
    });
  }

  function patchPickup(pickup: ChapterPickup, status: ChapterPickup["status"]) {
    onChange(
      applyChapterPickups(
        project,
        chapterId,
        (current.pickups ?? []).map((item) => (item.id === pickup.id ? { ...item, status } : item)),
      ),
    );
  }

  function neverFlag(pickup: ChapterPickup) {
    const word = suppressLabel(pickup);
    if (!word) {
      setNotice("There is no word here to filter.");
      return;
    }
    onChange(addSuppressedWord(project, word));
    setNotice(`“${word}” is filtered for the whole book.`);
  }

  async function applyWav(wav: Uint8Array, bound: ChapterPickup) {
    setBusy(true);
    setError(null);
    try {
      const ids = sessionIds ?? [bound.id];
      const next = await applyPunchRecording(project, chapterId, bound, wav, ids);
      onChange(next);
      const nextChapter = next.chapters.find((item) => item.id === chapterId);
      if (sessionIds) {
        const following = buildPickupSession(nextChapter?.pickups ?? []).items[0];
        if (following) {
          setSessionIndex((index) => index + 1);
          setSessionIds(following.pickupIds);
          setPunching(following.pickup);
        } else {
          setSessionIds(null);
          setPunching(null);
        }
      } else {
        setPunching(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply that punch.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={embedded ? "ma-review-embed" : "ma-screen ma-review"} aria-label={`Review ${chapter.title}`}>
      <header className={embedded ? "booth-chrome" : "ma-overview-head"}>
        {embedded ? null : (
          <button type="button" className="ma-back" onClick={onBack} aria-label="Back to chapter">
            <ChevronLeft />
            <span>{chapter.title}</span>
          </button>
        )}
        <div className={embedded ? "booth-chrome-tools" : "ma-chapter-head-actions"}>
          <button type="button" className="booth-tool is-primary" onClick={() => setReadingOpen(true)} title="Teleprompter settings">
            <TypeGlyph />
            <span>Settings</span>
          </button>
          {resolved.length > 0 || punches.length > 0 ? (
            <button type="button" className="booth-tool" onClick={() => setHistoryOpen(true)}>
              History
            </button>
          ) : null}
          {onStartOver ? (
            <button type="button" className="booth-tool" onClick={onStartOver}>
              Start over
            </button>
          ) : null}
        </div>
      </header>

      {error || notice ? (
        <div className="ma-proof-alerts">
          {error && !punching ? <p className="ma-error">{error}</p> : null}
          {notice ? <p className="ma-review-note">{notice}</p> : null}
        </div>
      ) : null}

      <div className="ma-proof-stage">
      <div className="ma-proof-prompt">
        {manuscript ? (
          <ReviewScript
            chapterId={chapterId}
            chapterTitle={chapter.title}
            manuscript={manuscript}
            transcript={transcript}
            playTranscript={playing?.startsWith("original-") ? originalTranscript : transcript}
            playAt={playAt}
            playKey={playing}
            pickups={open}
            focusedPickupId={focusedPickupId}
            sourceKind={chapter.recordedWords?.length ? "live" : "take"}
            highlight={highlight}
            theme={theme}
            fontPx={fontPx}
            lineSpacing={lineSpacing}
            onRedo={(pickup) => {
              setSessionIds(null);
              setPunching(pickup);
              setError(null);
            }}
          />
        ) : null}
      </div>

      <aside className="ma-proof-side" aria-label="Flagged parts">
        {open.length === 0 ? (
          <p className="ma-chapter-empty">
            {resolved.length || punches.length
              ? "No open flags."
              : "No flags on this chapter."}
          </p>
        ) : (
          <ul className="ma-pickup-list">
            {open.map((pickup) => (
              <PickupRow
                key={pickup.id}
                pickup={pickup}
                playing={playing}
                hasOriginal={Boolean(chapter.originalFile)}
                onPlayOriginal={() => playRange("original", pickup)}
                onMore={() => setMoreId(pickup.id)}
                onPunch={() => {
                  setSessionIds(null);
                  setPunching(pickup);
                  setError(null);
                }}
              />
            ))}
          </ul>
        )}
      </aside>
      </div>

      {readingOpen ? (
        <BoothSheet title="Teleprompter" wide onClose={() => setReadingOpen(false)}>
          <BoothReadingPanel
            highlight={highlight}
            lineSpacing={lineSpacing}
            onHighlight={setHighlight}
            onSpacing={setLineSpacing}
            theme={theme}
            onTheme={(value) => {
              setTheme(value);
              writePromptTheme(value);
            }}
            fontPx={fontPx}
            onFontPx={(value) => setFontPx(writeBoothFontPx(value))}
          />
        </BoothSheet>
      ) : null}

      {morePickup ? (
        <BoothSheet title={(morePickup.expected || morePickup.heard || "Flag").trim() || "Flag"} onClose={() => setMoreId(null)}>
          {morePickup.heard && morePickup.heard !== morePickup.expected ? (
            <p className="booth-sheet-copy">Heard “{morePickup.heard}”.</p>
          ) : null}
          <div className="ma-flag-sheet">
            <button
              type="button"
              className="booth-tool"
              disabled={!chapter.originalFile}
              onClick={() => playRange("original", morePickup)}
            >
              {playing === `original-${morePickup.id}` ? "Pause original" : "Listen original"}
            </button>
            <button
              type="button"
              className="booth-tool"
              disabled={!chapter.workingFile}
              onClick={() => playRange("working", morePickup)}
            >
              {playing === `working-${morePickup.id}` ? "Pause updated" : "Listen updated"}
            </button>
            <button
              type="button"
              className="booth-tool"
              onClick={() => {
                patchPickup(morePickup, "ignored");
                setMoreId(null);
              }}
            >
              Keep this take
            </button>
            <button
              type="button"
              className="booth-tool"
              onClick={() => {
                patchPickup(morePickup, "done");
                setMoreId(null);
              }}
            >
              Mark resolved
            </button>
            {morePickup.kind !== "pause" && suppressLabel(morePickup) ? (
              <button
                type="button"
                className="booth-tool"
                onClick={() => {
                  neverFlag(morePickup);
                  setMoreId(null);
                }}
              >
                Never flag “{suppressLabel(morePickup)}”
              </button>
            ) : null}
          </div>
        </BoothSheet>
      ) : null}

      {historyOpen ? (
        <BoothSheet title="History" onClose={() => setHistoryOpen(false)}>
          <div className="ma-pickup-resolved is-sheet">
            <ul className="ma-pickup-list ma-pickup-list-quiet">
              {resolved.map((pickup) => (
                <li key={pickup.id} className="ma-pickup-row neu-inset">
                  <span className="ma-pickup-kind">{pickup.status === "ignored" ? "Kept" : "Fixed"}</span>
                  <p className="ma-pickup-line">{pickup.line_text || pickup.expected || pickup.heard}</p>
                  <div className="ma-step-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!chapter.originalFile}
                      onClick={() => playRange("original", pickup)}
                    >
                      {playing === `original-${pickup.id}` ? "Playing original" : "Listen original"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!chapter.workingFile}
                      onClick={() => playRange("working", pickup)}
                    >
                      {playing === `working-${pickup.id}` ? "Playing newer" : "Listen newer"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        patchPickup(pickup, "open");
                        setSessionIds(null);
                        setPunching({ ...pickup, status: "open" });
                        setHistoryOpen(false);
                      }}
                    >
                      Re-record
                    </button>
                  </div>
                </li>
              ))}
              {punches.map((punch) => (
                <li key={punch.id} className="ma-pickup-row neu-inset">
                  <span className="ma-pickup-kind">Modified</span>
                  <p className="ma-pickup-line">{punch.expected || punch.heard || `${punch.t_start.toFixed(1)}s`}</p>
                  <div className="ma-step-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const related = (current.pickups ?? []).find((item) => item.id === punch.pickup_id);
                        setHistoryOpen(false);
                        if (related) {
                          setPunching({ ...related, status: "open" });
                          return;
                        }
                        setPunching({
                          id: punch.pickup_id || punch.id,
                          chapter_id: chapterId,
                          t_start: punch.t_start,
                          t_end: punch.t_end,
                          line_start: punch.t_start,
                          line_end: punch.t_end,
                          line_text: punch.expected || "",
                          expected: punch.expected || "",
                          heard: punch.heard || punch.expected || "",
                          kind: "sub",
                          seat: "narration",
                          status: "open",
                          confidence: 1,
                          intent: "performance",
                          selection_kind: "sentence",
                        });
                      }}
                    >
                      Re-record
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </BoothSheet>
      ) : null}

      {punching ? (
        <PunchRecorder
          pickup={punching}
          manuscript={manuscript}
          transcript={transcript}
          flags={open}
          progress={sessionIds ? `Flag ${sessionIndex + 1} of ${sessionTotal}` : "Re-record"}
          busy={busy}
          error={error}
          onCancel={() => {
            setPunching(null);
            setSessionIds(null);
            setError(null);
          }}
          onPreview={(wav, bound) => previewPunchRecording(project, chapterId, bound, wav)}
          onApply={(wav, bound) => void applyWav(wav, bound)}
        />
      ) : null}
    </section>
  );
}

function PickupRow({
  pickup,
  playing,
  hasOriginal,
  onPlayOriginal,
  onMore,
  onPunch,
}: {
  pickup: ChapterPickup;
  playing: string | null;
  hasOriginal: boolean;
  onPlayOriginal: () => void;
  onMore: () => void;
  onPunch: () => void;
}) {
  const kind = pickupKindPresentation(pickup.kind);
  const bounds = pickupLineBounds(pickup);
  const word = (pickup.expected || pickup.heard || "").trim();
  const line = (pickup.line_text || "").trim();
  const hearingOriginal = playing === `original-${pickup.id}`;
  return (
    <li className="ma-pickup-row ma-booth-panel">
      <div className="ma-pickup-head">
        <span className={`ma-pickup-kind ma-pickup-${kind.tone}`}>{flagKindLabel(pickup.kind)}</span>
        <span className="ma-pickup-time">
          {bounds.start.toFixed(1)}s – {bounds.end.toFixed(1)}s
        </span>
      </div>
      <p className="ma-pickup-word">{word || "—"}</p>
      {pickup.heard && pickup.heard !== pickup.expected ? (
        <p className="ma-pickup-heard">Heard “{pickup.heard}”</p>
      ) : null}
      {line && line !== word ? <p className="ma-pickup-line">{line}</p> : null}
      <div className="ma-flag-bar">
        <button
          type="button"
          className="booth-tool is-icon"
          disabled={!hasOriginal}
          onClick={onPlayOriginal}
          aria-pressed={hearingOriginal}
          aria-label={hearingOriginal ? "Pause original" : "Listen to original"}
          title={hearingOriginal ? "Pause" : "Listen"}
        >
          {hearingOriginal ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <button
          type="button"
          className="booth-tool is-icon"
          onClick={onPunch}
          aria-label="Re-record this word"
          title="Re-record"
        >
          <MicGlyph />
        </button>
        <button
          type="button"
          className="booth-tool is-icon"
          onClick={onMore}
          aria-label="More actions"
          title="More"
        >
          <MoreGlyph />
        </button>
      </div>
    </li>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.4 12.4 8 5.2 12.6V3.4Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.4h2v9.2H5zM9 3.4h2v9.2H9z" fill="currentColor" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.6" y="2.4" width="4.8" height="7.2" rx="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.8 8.2a4.2 4.2 0 0 0 8.4 0M8 12.4V13.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.6" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12.4" cy="8" r="1.15" fill="currentColor" />
    </svg>
  );
}

function TypeGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 4.2V3.2h9.6v1M8 3.2v9.6M5.8 12.8h4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
