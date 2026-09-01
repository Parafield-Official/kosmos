import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AcxReport } from "../../../../src/core/acx/measure";
import { alignTranscript, preservePickupWorkflow } from "../../../../src/core/proof/align";
import { paragraphsFromHtml } from "./booth";
import { ChapterMeter, quietListenRange } from "./ChapterMeter";
import { ConfirmAlert } from "./ConfirmAlert";
import { proofAlignOptions } from "./engine-prefs";
import {
  addGlossaryWord,
  dismissGlossaryWord,
  setGlossaryRespell,
  unresolvedInText,
  entriesInText,
} from "./glossary";
import { GlossaryPanel } from "./GlossaryPanel";
import { RoomCheck } from "./RoomCheck";
import { masterChapterWorking, undoLatestChapterPunch } from "./punch";
import { dropSuppressedPickups } from "./suppress";
import { DebugFinishTakeButton } from "./DebugFinishTakeButton";
import {
  applyChapterPickups,
  applyOriginalTape,
  applyWorkingTape,
  chapterStage,
  copyOriginalToWorking,
  patchChapter,
  readChapterAudioUrl,
  readChapterContent,
  writeChapterAudio,
  type BookProject,
} from "./store";

/**
 * Per-chapter workflow. Record opens the teleprompter booth; import counts as
 * a finished take. Proof compares the original tape to the manuscript and
 * copies it into the working slot.
 */
export function ChapterScreen({
  project,
  chapterId,
  onBack,
  onEdit,
  onRead,
  onRecord,
  onReview,
  onChange,
}: {
  project: BookProject;
  chapterId: string;
  onBack: () => void;
  onEdit: () => void;
  onRead: () => void;
  onRecord: () => void;
  onReview: () => void;
  onChange: (next: BookProject) => void;
}) {
  const chapter = useMemo(
    () => project.chapters.find((item) => item.id === chapterId) ?? null,
    [project, chapterId],
  );
  const importRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofing, setProofing] = useState(false);
  const [proofNote, setProofNote] = useState<string | null>(null);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [mastering, setMastering] = useState(false);
  const [chapterText, setChapterText] = useState("");
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkAudioRef = useRef<HTMLAudioElement | null>(null);

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
          <ChevronLeft />
          <span>{project.title}</span>
        </button>
        <p className="ma-chapter-empty">This chapter no longer exists.</p>
      </section>
    );
  }

  const current = chapter;

  const stage = chapterStage(chapter);
  const recordedPct = Math.round(Math.min(1, Math.max(0, chapter.recordedPct)) * 100);
  const complete = chapter.recordedPct >= 1;

  async function applyImport(file: File) {
    setImportError(null);
    setImporting(true);
    try {
      const saved = await writeChapterAudio(project, chapterId, file, { slot: "original", name: file.name });
      if (!saved) {
        setImportError("Could not save that audio file.");
        return;
      }
      onChange(
        applyOriginalTape(project, chapterId, {
          file: saved,
          recordedPct: 1,
          resumeWordIndex: current.wordCount,
          freshTape: true,
        }),
      );
    } catch {
      setImportError("Could not import that audio file.");
    } finally {
      setImporting(false);
    }
  }

  async function importAudio(file: File) {
    if (current.hasOriginalAudio) {
      setPendingImport(file);
      return;
    }
    await applyImport(file);
  }

  async function runProof() {
    if (!current.originalFile) {
      return;
    }
    setProofError(null);
    setProofNote(null);
    setProofing(true);
    try {
      const html = await readChapterContent(project, chapterId);
      const manuscript = paragraphsFromHtml(html).join("\n");
      if (!window.kosmosNext?.transcribeChapter || !project.folder) {
        throw new Error("Proofreading needs the desktop app.");
      }
      const result = await window.kosmosNext.transcribeChapter({
        folder: project.folder,
        file: current.originalFile,
      });
      if (!result.ok) {
        throw new Error(result.reason || "Could not transcribe the original tape.");
      }
      const proofTranscript = (result.words ?? []).map((word) => ({
        text: word.text,
        start: word.start,
        end: word.end,
        ...(Number.isFinite(word.confidence) ? { confidence: word.confidence } : {}),
      }));
      const aligned = alignTranscript({
        chapterId,
        manuscript,
        transcript: proofTranscript,
        durationSeconds: Math.max(
          1,
          proofTranscript.reduce((max, word) => Math.max(max, word.end), 0),
          (result.silences ?? []).reduce((max, silence) => Math.max(max, silence.end), 0),
        ),
        ...proofAlignOptions(),
        suppressedWords: project.suppressedWords,
        silences: result.silences ?? [],
      });
      const pickups = dropSuppressedPickups(
        preservePickupWorkflow(current.pickups ?? [], aligned.pickups),
        project.suppressedWords,
      ) ?? [];
      const mismatches = pickups.filter((pickup) => pickup.kind !== "pause" && pickup.status === "open").length;
      const pauses = pickups.filter((pickup) => pickup.kind === "pause" && pickup.status === "open").length;
      setProofNote(
        mismatches === 0 && pauses === 0
          ? "No word changes or long pauses found. Listen once for delivery."
          : `${mismatches} word ${mismatches === 1 ? "mismatch" : "mismatches"} and ${pauses} long ${pauses === 1 ? "pause" : "pauses"} filed.`,
      );
      const working = await copyOriginalToWorking(project, chapterId);
      if (!working) {
        throw new Error("Could not create the working file from original.");
      }
      onChange(
        applyWorkingTape(
          applyChapterPickups(
            patchChapter(project, chapterId, {
              proofed: true,
              proofTranscript,
              proofTimingEngine: result.timingEngine === "whisperx" ? "whisperx" : "whisper.cpp",
            }),
            chapterId,
            pickups,
          ),
          chapterId,
          working,
        ),
      );
    } catch (reason) {
      setProofError(reason instanceof Error ? reason.message : "Proofread failed.");
    } finally {
      setProofing(false);
    }
  }

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

  async function undoPunch() {
    setMasterError(null);
    try {
      onChange(await undoLatestChapterPunch(project, chapterId));
      setAcxReport(null);
    } catch (reason) {
      setMasterError(reason instanceof Error ? reason.message : "Could not undo that punch.");
    }
  }

  async function checkAudio() {
    const file = current.workingFile ?? current.originalFile;
    if (!file || !project.folder || !window.kosmosNext?.measureChapter) {
      setCheckError("Check audio needs the desktop app and a take.");
      return;
    }
    setCheckError(null);
    setChecking(true);
    try {
      const result = await window.kosmosNext.measureChapter({ folder: project.folder, file });
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

  async function listenQuiet() {
    if (!acxReport) {
      return;
    }
    const file = current.workingFile ?? current.originalFile;
    if (!file) {
      return;
    }
    checkAudioRef.current?.pause();
    const url = await readChapterAudioUrl(project, file);
    if (!url) {
      return;
    }
    const range = quietListenRange(acxReport);
    const audio = new Audio(url);
    checkAudioRef.current = audio;
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

  const openFlags = (current.pickups ?? []).filter((pickup) => pickup.status === "open").length;
  const canUndoPunch = (current.punches ?? []).some((punch) => punch.edit_status !== "reverted");
  const glossary = project.glossary ?? [];
  const chapterEntries = entriesInText(glossary, chapterText);
  const chapterUnresolved = unresolvedInText(glossary, chapterText);

  return (
    <section className="ma-screen ma-chapter" aria-label={chapter.title}>
      <header className="ma-overview-head">
        <button type="button" className="ma-back" onClick={onBack} aria-label="Back to overview">
          <ChevronLeft />
          <span>{project.title}</span>
        </button>
        <div className="ma-chapter-head-actions">
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            Edit content
          </button>
          <button type="button" className="btn btn-sm" onClick={onRead}>
            Read
          </button>
          <DebugFinishTakeButton project={project} chapterId={chapterId} onChange={onChange} />
          <span className={`ma-stage-chip ma-stage-${stage}`}>{chapter.title}</span>
        </div>
      </header>

      <RoomCheck
        report={project.roomCheck}
        onReport={(roomCheck) => onChange({ ...project, roomCheck })}
      />

      <GlossaryPanel
        title="Pronunciations"
        summary={
          chapterEntries.length === 0
            ? "No flagged names in this chapter."
            : chapterUnresolved.length === 0
              ? `All ${chapterEntries.length} ${chapterEntries.length === 1 ? "name" : "names"} in this chapter have a pronunciation.`
              : `${chapterUnresolved.length} of ${chapterEntries.length} in this chapter still need a pronunciation.`
        }
        entries={chapterUnresolved}
        bookTotal={glossary.length}
        allowAdd
        emptyCopy="Nothing left to set here. Proofreading never waits on this list."
        onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
        onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
        onAdd={(spelling, respell) => onChange(addGlossaryWord(project, spelling, respell))}
      />

      <ol className="ma-steps">
        <Step
          n={1}
          title="Record or import"
          active={!complete}
          done={complete}
          desc={
            complete
              ? "Original tape is saved. Continue or re-record from a word in the booth. Proofreading builds the working file on top of it."
              : "Record in the teleprompter until coverage hits 100%, or import a finished original."
          }
        >
          <div className="ma-step-actions">
            <button type="button" className="btn" onClick={onRecord}>
              {complete
                ? "Open booth"
                : chapter.hasOriginalAudio
                  ? `Continue recording (${recordedPct}%)`
                  : "Start recording"}
            </button>
            <button
              type="button"
              className="btn btn-clear"
              disabled={importing}
              onClick={() => importRef.current?.click()}
            >
              {importing ? "Importing…" : chapter.hasOriginalAudio ? "Replace original" : "Import audio"}
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
          </div>
          {complete ? <p className="ma-step-note">Original take saved.</p> : null}
          {importError ? <p className="ma-error">{importError}</p> : null}
        </Step>

        <Step
          n={2}
          title="Proofread"
          active={complete && !chapter.proofed}
          done={chapter.proofed}
          locked={!complete}
          desc="Kosmos checks the read against the manuscript. Re-record flagged lines or any line you highlight; each redo saves to the working version."
        >
          {complete ? (
            <div className="ma-step-actions">
              <button
                type="button"
                className="btn btn-clear"
                onClick={() => void runProof()}
                disabled={chapter.proofed || proofing}
              >
                {chapter.proofed ? "Proof complete" : proofing ? "Proofing…" : "Run proofread"}
              </button>
              {chapter.hasWorkingAudio ? (
                <span className="ma-compare-note">Original + working version available to compare.</span>
              ) : null}
            </div>
          ) : (
            <p className="ma-step-note">Record or import a take first.</p>
          )}
          {proofNote ? <p className="ma-step-note">{proofNote}</p> : null}
          {proofError ? <p className="ma-error">{proofError}</p> : null}
          {complete ? (
            <div className="ma-step-actions">
              <button type="button" className="btn btn-clear" onClick={onReview}>
                {openFlags > 0 ? `Review flags (${openFlags})` : "Review original vs working"}
              </button>
              {canUndoPunch ? (
                <button type="button" className="btn btn-clear" onClick={() => void undoPunch()}>
                  Undo latest punch
                </button>
              ) : null}
            </div>
          ) : null}
        </Step>

        <Step
          n={3}
          title="Master"
          active={chapter.proofed && !chapter.mastered}
          done={chapter.mastered}
          locked={!chapter.proofed}
          desc="Level and clean the chapter to spec. Check this file for a pass/fail before you export the whole book."
        >
          {chapter.proofed ? (
            <>
              <div className="ma-step-actions">
                <button
                  type="button"
                  className="btn btn-clear"
                  onClick={() => void runMaster()}
                  disabled={chapter.mastered || mastering}
                >
                  {chapter.mastered ? "Mastered" : mastering ? "Mastering…" : "Master chapter"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void checkAudio()}
                  disabled={checking}
                >
                  {checking ? "Measuring…" : "Check this audio"}
                </button>
              </div>
              {chapter.acxTrafficLight && !acxReport ? (
                <p className="ma-step-note">
                  Last check: {chapter.acxTrafficLight === "green" ? "ready" : chapter.acxTrafficLight === "yellow" ? "close" : "needs a fix"}. Run it again after you master or punch.
                </p>
              ) : null}
              {acxReport ? (
                <ChapterMeter
                  report={acxReport}
                  masteringPlan={!chapter.mastered}
                  onListenQuiet={() => void listenQuiet()}
                />
              ) : null}
            </>
          ) : (
            <p className="ma-step-note">Finish proofreading first.</p>
          )}
          {checkError ? <p className="ma-error">{checkError}</p> : null}
          {masterError ? <p className="ma-error">{masterError}</p> : null}
        </Step>
      </ol>
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
    </section>
  );
}

function Step({
  n,
  title,
  desc,
  active,
  done,
  locked,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  active?: boolean;
  done?: boolean;
  locked?: boolean;
  children?: ReactNode;
}) {
  const state = done ? "done" : locked ? "locked" : active ? "active" : "idle";
  return (
    <li className={`ma-step neu-card ma-step-${state}`}>
      <span className="ma-step-num neu-inset" aria-hidden="true">
        {done ? <CheckIcon /> : n}
      </span>
      <div className="ma-step-body">
        <h3 className="ma-step-title">{title}</h3>
        <p className="ma-step-desc">{desc}</p>
        {children}
      </div>
    </li>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
