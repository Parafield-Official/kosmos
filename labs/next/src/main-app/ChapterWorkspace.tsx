import { useEffect, useMemo, useRef, useState } from "react";
import type { AcxReport } from "../../../../src/core/acx/measure";
import { ChapterMeter, quietListenRange } from "./ChapterMeter";
import { importChapterOriginal, runChapterProof } from "./chapter-actions";
import { recordingGate, stepLocked, type ChapterStep } from "./chapter-flow";
import { DebugFinishTakeButton } from "./DebugFinishTakeButton";
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

const STEPS: Array<{ id: ChapterStep; label: string }> = [
  { id: "recording", label: "Recording" },
  { id: "proofreading", label: "Proofreading" },
  { id: "mastering", label: "Sound mastering" },
];

export function ChapterWorkspace({
  project,
  chapterId,
  step,
  onStep,
  onBack,
  onEdit,
  onRead,
  onChange,
  onNextChapter,
}: {
  project: BookProject;
  chapterId: string;
  step: ChapterStep;
  onStep: (step: ChapterStep) => void;
  onBack: () => void;
  onEdit: () => void;
  onRead: () => void;
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

  function confirmStartOver() {
    onChange(clearOriginalTape(project, chapterId));
    setStartOverAsk(false);
    onStep("recording");
  }

  return (
    <section className={`ma-chapter-workspace${step === "recording" && gate.ok ? " is-booth" : ""}`} aria-label={chapter.title}>
      <header className="ma-chapter-workspace-head">
        <button type="button" className="ma-back" onClick={onBack} aria-label="Back to chapters">
          <ChevronLeft />
          <span>Chapters</span>
        </button>
        <nav className="ma-step-nav" aria-label="Chapter steps">
          {STEPS.map((item) => {
            const locked = stepLocked(item.id, chapter);
            return (
              <button
                key={item.id}
                type="button"
                className={step === item.id ? "ma-step-nav-item is-on" : "ma-step-nav-item"}
                disabled={locked}
                onClick={() => onStep(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="ma-chapter-head-actions">
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn-sm" onClick={onRead}>
            Read
          </button>
          <DebugFinishTakeButton project={project} chapterId={chapterId} onChange={onChange} />
        </div>
      </header>

      {proofError ? <p className="ma-error ma-chapter-workspace-error">{proofError}</p> : null}

      <div className="ma-chapter-workspace-body">
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
            onContinueMaster={() => onStep("mastering")}
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
      <RoomCheck report={project.roomCheck} onReport={(roomCheck) => onChange({ ...project, roomCheck })} />
      <GlossaryPanel
        title="Pronunciations in this chapter"
        summary={
          entriesCount === 0
            ? "No flagged names in this chapter."
            : unresolved.length === 0
              ? `All ${entriesCount} ${entriesCount === 1 ? "name" : "names"} in this chapter have a pronunciation.`
              : `${unresolved.length} of ${entriesCount} in this chapter still need a pronunciation.`
        }
        entries={unresolved}
        bookTotal={glossaryTotal}
        allowAdd
        emptyCopy="Nothing left to set here. You can record once the room check also passes."
        onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
        onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
        onAdd={(spelling, respell) => onChange(addGlossaryWord(project, spelling, respell))}
      />

      <div className="ma-record-entry">
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
        {complete ? (
          <button type="button" className="btn btn-clear" onClick={onProof} disabled={proofing}>
            {proofing ? "Proofing…" : "Continue to proofreading"}
          </button>
        ) : null}
        {importError ? <p className="ma-error">{importError}</p> : null}
      </div>

      {!gateOk ? <p className="ma-note">{gateReason}</p> : null}

      {gateOk ? (
        <RecordScreen
          project={project}
          chapterId={chapterId}
          embedded
          onBack={() => undefined}
          onChange={onChange}
          onContinueProof={complete ? onProof : undefined}
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
  const [masterError, setMasterError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

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
      const result = await window.kosmosNext.measureChapter({ folder: project.folder, file: target });
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
    <div className="ma-master-pane">
      <p className="ma-set-sub">
        Original is the booth tape. Without mastering is the punch copy. With mastering is the latest pipeline output.
      </p>
      <div className="ma-step-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!chapter.originalFile}
          onClick={() => void playSlot(chapter.originalFile, "original")}
        >
          {playing === "original" ? "Playing original" : "Original"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!chapter.workingFile}
          onClick={() => void playSlot(chapter.workingFile, "working")}
        >
          {playing === "working" ? "Playing unmastered" : "Without mastering"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!chapter.masteredFile}
          onClick={() => void playSlot(chapter.masteredFile, "mastered")}
        >
          {playing === "mastered" ? "Playing mastered" : "With mastering"}
        </button>
      </div>
      <div className="ma-step-actions">
        <button type="button" className="btn btn-clear" onClick={() => void runMaster()} disabled={mastering}>
          {mastering ? "Mastering…" : chapter.mastered ? "Master again" : "Master chapter"}
        </button>
        <button type="button" className="btn" onClick={() => void checkFile()} disabled={checking}>
          {checking ? "Measuring…" : "Check this audio"}
        </button>
        {onNextChapter ? (
          <button type="button" className="btn" onClick={onNextChapter}>
            Next chapter
          </button>
        ) : null}
      </div>
      {chapter.acxTrafficLight && !acxReport ? (
        <p className="ma-step-note">
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
