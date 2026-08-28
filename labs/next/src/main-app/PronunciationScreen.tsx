import { useEffect } from "react";
import type { GlossaryEntry } from "../../../../src/core/project/types";
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

function pronunciationSummary(entries: GlossaryEntry[]): string {
  const unresolved = entries.filter((entry) => !isResolved(entry)).length;
  const total = entries.length;
  if (total === 0) {
    return "";
  }
  if (unresolved === 0) {
    return total === 1 ? "This name has a pronunciation." : `All ${total} names have a pronunciation.`;
  }
  if (unresolved === 1) {
    return total === 1 ? "This name still needs a pronunciation." : `1 of ${total} names still needs a pronunciation.`;
  }
  return `${unresolved} of ${total} names still need a pronunciation.`;
}

export function PronunciationScreen({
  project,
  onChange,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
}) {
  const glossary = project.glossary ?? [];
  const autoEntries = glossary.filter((entry) => entry.source !== "user");
  const addedEntries = glossary.filter((entry) => entry.source === "user");

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
        Auto-flagged words and phrases for this book. Set the spelling and pronunciation guide, remove one, or add a
        word the scanner missed.
      </p>

      <div className="ma-pronounce-lists">
        <GlossaryPanel
          title="Auto-flagged"
          summary={autoEntries.length === 0 ? "No auto-flagged names in this book." : pronunciationSummary(autoEntries)}
          entries={[...autoEntries].sort((left, right) => Number(isResolved(left)) - Number(isResolved(right)))}
          bookTotal={0}
          emptyCopy="Nothing auto-flagged yet."
          onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
          onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
        />
        <GlossaryPanel
          title="Added words & phrases"
          summary={
            addedEntries.length === 0 ? "Add a word or phrase the scanner missed." : pronunciationSummary(addedEntries)
          }
          entries={[...addedEntries].sort((left, right) => Number(isResolved(left)) - Number(isResolved(right)))}
          bookTotal={0}
          allowAdd
          emptyCopy="No added words yet."
          onRespell={(id, respell) => onChange(setGlossaryRespell(project, id, respell))}
          onDismiss={(id) => onChange(dismissGlossaryWord(project, id))}
          onAdd={(spelling, respell) => onChange(addGlossaryWord(project, spelling, respell))}
        />
      </div>

      <section className="ma-glossary ma-suppress" aria-label="Words this book never flags">
        <header className="ma-glossary-head">
          <h2>Never flag</h2>
          <p>
            {(project.suppressedWords ?? []).length === 0
              ? "No words skipped yet. On a proof flag, tap Never flag this word."
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
