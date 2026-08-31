import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AcxReport } from "../../../../src/core/acx/measure";
import { ChapterMeter, quietListenRange } from "./ChapterMeter";
import { importChapterOriginal, runChapterProof } from "./chapter-actions";
import { recordingGate, stepLocked, type ChapterStep } from "./chapter-flow";
import { readEnginePrefs } from "./engine-prefs";
import {
  addGlossaryWord,
  dismissGlossaryWord,
  setGlossaryRespell,
  unresolvedInText,
  entriesInText,
} from "./glossary";
import { GlossaryPanel } from "./GlossaryPanel";
import { masterChapterWorking } from "./punch";
import { RecordScreen } from "./RecordScreen";
import { ReviewScreen } from "./ReviewScreen";
import { RoomCheck } from "./RoomCheck";
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
  const [masteringOut, setMasteringOut] = useState(false);
  const [startOverAsk, setStartOverAsk] = useState(false);

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
  const glossary = project.glossary ?? [];
  const chapterUnresolved = unresolvedInText(glossary, chapterText);
  const chapterEntries = entriesInText(glossary, chapterText);
  const gate = recordingGate({
    unresolvedPronunciations: chapterUnresolved.length,
    roomCheck: project.roomCheck,
  });
  const complete = current.recordedPct >= 1 || (current.hasOriginalAudio && current.recordedPct >= 0.98);

  async function goProof() {
    setProofError(null);
    if (current.proofed) {
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

  async function goMaster() {
    setProofError(null);
    setMasteringOut(true);
    try {
      onChange(await masterChapterWorking(project, chapterId));
      onStep("mastering");
    } catch (reason) {
      setProofError(reason instanceof Error ? reason.message : "Mastering failed.");
    } finally {
      setMasteringOut(false);
    }
  }

  function confirmStartOver() {
    onChange(clearOriginalTape(project, chapterId));
    setStartOverAsk(false);
    onStep("recording");
  }

  const booth = (step === "recording" && gate.ok) || step === "proofreading";
  const chapterIndex = project.chapters.findIndex((item) => item.id === chapterId) + 1;

  return (
    <section className={booth ? "quest-workspace is-booth" : "quest-workspace"} aria-label={chapter.title}>
      <header className="quest-work-head">
        <button type="button" className="vault-media-back" onClick={onBack} aria-label="Back to chapters">
          <ChevronLeft />
          <span>Back</span>
        </button>
        <div className="quest-work-title">
          <p className="quest-work-kicker">Chapter {String(Math.max(1, chapterIndex)).padStart(2, "0")}</p>
          <h1>{chapter.title}</h1>
        </div>
        <span className="quest-work-spacer" aria-hidden="true" />
      </header>

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

      {proofError ? <p className="ma-error ma-chapter-workspace-error">{proofError}</p> : null}

      <div className="quest-work-body">
        {step === "recording" ? (
          <RecordingStep
            project={project}
            chapterId={chapterId}
            gateOk={gate.ok}
            gateReason={gate.reason}
            unresolved={chapterUnresolved}
            entriesCount={chapterEntries.length}
            glossaryTotal={glossary.length}
            complete={complete}
            proofing={proofing}
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
            onContinueMaster={() => void goMaster()}
            mastering={masteringOut}
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

      {startOverAsk ? (
        <div className="ma-scrim" role="presentation" onClick={() => setStartOverAsk(false)}>
          <div className="ma-alert neu-panel" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="ma-alert-copy">
              <h2 className="ma-alert-title">Start this chapter over?</h2>
              <p className="ma-alert-sub">
                This throws away the original recording, the working copy, and any punch-ins. You will record again from
                the first word.
              </p>
            </div>
            <div className="ma-alert-actions">
              <button type="button" className="ma-alert-btn" onClick={() => setStartOverAsk(false)}>
                Cancel
              </button>
              <button type="button" className="ma-alert-btn ma-alert-btn-danger" onClick={confirmStartOver}>
                Throw away the take
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RecordingStep({
  project,
  chapterId,
  gateOk,
  gateReason,
  unresolved,
  entriesCount,
  glossaryTotal,
  complete,
  proofing,
  onChange,
  onProof,
}: {
  project: BookProject;
  chapterId: string;
  gateOk: boolean;
  gateReason: string | null;
  unresolved: ReturnType<typeof unresolvedInText>;
  entriesCount: number;
  glossaryTotal: number;
  complete: boolean;
  proofing: boolean;
  onChange: (next: BookProject) => void;
  onProof: () => void;
}) {
  if (!gateOk) {
    return (
      <div className="quest-gate">
        <RoomCheck report={project.roomCheck} onReport={(roomCheck) => onChange({ ...project, roomCheck })} />
        <GlossaryPanel
          title="Pronunciations in this chapter"
          summary={
            entriesCount === 0
              ? "No flagged names in this chapter."
              : unresolved.length === 0
                ? entriesCount === 1
                  ? "This name has a pronunciation."
                  : `All ${entriesCount} names in this chapter have a pronunciation.`
                : unresolved.length === 1
                  ? "1 name in this chapter still needs a pronunciation."
                  : `${unresolved.length} of ${entriesCount} in this chapter still need a pronunciation.`
          }
          entries={unresolved}
          bookTotal={glossaryTotal}
          allowAdd
          emptyCopy="Nothing left to set here. Finish the room check, then you can record."
          onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
          onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
          onAdd={(spelling, respell) => onChange(addGlossaryWord(project, spelling, respell))}
        />
        <div className="ma-record-entry">
          <ChapterAudioImport project={project} chapterId={chapterId} onChange={onChange} />
          {gateReason ? <p className="ma-note">{gateReason}</p> : null}
        </div>
      </div>
    );
  }

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
  const chapter = project.chapters.find((item) => item.id === chapterId);

  async function importAudio(file: File) {
    if (chapter?.hasOriginalAudio && !window.confirm("Replace the original tape with this file?")) {
      return;
    }
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

  return (
    <>
      <button
        type="button"
        className="btn btn-clear"
        disabled={importing}
        onClick={() => importRef.current?.click()}
      >
        {importing ? "Importing…" : chapter?.hasOriginalAudio ? "Replace original" : "Upload audio file"}
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
  const [masterError, setMasterError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [measureNonce, setMeasureNonce] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

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

  async function playSlot(file: string | undefined, id: string) {
    if (!file) {
      return;
    }
    audioRef.current?.pause();
    const url = await readChapterAudioUrl(project, file);
    if (!url) {
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(id);
    audio.addEventListener("ended", () => {
      setPlaying(null);
      URL.revokeObjectURL(url);
    });
    void audio.play().catch(() => {
      setPlaying(null);
      URL.revokeObjectURL(url);
    });
  }

  async function listenQuiet() {
    if (!acxReport) {
      return;
    }
    const file = current.masteredFile ?? current.workingFile ?? current.originalFile;
    if (!file) {
      return;
    }
    audioRef.current?.pause();
    const url = await readChapterAudioUrl(project, file);
    if (!url) {
      return;
    }
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

  return (
    <div className="quest-master">
      <div className={`quest-waves${playing ? " is-live" : ""}`} aria-hidden="true">
        {Array.from({ length: 28 }, (_, index) => (
          <i key={index} style={{ animationDelay: `${index * 42}ms`, animationDuration: `${0.7 + (index % 5) * 0.18}s` }} />
        ))}
      </div>
      <p className="quest-master-lead">
        Original is the booth tape. Without mastering is the punch copy. With mastering is the latest pipeline output.
      </p>
      <div className="quest-master-slots">
        <button
          type="button"
          className={`quest-slot${playing === "original" ? " is-on" : ""}`}
          disabled={!chapter.originalFile}
          onClick={() => void playSlot(chapter.originalFile, "original")}
        >
          <strong>Original</strong>
          <span>{playing === "original" ? "Playing" : "Booth tape"}</span>
        </button>
        <button
          type="button"
          className={`quest-slot${playing === "working" ? " is-on" : ""}`}
          disabled={!chapter.workingFile}
          onClick={() => void playSlot(chapter.workingFile, "working")}
        >
          <strong>Unmastered</strong>
          <span>{playing === "working" ? "Playing" : "Punch copy"}</span>
        </button>
        <button
          type="button"
          className={`quest-slot${playing === "mastered" ? " is-on" : ""}`}
          disabled={!chapter.masteredFile}
          onClick={() => void playSlot(chapter.masteredFile, "mastered")}
        >
          <strong>Mastered</strong>
          <span>{playing === "mastered" ? "Playing" : "Pipeline"}</span>
        </button>
      </div>
      <div className="quest-master-acts">
        <button type="button" className="quest-act is-primary" onClick={() => void runMaster()} disabled={mastering}>
          {mastering ? "Mastering…" : chapter.mastered ? "Master again" : "Master chapter"}
        </button>
        <button type="button" className="quest-act" onClick={() => void checkFile()} disabled={checking}>
          {checking ? "Measuring…" : "Check this audio"}
        </button>
        {onNextChapter ? (
          <button type="button" className="quest-act" onClick={onNextChapter}>
            Next chapter
          </button>
        ) : null}
      </div>
      {chapter.acxTrafficLight && !acxReport ? (
        <p className="quest-master-note">
          Last check:{" "}
          {chapter.acxTrafficLight === "green" ? "ready" : chapter.acxTrafficLight === "yellow" ? "close" : "needs a fix"}.
        </p>
      ) : null}
      {acxReport ? (
        <ChapterMeter report={acxReport} masteringPlan={!chapter.mastered} onListenQuiet={() => void listenQuiet()} />
      ) : null}
      {checkError ? <p className="ma-error">{checkError}</p> : null}
      {masterError ? <p className="ma-error">{masterError}</p> : null}
    </div>
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
