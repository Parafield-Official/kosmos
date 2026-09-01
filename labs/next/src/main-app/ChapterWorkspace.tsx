import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AcxReport } from "../../../../src/core/acx/measure";
import { ChapterMeter, quietListenRange } from "./ChapterMeter";
import { importChapterOriginal, runChapterProof } from "./chapter-actions";
import { BoothSheet } from "./BoothSheet";
import { ConfirmAlert } from "./ConfirmAlert";
import { stepLocked, type ChapterStep } from "./chapter-flow";
import { readEnginePrefs } from "./engine-prefs";
import { resolvedInText } from "./glossary";
import { masterChapterWorking } from "./punch";
import { PronunciationCheatSheet } from "./PronunciationCheatSheet";
import { RecordScreen } from "./RecordScreen";
import { ReviewScreen } from "./ReviewScreen";
import { RoomCheck, roomChipLabel } from "./RoomCheck";
import { formatTapeTime } from "./TapePlayer";
import { paragraphsFromHtml } from "./booth";
import {
  clearOriginalTape,
  patchChapter,
  readChapterAudioUrl,
  readChapterContent,
  type BookProject,
} from "./store";

const STEPS: Array<{ id: ChapterStep; label: string; hint: string }> = [
  { id: "recording", label: "Record", hint: "Booth" },
  { id: "proofreading", label: "Proofread", hint: "Flags" },
  { id: "mastering", label: "Sound", hint: "Master" },
];

const SOUND_WAVE = [22, 22, 22, 24, 28, 36, 48, 64, 78, 92, 78, 64, 48, 36, 28, 24, 22, 22, 22];

export function ChapterWorkspace({
  project,
  chapterId,
  step,
  onStep,
  onBack,
  onChange,
  onNextChapter,
}: {
  project: BookProject;
  chapterId: string;
  step: ChapterStep;
  onStep: (step: ChapterStep) => void;
  onBack: () => void;
  onChange: (next: BookProject) => void;
  onNextChapter?: () => void;
}) {
  const chapter = useMemo(
    () => project.chapters.find((item) => item.id === chapterId) ?? null,
    [project, chapterId],
  );
  const [chapterText, setChapterText] = useState("");
  const [proofing, setProofing] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [startOverAsk, setStartOverAsk] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void readChapterContent(project, chapterId).then((html) => {
      if (alive) {
        setChapterText(paragraphsFromHtml(html).join("\n"));
      }
    });
    return () => {
      alive = false;
    };
  }, [project, chapterId]);

  if (!chapter) {
    return (
      <section className="ma-screen ma-chapter" aria-label="Chapter">
        <button type="button" className="ma-back" onClick={onBack}>
          <span>{project.title}</span>
        </button>
        <p className="ma-chapter-empty">This chapter no longer exists.</p>
      </section>
    );
  }

  const current = chapter;
  const guides = resolvedInText(project.glossary ?? [], chapterText);
  const complete = current.recordedPct >= 1 || (current.hasOriginalAudio && current.recordedPct >= 0.98);

  async function goProof() {
    setProofError(null);
    if (current.proofed && current.proofTimingEngine) {
      onStep("proofreading");
      return;
    }
    setProofing(true);
    try {
      const result = await runChapterProof(project, chapterId);
      onChange(result.project);
      onStep("proofreading");
    } catch (reason) {
      setProofError(reason instanceof Error ? reason.message : "Proofread failed.");
    } finally {
      setProofing(false);
    }
  }

  function confirmStartOver() {
    onChange(clearOriginalTape(project, chapterId));
    setStartOverAsk(false);
    onStep("recording");
  }

  return (
    <section className="quest-workspace is-booth" aria-label={chapter.title}>
      <header className="quest-work-head">
        <button type="button" className="vault-media-back" onClick={onBack} aria-label="Back to chapters">
          <ChevronLeft />
          <span>Back</span>
        </button>
        <div className="quest-work-title">
          <h1>{chapter.title}</h1>
        </div>
        <nav className="quest-steps" aria-label="Chapter steps">
          {STEPS.map((item) => {
            const locked = stepLocked(item.id, chapter);
            const done =
              item.id === "recording"
                ? chapter.recordedPct >= 1
                : item.id === "proofreading"
                  ? chapter.proofed
                  : chapter.mastered;
            return (
              <button
                key={item.id}
                type="button"
                className={`quest-step is-${item.id}${step === item.id ? " is-on" : ""}${done ? " is-done" : ""}`}
                disabled={locked}
                onClick={() => onStep(item.id)}
              >
                <span className="quest-step-icon" aria-hidden="true">
                  {item.id === "recording" ? <MicStepIcon /> : null}
                  {item.id === "proofreading" ? <ProofStepIcon /> : null}
                  {item.id === "mastering" ? <WaveStepIcon /> : null}
                </span>
                <span className="quest-step-copy">
                  <strong>{item.label}</strong>
                  <em>{done ? "Done" : locked ? "Locked" : item.hint}</em>
                </span>
              </button>
            );
          })}
        </nav>
      </header>

      {proofError ? <p className="ma-error ma-chapter-workspace-error">{proofError}</p> : null}

      <div className="quest-work-body">
        {step === "recording" ? (
          <RecordingStep
            project={project}
            chapterId={chapterId}
            complete={complete}
            proofing={proofing}
            guideCount={guides.length}
            roomStatus={project.roomCheck?.status}
            onOpenRoom={() => setRoomOpen(true)}
            onOpenGuide={guides.length > 0 ? () => setGuideOpen(true) : undefined}
            onChange={onChange}
            onProof={() => void goProof()}
          />
        ) : null}

        {step === "proofreading" ? (
          <ReviewScreen
            project={project}
            chapterId={chapterId}
            embedded
            onBack={onBack}
            onChange={onChange}
            onStartOver={() => setStartOverAsk(true)}
          />
        ) : null}

        {step === "mastering" ? (
          <MasteringStep
            project={project}
            chapterId={chapterId}
            onChange={onChange}
            onNextChapter={onNextChapter}
          />
        ) : null}
      </div>

      {step === "recording" && roomOpen ? (
        <BoothSheet title="Room check" onClose={() => setRoomOpen(false)}>
          <RoomCheck report={project.roomCheck} onReport={(roomCheck) => onChange({ ...project, roomCheck })} />
        </BoothSheet>
      ) : null}

      {step === "recording" && guideOpen ? (
        <BoothSheet title="Pronunciation guide" onClose={() => setGuideOpen(false)}>
          <PronunciationCheatSheet entries={guides} project={project} />
        </BoothSheet>
      ) : null}

      {startOverAsk ? (
        <ConfirmAlert
          title="Start over?"
          body={`“${chapter.title}” recordings will be permanently deleted. This can’t be undone.`}
          confirm="Start over"
          onConfirm={confirmStartOver}
          onCancel={() => setStartOverAsk(false)}
        />
      ) : null}
    </section>
  );
}

function RecordingStep({
  project,
  chapterId,
  complete,
  proofing,
  guideCount,
  roomStatus,
  onOpenRoom,
  onOpenGuide,
  onChange,
  onProof,
}: {
  project: BookProject;
  chapterId: string;
  complete: boolean;
  proofing: boolean;
  guideCount: number;
  roomStatus?: "pass" | "warn" | "fail";
  onOpenRoom: () => void;
  onOpenGuide?: () => void;
  onChange: (next: BookProject) => void;
  onProof: () => void;
}) {
  return (
    <RecordScreen
      project={project}
      chapterId={chapterId}
      embedded
      onBack={() => undefined}
      onChange={onChange}
      onContinueProof={complete ? onProof : undefined}
      importSlot={<ChapterAudioImport project={project} chapterId={chapterId} onChange={onChange} />}
      proofing={proofing}
      boothTools={
        <>
          <button
            type="button"
            className={`booth-tool${roomStatus ? ` is-${roomStatus}` : ""}`}
            onClick={onOpenRoom}
            title={roomChipLabel(project.roomCheck)}
          >
            <RoomGlyph />
            <span>{roomChipLabel(project.roomCheck)}</span>
          </button>
          {onOpenGuide ? (
            <button type="button" className="booth-tool" onClick={onOpenGuide} title="Pronunciation guide">
              <GuideGlyph />
              <span>Guide{guideCount > 1 ? ` ${guideCount}` : ""}</span>
            </button>
          ) : null}
        </>
      }
    />
  );
}

function ChapterAudioImport({
  project,
  chapterId,
  onChange,
}: {
  project: BookProject;
  chapterId: string;
  onChange: (next: BookProject) => void;
}): ReactNode {
  const importRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const chapter = project.chapters.find((item) => item.id === chapterId);

  async function applyImport(file: File) {
    setImportError(null);
    setImporting(true);
    try {
      onChange(await importChapterOriginal(project, chapterId, file));
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Could not import that audio file.");
    } finally {
      setImporting(false);
    }
  }

  async function importAudio(file: File) {
    if (chapter?.hasOriginalAudio) {
      setPendingImport(file);
      return;
    }
    await applyImport(file);
  }

  return (
    <>
      <button
        type="button"
        className="booth-tool"
        disabled={importing}
        title={chapter?.hasOriginalAudio ? "Replace original" : "Upload audio file"}
        onClick={() => importRef.current?.click()}
      >
        <UploadGlyph />
        <span>{importing ? "Importing…" : chapter?.hasOriginalAudio ? "Replace" : "Upload"}</span>
      </button>
      <input
        ref={importRef}
        className="ma-visually-hidden"
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.webm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void importAudio(file);
          }
        }}
      />
      {importError ? <p className="ma-error">{importError}</p> : null}
      {pendingImport ? (
        <ConfirmAlert
          title="Replace recording?"
          body="The original tape will be replaced with this file. This can’t be undone."
          confirm="Replace"
          onConfirm={() => {
            const file = pendingImport;
            setPendingImport(null);
            if (file) {
              void applyImport(file);
            }
          }}
          onCancel={() => setPendingImport(null)}
        />
      ) : null}
    </>
  );
}

function MasteringStep({
  project,
  chapterId,
  onChange,
  onNextChapter,
}: {
  project: BookProject;
  chapterId: string;
  onChange: (next: BookProject) => void;
  onNextChapter?: () => void;
}) {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  const [mastering, setMastering] = useState(false);
  const [casting, setCasting] = useState(false);
  const castTimer = useRef<number>(0);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [listen, setListen] = useState<"original" | "working" | "mastered">("original");
  const [clock, setClock] = useState({ current: 0, duration: 0 });
  const [measureNonce, setMeasureNonce] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);

  function releaseAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    loadedRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  useEffect(() => () => {
    releaseAudio();
    window.clearTimeout(castTimer.current);
  }, []);

  function castMaster() {
    if (mastering) {
      return;
    }
    window.clearTimeout(castTimer.current);
    setCasting(true);
    castTimer.current = window.setTimeout(() => setCasting(false), 720);
  }

  useEffect(() => {
    if (chapter?.masteredFile) {
      setListen("mastered");
    } else if (chapter?.workingFile) {
      setListen("working");
    } else {
      setListen("original");
    }
  }, [chapter?.masteredFile, chapter?.workingFile, chapter?.originalFile]);

  useEffect(() => {
    const file = chapter?.masteredFile;
    if (!file || !project.folder || !window.kosmosNext?.measureChapter) {
      return;
    }
    let cancelled = false;
    void window.kosmosNext.measureChapter({
      folder: project.folder,
      file,
      presetId: readEnginePrefs().spec_preset_id,
    }).then((result) => {
      if (cancelled || !result.ok || !result.report) {
        return;
      }
      setAcxReport(result.report);
    }).catch(() => undefined);
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

  async function checkFile(file?: string) {
    const target = file ?? current.masteredFile ?? current.workingFile ?? current.originalFile;
    if (!target || !project.folder || !window.kosmosNext?.measureChapter) {
      setCheckError("Check audio needs the desktop app and a take.");
      return;
    }
    setCheckError(null);
    setChecking(true);
    try {
      const result = await window.kosmosNext.measureChapter({
        folder: project.folder,
        file: target,
        presetId: readEnginePrefs().spec_preset_id,
      });
      if (!result.ok || !result.report) {
        throw new Error(result.reason || "Could not measure this chapter.");
      }
      setAcxReport(result.report);
      onChange(patchChapter(project, chapterId, { acxTrafficLight: result.report.traffic_light }));
    } catch (reason) {
      setCheckError(reason instanceof Error ? reason.message : "Could not measure this chapter.");
    } finally {
      setChecking(false);
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
      void audio.play().then(() => setPlaying(listen)).catch(() => setPlaying(null));
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
            <div className="quest-listen-sources" role="tablist" aria-label="Which take to hear">
              {(
                [
                  { id: "original" as const, label: "Original", file: chapter.originalFile },
                  { id: "working" as const, label: "Unmastered", file: chapter.workingFile },
                  { id: "mastered" as const, label: "Mastered", file: chapter.masteredFile },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={listen === item.id}
                  className={listen === item.id ? "is-on" : undefined}
                  disabled={!item.file}
                  onClick={() => {
                    setListen(item.id);
                    if (playing) {
                      void playSlot(item.file, item.id);
                    }
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="quest-master-action">
          <p className="quest-master-kicker">Master</p>
          <button
            type="button"
            className={`quest-master-orb${mastering ? " is-busy" : ""}${casting ? " is-cast" : ""}`}
            onPointerDown={castMaster}
            onClick={() => void runMaster()}
            disabled={mastering}
            aria-label={mastering ? "Mastering" : chapter.mastered ? "Master again" : "Master this chapter"}
          >
            <span className="quest-master-orb-ring" aria-hidden="true" />
            <span className="quest-master-orb-ring is-late" aria-hidden="true" />
            <span className="quest-master-orb-face">{mastering ? "…" : chapter.mastered ? "Again" : "Master"}</span>
          </button>
          <div className="quest-master-more">
            <button type="button" className="quest-act" onClick={() => void checkFile()} disabled={checking}>
              {checking ? "Measuring…" : "Check Audible"}
            </button>
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
            {chapter.acxTrafficLight === "green" ? "ready" : chapter.acxTrafficLight === "yellow" ? "close" : "needs a fix"}.
          </p>
        ) : null}
        {acxReport ? (
          <div className="quest-master-report">
            <ChapterMeter report={acxReport} masteringPlan={!chapter.mastered} onListenQuiet={() => void listenQuiet()} />
          </div>
        ) : null}
        {checkError ? <p className="ma-error">{checkError}</p> : null}
        {masterError ? <p className="ma-error">{masterError}</p> : null}
      </div>
    </div>
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

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicStepIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="7" y="3" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.8 10.2a5.2 5.2 0 0 0 10.4 0M10 15.4V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ProofStepIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 3.4h7.2L15.6 7v9.6H5V3.4Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <path d="M12.1 3.6V7h3.3M7.2 10.2h5.6M7.2 13h4.1" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
}

function WaveStepIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.2 10h1.4M6 6.4v7.2M8.8 4.6v10.8M11.6 7.2v5.6M14.4 5.4v9.2M17.2 9.2v1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RoomGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 12.4V6.8L8 3.4l4.8 3.4v5.6H3.2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M6.4 12.4v-3.2h3.2v3.2" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}

function GuideGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="3.2" width="7.2" height="9.6" rx="1.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M5.2 6.2h3.2M5.2 8.4h2.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M11.2 5.2h1.6a1.2 1.2 0 0 1 1.2 1.2v6.2H8.8" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 11.2V4.2M5.4 6.4 8 3.8l2.6 2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 11.4v1.2A1.2 1.2 0 0 0 4.4 13.8h7.2a1.2 1.2 0 0 0 1.2-1.2v-1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
