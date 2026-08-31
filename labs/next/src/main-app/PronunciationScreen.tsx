import { useEffect, useRef, useState } from "react";
import { ReplaceClipAsk, useClipRecorder } from "./clip-record";
import {
  addGlossaryWord,
  dismissGlossaryWord,
  ensureBookGlossary,
  fillGlossaryFromDictionary,
  isResolved,
  reorderGlossarySubset,
  setGlossaryClip,
  setGlossaryRespell,
  spellingKey,
} from "./glossary";
import { GlossaryDeck, GlossaryList, GlossaryPanel, SkipWordList } from "./GlossaryPanel";
import { removeSuppressedWord, reorderSuppressedWords } from "./suppress";
import { writeGlossaryClip, type BookProject } from "./store";

function openSummary(count: number, savedCount: number): string {
  if (count === 0 && savedCount === 0) {
    return "Nothing flagged yet.";
  }
  if (count === 0) {
    return savedCount === 1 ? "This name has a guide." : `All ${savedCount} names have a guide.`;
  }
  if (count === 1) {
    return "This name still needs a guide.";
  }
  return `${count} names still need a guide.`;
}

export function PronunciationScreen({
  project,
  onChange,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
}) {
  const glossary = project.glossary ?? [];
  const open = glossary.filter((entry) => !isResolved(entry));
  const saved = glossary.filter(isResolved);
  const skipped = project.suppressedWords ?? [];
  const [draftSpelling, setDraftSpelling] = useState("");
  const [draftGuide, setDraftGuide] = useState("");
  const [draftClip, setDraftClip] = useState<Blob | null>(null);
  const [draftClipUrl, setDraftClipUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [savedView, setSavedView] = useState<"cards" | "list">("cards");
  const [freshEntryId, setFreshEntryId] = useState<string | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const draftUrlRef = useRef<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const draftRecorder = useClipRecorder((blob) => {
    const url = URL.createObjectURL(blob);
    if (draftUrlRef.current) {
      URL.revokeObjectURL(draftUrlRef.current);
    }
    draftUrlRef.current = url;
    setDraftClip(blob);
    setDraftClipUrl(url);
  });

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
      audioRef.current?.pause();
      if (draftUrlRef.current) {
        URL.revokeObjectURL(draftUrlRef.current);
      }
    };
  }, []);

  function clearDraftClip() {
    audioRef.current?.pause();
    setPlaying(false);
    if (draftUrlRef.current) {
      URL.revokeObjectURL(draftUrlRef.current);
      draftUrlRef.current = null;
    }
    setDraftClip(null);
    setDraftClipUrl(null);
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

  const undecided = open.filter((entry) => !(entry.respell ?? "").trim()).length;

  async function fillFromDictionary() {
    if (fillBusy || undecided === 0) {
      return;
    }
    setFillBusy(true);
    setFillNote(null);
    try {
      const result = await fillGlossaryFromDictionary(projectRef.current.glossary ?? []);
      if (result.reason) {
        setFillNote(result.reason);
        return;
      }
      if (result.filled > 0) {
        onChange({ ...projectRef.current, glossary: result.glossary });
      }
      if (result.filled === 0) {
        setFillNote(
          result.unknown.length === 1
            ? "The dictionary does not know that name. Write the pronunciation yourself."
            : `The dictionary does not know any of those ${result.unknown.length} names. Write the pronunciation yourself.`,
        );
      } else {
        setFillNote(
          `Filled ${result.filled} pronunciation${result.filled === 1 ? "" : "s"} from the dictionary.`,
        );
      }
    } finally {
      setFillBusy(false);
    }
  }

  function markFresh(id: string) {
    setFreshEntryId(id);
  }

  function reorderOpen(ids: string[]) {
    onChange(reorderGlossarySubset(projectRef.current, ids));
  }

  function reorderSaved(ids: string[]) {
    onChange(reorderGlossarySubset(projectRef.current, ids));
  }

  function saveRespell(id: string, respell: string) {
    const next = setGlossaryRespell(projectRef.current, id, respell);
    onChange(next);
    if (respell.trim()) {
      markFresh(id);
    }
  }

  function saveClip(id: string, blob: Blob) {
    const snapshot = projectRef.current;
    void writeGlossaryClip(snapshot, id, blob).then((file) => {
      if (file) {
        onChange(setGlossaryClip(projectRef.current, id, file));
        markFresh(id);
      }
    });
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
        markFresh(added.id);
      });
      return;
    }
    if (added && isResolved(added)) {
      markFresh(added.id);
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
        <div className="ma-pronounce-add-lead">
          <p className="ma-pronounce-add-kicker">Add a word</p>
          {undecided > 0 ? (
            <button
              type="button"
              className="ma-pronounce-fill"
              disabled={fillBusy}
              onClick={() => void fillFromDictionary()}
            >
              {fillBusy ? "Looking them up…" : `Fill ${undecided} from the dictionary`}
            </button>
          ) : null}
        </div>
        <div className="ma-pronounce-add-row">
          <span className="ma-pronounce-add-icon" aria-hidden="true">
            <PlusGlyph />
          </span>
          <input
            className="neu-input ma-word-input"
            value={draftSpelling}
            placeholder="Word or phrase"
            aria-label="Word or phrase to pronounce"
            onChange={(event) => setDraftSpelling(event.target.value)}
          />
          <input
            className="neu-input ma-guide-input"
            value={draftGuide}
            placeholder="Guide"
            aria-label="Pronunciation guide"
            onChange={(event) => setDraftGuide(event.target.value)}
          />
          <div className="ma-pronounce-add-tools">
            <button
              type="button"
              className={`ma-record-btn${draftRecorder.recording ? " is-live" : ""}`}
              aria-pressed={draftRecorder.recording}
              aria-label={draftRecorder.recording ? "Stop recording" : "Record pronunciation"}
              onClick={() => draftRecorder.request(Boolean(draftClip))}
            >
              {draftRecorder.recording ? <WaveGlyph /> : <MicGlyph />}
              <span>{draftRecorder.recording ? "Stop" : "Record"}</span>
            </button>
            {draftClipUrl ? (
              <button
                type="button"
                className={`ma-clip-file${playing ? " is-live" : ""}${draftRecorder.fresh ? " is-fresh" : ""}`}
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
        </div>
        {fillNote ? <p className="ma-pronounce-fill-note">{fillNote}</p> : null}
      </form>

      <div className="ma-pronounce-board">
        <GlossaryPanel
          title="Flagged"
          summary={openSummary(open.length, saved.length)}
          entries={open}
          bookTotal={0}
          emptyCopy={saved.length === 0 ? "Nothing flagged yet." : "Nothing open. Resolved names live on the right."}
          project={project}
          onRespell={saveRespell}
          onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
          onClip={saveClip}
          onReorder={reorderOpen}
        />

        <section className="ma-glossary ma-pronounce-saved" aria-label="Saved pronunciations">
          <header className="ma-glossary-head ma-pronounce-saved-head">
            <div>
              <h2>Saved</h2>
              <p>Resolved names, and words this book never flags.</p>
            </div>
            {saved.length > 0 ? (
              <div className="ma-seg ma-pronounce-view" role="radiogroup" aria-label="Saved layout">
                <button
                  type="button"
                  className={savedView === "cards" ? "ma-seg-btn is-on" : "ma-seg-btn"}
                  aria-checked={savedView === "cards"}
                  role="radio"
                  onClick={() => setSavedView("cards")}
                >
                  Cards
                </button>
                <button
                  type="button"
                  className={savedView === "list" ? "ma-seg-btn is-on" : "ma-seg-btn"}
                  aria-checked={savedView === "list"}
                  role="radio"
                  onClick={() => setSavedView("list")}
                >
                  List
                </button>
              </div>
            ) : null}
          </header>
          <div className="ma-glossary-pane">
            {saved.length === 0 ? (
              <p className="ma-glossary-empty">Nothing resolved yet. Add a guide or a clip.</p>
            ) : savedView === "cards" ? (
              <GlossaryDeck
                entries={saved}
                project={project}
                highlightId={freshEntryId}
                onRespell={saveRespell}
                onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
                onClip={saveClip}
              />
            ) : (
              <GlossaryList
                entries={saved}
                project={project}
                highlightId={freshEntryId}
                onRespell={saveRespell}
                onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
                onClip={saveClip}
                onReorder={reorderSaved}
              />
            )}
          </div>
          <div className="ma-pronounce-skip">
            <h3>Never flag</h3>
            {skipped.length > 0 ? (
              <SkipWordList
                words={skipped}
                onRemove={(word) => onChange(removeSuppressedWord(project, word))}
                onReorder={(words) => onChange(reorderSuppressedWords(project, words))}
              />
            ) : (
              <p>None yet. On a proof flag, tap Never flag this word.</p>
            )}
          </div>
        </section>
      </div>

      {draftRecorder.ask ? (
        <ReplaceClipAsk
          word={draftSpelling.trim() || undefined}
          onCancel={draftRecorder.cancelAsk}
          onConfirm={draftRecorder.confirmReplace}
        />
      ) : null}
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
