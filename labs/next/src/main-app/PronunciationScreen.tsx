import { useEffect } from "react";
import {
  addGlossaryWord,
  dismissGlossaryWord,
  ensureBookGlossary,
  isResolved,
  setGlossaryRespell,
} from "./glossary";
import { GlossaryPanel } from "./GlossaryPanel";
import { removeSuppressedWord } from "./suppress";
import type { BookProject } from "./store";

export function PronunciationScreen({
  project,
  onChange,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
}) {
  const glossary = project.glossary ?? [];
  const unresolvedCount = glossary.filter((entry) => !isResolved(entry)).length;
  const glossaryEntries = [...glossary].sort((left, right) => Number(isResolved(left)) - Number(isResolved(right)));

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

  return (
    <section className="ma-screen ma-pronounce" aria-label="Pronunciation">
      <h1 className="ma-title">Pronunciation</h1>
      <p className="ma-set-sub">
        Flagged names and words for this book. Set how to say them, remove one, or add a word the scanner missed.
      </p>

      <GlossaryPanel
        title="Words & phrases"
        summary={
          glossary.length === 0
            ? "No names flagged in this book yet. Add one if a word needs a spelling."
            : unresolvedCount === 0
              ? `All ${glossary.length} ${glossary.length === 1 ? "name" : "names"} have a pronunciation.`
              : `${unresolvedCount} of ${glossary.length} need a pronunciation.`
        }
        entries={glossaryEntries}
        bookTotal={0}
        allowAdd
        emptyCopy="Add a word or phrase if the scanner missed it. Resolving one here clears it for every chapter."
        onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
        onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
        onAdd={(spelling, respell) => onChange(addGlossaryWord(project, spelling, respell))}
      />

      <section className="ma-glossary ma-suppress" aria-label="Words this book never flags">
        <header className="ma-glossary-head">
          <h2>Never flag</h2>
          <p>
            {(project.suppressedWords ?? []).length === 0
              ? "None yet. On a proof flag, tap Never flag this word."
              : "Skipped on proof and while recording. Remove one to flag it again after the next proof."}
          </p>
        </header>
        {(project.suppressedWords ?? []).length > 0 ? (
          <ul className="ma-suppress-list">
            {(project.suppressedWords ?? []).map((word) => (
              <li key={word}>
                <span>{word}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-clear"
                  aria-label={`Flag ${word} again`}
                  onClick={() => onChange(removeSuppressedWord(project, word))}
                >
                  Flag again
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
