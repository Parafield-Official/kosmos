import { useEffect, useMemo, useRef, useState } from "react";
import { pickupKindPresentation } from "../../../../src/core/proof/pickup-display";
import { buildPickupSession } from "../../../../src/core/proof/pickup-session";
import { pickupLineBounds } from "../../../../src/core/teleprompter/session-tape";
import { DebugFinishTakeButton } from "./DebugFinishTakeButton";
import { paragraphsFromHtml } from "./booth";
import { PunchRecorder } from "./PunchRecorder";
import { applyPunchRecording, previewPunchRecording, undoLatestChapterPunch } from "./punch";
import { ReviewScript } from "./ReviewScript";
import { workingChapterTranscript } from "./review-timing";
import { addSuppressedWord, suppressLabel } from "./suppress";
import {
  applyChapterPickups,
  readChapterAudioUrl,
  readChapterContent,
  type BookProject,
  type ChapterPickup,
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
}: {
  project: BookProject;
  chapterId: string;
  onBack: () => void;
  onChange: (next: BookProject) => void;
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
  const [manuscript, setManuscript] = useState("");
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
    .filter((pickup) => pickup.status === "open")
    .sort((left, right) => (left.line_start ?? left.t_start) - (right.line_start ?? right.t_start));
  const resolved = (current.pickups ?? []).filter((pickup) => pickup.status !== "open");
  const canUndo = (current.punches ?? []).some((punch) => punch.edit_status !== "reverted");

  function stopPlayback() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
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
    audio.currentTime = Math.max(0, bounds.start - pad);
    const stopAt = bounds.end + pad;
    const key = `${slot}-${pickup.id}`;
    setPlaying(key);
    const onTime = () => {
      if (audio.currentTime >= stopAt) {
        audio.pause();
        audio.removeEventListener("timeupdate", onTime);
        setPlaying(null);
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", () => setPlaying(null));
    void audio.play().catch(() => setPlaying(null));
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

  function startSession() {
    const session = buildPickupSession(current.pickups ?? []);
    const first = session.items[0];
    if (!first) {
      return;
    }
    setSessionTotal(session.items.length);
    setSessionIndex(0);
    setSessionIds(first.pickupIds);
    setPunching(first.pickup);
    setError(null);
  }

  async function applyWav(wav: Uint8Array) {
    if (!punching) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ids = sessionIds ?? [punching.id];
      const next = await applyPunchRecording(project, chapterId, punching, wav, ids);
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

  async function undoLatest() {
    setBusy(true);
    setError(null);
    try {
      onChange(await undoLatestChapterPunch(project, chapterId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not undo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ma-screen ma-review" aria-label={`Review ${chapter.title}`}>
      <header className="ma-overview-head">
        <button type="button" className="ma-back" onClick={onBack} aria-label="Back to chapter">
          <ChevronLeft />
          <span>{chapter.title}</span>
        </button>
        <div className="ma-chapter-head-actions">
          {open.length > 0 ? (
            <button type="button" className="btn" onClick={startSession} disabled={busy}>
              Fix open flags
            </button>
          ) : null}
          {canUndo ? (
            <button type="button" className="btn btn-clear" onClick={() => void undoLatest()} disabled={busy}>
              Undo latest punch
            </button>
          ) : null}
          <DebugFinishTakeButton project={project} chapterId={chapterId} onChange={onChange} />
        </div>
      </header>

      {error && !punching ? <p className="ma-error">{error}</p> : null}
      {notice ? <p className="ma-review-note">{notice}</p> : null}

      {manuscript ? (
        <ReviewScript
          chapterId={chapterId}
          manuscript={manuscript}
          transcript={transcript}
          sourceKind={chapter.recordedWords?.length ? "live" : "take"}
          onRedo={(pickup) => {
            setSessionIds(null);
            setPunching(pickup);
            setError(null);
          }}
        />
      ) : null}

      {open.length === 0 ? (
        <p className="ma-chapter-empty">
          {resolved.length
            ? "No open flags. Kept takes and punched lines are filed below."
            : "No flags on this chapter. Listen through the take once, then master."}
        </p>
      ) : (
        <ul className="ma-pickup-list">
          {open.map((pickup) => (
            <PickupRow
              key={pickup.id}
              pickup={pickup}
              playing={playing}
              hasOriginal={Boolean(chapter.originalFile)}
              hasWorking={Boolean(chapter.workingFile)}
              onPlayOriginal={() => playRange("original", pickup)}
              onPlayWorking={() => playRange("working", pickup)}
              onKeep={() => patchPickup(pickup, "ignored")}
              onFixed={() => patchPickup(pickup, "done")}
              onNeverFlag={pickup.kind === "pause" ? undefined : () => neverFlag(pickup)}
              onPunch={() => {
                setSessionIds(null);
                setPunching(pickup);
                setError(null);
              }}
            />
          ))}
        </ul>
      )}

      {resolved.length > 0 ? (
        <div className="ma-pickup-resolved">
          <h2 className="ma-section-title">Filed</h2>
          <ul className="ma-pickup-list ma-pickup-list-quiet">
            {resolved.map((pickup) => (
              <li key={pickup.id} className="ma-pickup-row neu-inset">
                <span className="ma-pickup-kind">{pickup.status === "ignored" ? "Kept" : "Fixed"}</span>
                <p className="ma-pickup-line">{pickup.line_text || pickup.expected || pickup.heard}</p>
                <button type="button" className="btn btn-sm" onClick={() => patchPickup(pickup, "open")}>
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {punching ? (
        <PunchRecorder
          pickup={punching}
          progress={sessionIds ? `Flag ${sessionIndex + 1} of ${sessionTotal}` : "Record this line"}
          busy={busy}
          error={error}
          onCancel={() => {
            setPunching(null);
            setSessionIds(null);
            setError(null);
          }}
          onPreview={(wav) => previewPunchRecording(project, chapterId, punching, wav)}
          onApply={(wav) => void applyWav(wav)}
        />
      ) : null}
    </section>
  );
}

function PickupRow({
  pickup,
  playing,
  hasOriginal,
  hasWorking,
  onPlayOriginal,
  onPlayWorking,
  onKeep,
  onFixed,
  onNeverFlag,
  onPunch,
}: {
  pickup: ChapterPickup;
  playing: string | null;
  hasOriginal: boolean;
  hasWorking: boolean;
  onPlayOriginal: () => void;
  onPlayWorking: () => void;
  onKeep: () => void;
  onFixed: () => void;
  onNeverFlag?: () => void;
  onPunch: () => void;
}) {
  const kind = pickupKindPresentation(pickup.kind);
  const bounds = pickupLineBounds(pickup);
  return (
    <li className="ma-pickup-row neu-card">
      <div className="ma-pickup-head">
        <span className={`ma-pickup-kind ma-pickup-${kind.tone}`}>{kind.label}</span>
        <span className="ma-pickup-time">
          {bounds.start.toFixed(1)}s – {bounds.end.toFixed(1)}s
        </span>
      </div>
      <p className="ma-pickup-line">{pickup.line_text || pickup.expected || "—"}</p>
      {pickup.heard && pickup.heard !== pickup.expected ? (
        <p className="ma-pickup-heard">Heard “{pickup.heard}”</p>
      ) : null}
      <div className="ma-step-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!hasOriginal}
          onClick={onPlayOriginal}
          aria-pressed={playing === `original-${pickup.id}`}
        >
          {playing === `original-${pickup.id}` ? "Playing original" : "Listen original"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!hasWorking}
          onClick={onPlayWorking}
          aria-pressed={playing === `working-${pickup.id}`}
        >
          {playing === `working-${pickup.id}` ? "Playing working" : "Listen working"}
        </button>
        <button type="button" className="btn btn-sm" onClick={onKeep}>
          Keep take
        </button>
        <button type="button" className="btn btn-sm" onClick={onFixed}>
          Mark fixed
        </button>
        <button type="button" className="btn btn-sm" onClick={onPunch}>
          Punch-in
        </button>
        {onNeverFlag && suppressLabel(pickup) ? (
          <button type="button" className="btn btn-sm btn-clear" onClick={onNeverFlag}>
            Never flag “{suppressLabel(pickup)}”
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
