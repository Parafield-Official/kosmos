import { useEffect, useRef, useState } from "react";
import type { GlossaryEntry } from "../../../../src/core/project/types";
import {
  addGlossaryWord,
  dismissGlossaryWord,
  ensureBookGlossary,
  isResolved,
  setGlossaryClip,
  setGlossaryRespell,
  spellingKey,
} from "./glossary";
import { GlossaryPanel } from "./GlossaryPanel";
import { removeSuppressedWord } from "./suppress";
import { writeGlossaryClip, type BookProject } from "./store";

function fieldChars(value: string, min: number, max = 56): number {
  return Math.min(max, Math.max(min, [...value].length + 3));
}

function pronunciationSummary(entries: GlossaryEntry[]): string {
  const unresolved = entries.filter((entry) => !isResolved(entry)).length;
  const total = entries.length;
  if (total === 0) {
    return "Nothing flagged yet.";
  }
  if (unresolved === 0) {
    return total === 1 ? "This name has a guide." : `All ${total} names have a guide.`;
  }
  if (unresolved === 1) {
    return total === 1 ? "This name still needs a guide." : `1 of ${total} names still needs a guide.`;
  }
  return `${unresolved} of ${total} names still need a guide.`;
}

export function PronunciationScreen({
  project,
  onChange,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
}) {
  const glossary = project.glossary ?? [];
  const flagged = [...glossary].sort((left, right) => Number(isResolved(left)) - Number(isResolved(right)));
  const skipped = project.suppressedWords ?? [];
  const [draftSpelling, setDraftSpelling] = useState("");
  const [draftGuide, setDraftGuide] = useState("");
  const [draftClip, setDraftClip] = useState<Blob | null>(null);
  const [draftClipUrl, setDraftClipUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    if (project.glossary !== undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      void ensureBookGlossary(project).then((next) => {
        if (alive && next) {
          onChange(next);
        }
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [project.id]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      if (draftClipUrl) {
        URL.revokeObjectURL(draftClipUrl);
      }
    };
  }, []);

  function clearDraftClip() {
    audioRef.current?.pause();
    setPlaying(false);
    if (draftClipUrl) {
      URL.revokeObjectURL(draftClipUrl);
    }
    setDraftClip(null);
    setDraftClipUrl(null);
  }

  async function toggleDraftRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
      );
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (chunks.length === 0) {
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        const url = URL.createObjectURL(blob);
        if (draftClipUrl) {
          URL.revokeObjectURL(draftClipUrl);
        }
        setDraftClip(blob);
        setDraftClipUrl(url);
      };
      recorderRef.current = recorder;
      recorder.start(80);
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }

  async function toggleDraftPlay() {
    if (!draftClipUrl) {
      return;
    }
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(draftClipUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    await audio.play();
    setPlaying(true);
  }

  function submitAdd() {
    const spelling = draftSpelling.trim();
    if (!spelling) {
      return;
    }
    const next = addGlossaryWord(project, spelling, draftGuide.trim());
    const added = (next.glossary ?? []).find((entry) => spellingKey(entry.spelling) === spellingKey(spelling));
    const clip = draftClip;
    setDraftSpelling("");
    setDraftGuide("");
    clearDraftClip();
    if (clip && added) {
      void writeGlossaryClip(next, added.id, clip).then((file) => {
        onChange(file ? setGlossaryClip(next, added.id, file) : next);
      });
      return;
    }
    onChange(next);
  }

  return (
    <section className="ma-screen ma-pronounce" aria-label="Pronunciation">
      <header className="ma-pronounce-head">
        <h1 className="ma-title">Pronunciation</h1>
        <p className="ma-set-sub">Set a guide, or add a word and record it.</p>
      </header>

      <form
        className="ma-pronounce-add"
        onSubmit={(event) => {
          event.preventDefault();
          submitAdd();
        }}
      >
        <span className="ma-pronounce-add-icon" aria-hidden="true">
          <PlusGlyph />
        </span>
        <input
          className="neu-input ma-word-input"
          value={draftSpelling}
          size={fieldChars(draftSpelling, 14, 40)}
          placeholder="Word or phrase"
          aria-label="Word or phrase to pronounce"
          onChange={(event) => setDraftSpelling(event.target.value)}
        />
        <input
          className="neu-input ma-guide-input"
          value={draftGuide}
          size={fieldChars(draftGuide || draftSpelling, 18, 48)}
          placeholder="Guide"
          aria-label="Pronunciation guide"
          onChange={(event) => setDraftGuide(event.target.value)}
        />
        <div className="ma-pronounce-add-tools">
          <button
            type="button"
            className={`ma-record-btn${recording ? " is-live" : ""}`}
            aria-pressed={recording}
            aria-label={recording ? "Stop recording" : "Record pronunciation"}
            onClick={() => void toggleDraftRecord()}
          >
            {recording ? <WaveGlyph /> : <MicGlyph />}
            <span>{recording ? "Stop" : "Record"}</span>
          </button>
          {draftClipUrl ? (
            <button
              type="button"
              className={`ma-clip-file${playing ? " is-live" : ""}`}
              aria-label={playing ? "Pause recording" : "Play recording"}
              onClick={() => void toggleDraftPlay()}
            >
              {playing ? <PauseGlyph /> : <PlayGlyph />}
              <span>Clip</span>
            </button>
          ) : null}
          <button type="submit" className="btn btn-clear" disabled={!draftSpelling.trim()}>
            Add
          </button>
        </div>
      </form>

      <div className="ma-pronounce-board">
        <GlossaryPanel
          title="Flagged"
          summary={pronunciationSummary(flagged)}
          entries={flagged}
          bookTotal={0}
          emptyCopy="Nothing flagged yet."
          project={project}
          onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
          onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
          onClip={(id, blob) => {
            void writeGlossaryClip(project, id, blob).then((file) => {
              if (file) {
                onChange(setGlossaryClip(project, id, file));
              }
            });
          }}
        />

        <section
          className={`ma-glossary ma-suppress${skipped.length === 0 ? " is-empty" : ""}`}
          aria-label="Words this book never flags"
        >
          <header className="ma-glossary-head">
            <h2>Never flag</h2>
            <p>
              {skipped.length === 0
                ? "No words skipped yet. On a proof flag, tap Never flag this word."
                : "Skipped on proof and while recording. Remove one to flag it again after the next proof."}
            </p>
          </header>
          <div className="ma-glossary-pane">
            {skipped.length > 0 ? (
              <ul className="ma-suppress-list">
                {skipped.map((word) => (
                  <li key={word}>
                    <span>{word}</span>
                    <button
                      type="button"
                      className="ma-word-act is-danger"
                      aria-label={`Flag ${word} again`}
                      onClick={() => onChange(removeSuppressedWord(project, word))}
                    >
                      <UndoGlyph />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ma-glossary-empty">Nothing skipped.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
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

function UndoGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 7.2H12a3 3 0 0 1 0 6H9.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6.4 4.8 4 7.2l2.4 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
