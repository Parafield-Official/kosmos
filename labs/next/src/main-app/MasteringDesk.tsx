import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AcxReport } from "../../../../src/core/acx/measure";
import { ChapterMeter, quietListenRange } from "./ChapterMeter";
import { readEnginePrefs, writeEnginePrefs, SPEC_PRESET_OPTIONS, type SpecPresetId } from "./engine-prefs";
import { masterChapterWorking } from "./punch";
import { formatTapeTime } from "./TapePlayer";
import { readChapterAudioUrl, type BookProject } from "./store";

const SOUND_WAVE = [22, 22, 22, 24, 28, 36, 48, 64, 78, 92, 78, 64, 48, 36, 28, 24, 22, 22, 22];

export type MasteringTake = "original" | "working" | "mastered";

const DEFAULT_TAKES: MasteringTake[] = ["original", "working", "mastered"];
const ALL_TAKES: Array<{ id: MasteringTake; label: string }> = [
  { id: "original", label: "Original" },
  { id: "working", label: "Unmastered" },
  { id: "mastered", label: "Mastered" },
];

export function MasteringDesk({
  project,
  chapterId,
  onChange,
  onNextChapter,
  compareTakes = DEFAULT_TAKES,
  locked = false,
  heading,
  actionKicker = "Master",
  compareHint,
  leadAction,
}: {
  project: BookProject;
  chapterId: string;
  onChange: (next: BookProject) => void;
  onNextChapter?: () => void;
  compareTakes?: MasteringTake[];
  locked?: boolean;
  heading?: string;
  actionKicker?: string;
  compareHint?: string;
  leadAction?: ReactNode;
}) {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  const [mastering, setMastering] = useState(false);
  const [casting, setCasting] = useState(false);
  const castTimer = useRef<number>(0);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [listen, setListen] = useState<MasteringTake>("original");
  const [preset, setPreset] = useState<SpecPresetId>(() => readEnginePrefs().spec_preset_id);
  const [clock, setClock] = useState({ current: 0, duration: 0 });
  const [measureNonce, setMeasureNonce] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);
  const takes = ALL_TAKES.filter((item) => compareTakes.includes(item.id));
  const busy = mastering || locked;

  function releaseAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    loadedRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  useEffect(
    () => () => {
      releaseAudio();
      window.clearTimeout(castTimer.current);
    },
    [],
  );

  function castMaster() {
    if (busy) {
      return;
    }
    window.clearTimeout(castTimer.current);
    setCasting(true);
    castTimer.current = window.setTimeout(() => setCasting(false), 720);
  }

  useEffect(() => {
    if (chapter?.masteredFile && compareTakes.includes("mastered")) {
      setListen("mastered");
    } else if (chapter?.workingFile && compareTakes.includes("working")) {
      setListen("working");
    } else {
      setListen("original");
    }
  }, [chapter?.masteredFile, chapter?.workingFile, chapter?.originalFile, compareTakes]);

  useEffect(() => {
    const file = chapter?.masteredFile;
    if (!file || !project.folder || !window.kosmosNext?.measureChapter) {
      return;
    }
    let cancelled = false;
    void window.kosmosNext
      .measureChapter({
        folder: project.folder,
        file,
        presetId: readEnginePrefs().spec_preset_id,
      })
      .then((result) => {
        if (cancelled || !result.ok || !result.report) {
          return;
        }
        setAcxReport(result.report);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chapter?.masteredFile, project.folder, measureNonce]);

  if (!chapter) {
    return null;
  }
  const current = chapter;
  const listenFile =
    listen === "mastered" ? current.masteredFile : listen === "working" ? current.workingFile : current.originalFile;

  async function runMaster() {
    setMasterError(null);
    setMastering(true);
    try {
      onChange(await masterChapterWorking(project, chapterId));
      setAcxReport(null);
      setMeasureNonce((value) => value + 1);
    } catch (reason) {
      setMasterError(reason instanceof Error ? reason.message : "Mastering failed.");
    } finally {
      setMastering(false);
    }
  }

  function tickClock(audio: HTMLAudioElement) {
    setClock({
      current: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });
  }

  async function playSlot(file: string | undefined, id: string) {
    if (!file) {
      return;
    }
    releaseAudio();
    const url = await readChapterAudioUrl(project, file);
    if (!url) {
      return;
    }
    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    loadedRef.current = id;
    setPlaying(id);
    const onTime = () => tickClock(audio);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("ended", () => {
      setPlaying(null);
      tickClock(audio);
    });
    void audio.play().catch(() => {
      setPlaying(null);
    });
  }

  function toggleListen() {
    const audio = audioRef.current;
    if (audio && loadedRef.current === listen) {
      if (playing === listen) {
        audio.pause();
        setPlaying(null);
        return;
      }
      void audio
        .play()
        .then(() => setPlaying(listen))
        .catch(() => setPlaying(null));
      return;
    }
    void playSlot(listenFile, listen);
  }

  function seekListen(event: { currentTarget: HTMLDivElement; clientX: number }) {
    const audio = audioRef.current;
    if (!audio || clock.duration <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const next = ((event.clientX - rect.left) / Math.max(1, rect.width)) * clock.duration;
    audio.currentTime = Math.max(0, Math.min(clock.duration, next));
    tickClock(audio);
  }

  async function listenQuiet() {
    if (!acxReport) {
      return;
    }
    const file = current.masteredFile ?? current.workingFile ?? current.originalFile;
    if (!file) {
      return;
    }
    releaseAudio();
    const url = await readChapterAudioUrl(project, file);
    if (!url) {
      return;
    }
    urlRef.current = url;
    const range = quietListenRange(acxReport);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.currentTime = range.start;
    const onTime = () => {
      if (audio.currentTime >= range.end) {
        audio.pause();
        audio.removeEventListener("timeupdate", onTime);
        URL.revokeObjectURL(url);
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    void audio.play().catch(() => URL.revokeObjectURL(url));
  }

  const listenPct = clock.duration > 0 ? Math.min(100, (clock.current / clock.duration) * 100) : 0;

  return (
    <div className="quest-master">
      <div className="quest-master-desk">
        <section className="quest-master-listen">
          <p className="quest-master-kicker">Listen</p>
          {heading ? <h2 className="quest-master-heading">{heading}</h2> : null}
          <div className={`quest-waves${playing ? " is-live" : ""}`} aria-hidden="true">
            {SOUND_WAVE.map((height, index) => (
              <i
                key={index}
                style={{
                  height: `${height}%`,
                  animationDelay: `${index * 40}ms`,
                  animationDuration: `${0.55 + (index % 4) * 0.12}s`,
                }}
              />
            ))}
          </div>
          <div className="quest-player">
            <div className="quest-player-transport">
              <button
                type="button"
                className="quest-listen-play"
                disabled={!listenFile}
                onClick={toggleListen}
                aria-label={playing === listen ? "Pause" : "Play"}
              >
                {playing === listen ? <PauseListenGlyph /> : <PlayListenGlyph />}
              </button>
              <div
                className="quest-player-seek"
                role="slider"
                aria-valuemin={0}
                aria-valuemax={Math.round(clock.duration)}
                aria-valuenow={Math.round(clock.current)}
                aria-label="Take position"
                style={{ ["--tape-pct" as string]: `${listenPct}%` }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  seekListen(event);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    seekListen(event);
                  }
                }}
              >
                <i style={{ width: `${listenPct}%` }} />
              </div>
              <span className="quest-player-time">
                {formatTapeTime(clock.current)} / {formatTapeTime(clock.duration)}
              </span>
            </div>
            <div className="quest-listen-legend">
              <div className="quest-listen-sources" role="tablist" aria-label="Which take to hear">
                {takes.map((item) => {
                  const file =
                    item.id === "mastered"
                      ? chapter.masteredFile
                      : item.id === "working"
                        ? chapter.workingFile
                        : chapter.originalFile;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={listen === item.id}
                      className={listen === item.id ? "is-on" : undefined}
                      disabled={!file}
                      onClick={() => {
                        setListen(item.id);
                        if (playing) {
                          void playSlot(file, item.id);
                        }
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <ListenTakesInfo takes={compareTakes} />
            </div>
            {compareHint ? <p className="quest-master-compare-hint">{compareHint}</p> : null}
          </div>
        </section>
        <section className="quest-master-action">
          <p className="quest-master-kicker">{actionKicker}</p>
          <div className="quest-master-spec" role="radiogroup" aria-label="Master for">
            {SPEC_PRESET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={preset === option.value}
                className={preset === option.value ? "is-on" : undefined}
                onClick={() => {
                  writeEnginePrefs({ spec_preset_id: option.value });
                  setPreset(option.value);
                }}
              >
                {option.value === "acx" ? "ACX" : "EBU"}
              </button>
            ))}
          </div>
          <p className="quest-master-spec-hint">
            {SPEC_PRESET_OPTIONS.find((option) => option.value === preset)?.hint}
          </p>
          <button
            type="button"
            className={`quest-master-orb${busy ? " is-busy" : ""}${casting ? " is-cast" : ""}`}
            onPointerDown={castMaster}
            onClick={() => void runMaster()}
            disabled={busy}
            aria-label={
              busy
                ? "Mastering"
                : chapter.mastered
                  ? `Master again for ${preset === "acx" ? "ACX" : "EBU"}`
                  : `Master this chapter for ${preset === "acx" ? "ACX" : "EBU"}`
            }
          >
            <span className="quest-master-orb-ring" aria-hidden="true" />
            <span className="quest-master-orb-ring is-late" aria-hidden="true" />
            <span className="quest-master-orb-face">{busy ? "…" : chapter.mastered ? "Again" : "Master"}</span>
          </button>
          <div className="quest-master-more">
            {leadAction}
            {onNextChapter ? (
              <button type="button" className="quest-act" onClick={onNextChapter}>
                Next
              </button>
            ) : null}
          </div>
        </section>
        {chapter.acxTrafficLight && !acxReport ? (
          <p className="quest-master-note">
            Last check:{" "}
            {chapter.acxTrafficLight === "green" ? "ready" : chapter.acxTrafficLight === "yellow" ? "close" : "needs a fix"}
            .
          </p>
        ) : null}
        {acxReport ? (
          <div className="quest-master-report">
            <ChapterMeter report={acxReport} masteringPlan={!chapter.mastered} onListenQuiet={() => void listenQuiet()} />
          </div>
        ) : null}
        {masterError ? <p className="ma-error">{masterError}</p> : null}
      </div>
    </div>
  );
}

function ListenTakesInfo({ takes }: { takes: MasteringTake[] }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const showWorking = takes.includes("working");

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`quest-listen-info-wrap${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="quest-listen-info"
        aria-expanded={open}
        aria-controls={popId}
        aria-label="What each take is"
        onClick={() => setOpen((value) => !value)}
      >
        <InfoGlyph />
      </button>
      {open ? (
        <>
          <button type="button" className="quest-listen-info-scrim" aria-label="Close take guide" onClick={() => setOpen(false)} />
          <div className="quest-listen-pop" id={popId} role="dialog" aria-label="Take types">
            <p className="quest-listen-pop-kicker">Takes</p>
            <ul>
              <li>
                <strong>Original</strong>
                {showWorking
                  ? "The booth recording or imported file, before any edits."
                  : "The uploaded file, before loudness polish."}
              </li>
              {showWorking ? (
                <li>
                  <strong>Unmastered</strong>
                  The working take after punches and proofing, before loudness polish.
                </li>
              ) : null}
              <li>
                <strong>Mastered</strong>
                The file after you tap Master, using the platform you picked.
              </li>
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v3.6M8 5.15h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PlayListenGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.4 12.4 8 5.2 12.6V3.4Z" fill="currentColor" />
    </svg>
  );
}

function PauseListenGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.4h2v9.2H5zM9 3.4h2v9.2H9z" fill="currentColor" />
    </svg>
  );
}
