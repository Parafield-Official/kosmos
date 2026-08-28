import { useEffect, useState } from "react";
import type { GlossaryEntry } from "../../../../src/core/project/types";

export function GlossaryPanel({
  title,
  summary,
  entries,
  bookTotal,
  allowAdd,
  emptyCopy,
  onRespell,
  onDismiss,
  onAdd,
}: {
  title: string;
  summary: string;
  entries: GlossaryEntry[];
  bookTotal: number;
  allowAdd?: boolean;
  emptyCopy: string;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onAdd?: (spelling: string, respell: string) => void;
}) {
  const [draftSpelling, setDraftSpelling] = useState("");
  const [draftRespell, setDraftRespell] = useState("");

  function submitAdd() {
    const spelling = draftSpelling.trim();
    if (!spelling || !onAdd) {
      return;
    }
    onAdd(spelling, draftRespell.trim());
    setDraftSpelling("");
    setDraftRespell("");
  }

  return (
    <section className="ma-glossary" aria-label={title}>
      <header className="ma-glossary-head">
        <h2>{title}</h2>
        <p>{summary}</p>
        {bookTotal > 0 ? <p className="ma-glossary-book">{bookTotal} flagged in the book</p> : null}
      </header>

      {entries.length === 0 ? <p className="ma-glossary-empty">{emptyCopy}</p> : (
        <ul className="ma-glossary-list">
          {entries.map((entry) => (
            <GlossaryRow
              key={entry.id}
              entry={entry}
              onRespell={onRespell}
              onDismiss={onDismiss}
            />
          ))}
        </ul>
      )}

      {allowAdd && onAdd ? (
        <div className="ma-glossary-add">
          <input
            className="neu-input"
            value={draftSpelling}
            placeholder="Add a word or phrase"
            aria-label="Word or phrase to pronounce"
            onChange={(event) => setDraftSpelling(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitAdd();
              }
            }}
          />
          <input
            className="neu-input"
            value={draftRespell}
            placeholder="Pronunciation guide"
            aria-label="Pronunciation guide"
            onChange={(event) => setDraftRespell(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitAdd();
              }
            }}
          />
          <button type="button" className="btn btn-clear" disabled={!draftSpelling.trim()} onClick={submitAdd}>
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}

function GlossaryRow({
  entry,
  onRespell,
  onDismiss,
}: {
  entry: GlossaryEntry;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [respell, setRespell] = useState(entry.respell ?? "");
  const saved = (entry.respell ?? "").trim();
  const dirty = respell.trim() !== saved;

  useEffect(() => {
    setRespell(entry.respell ?? "");
  }, [entry.respell]);

  return (
    <li className={saved ? "is-set" : undefined}>
      <strong>{entry.spelling}</strong>
      <input
        className="neu-input"
        value={respell}
        placeholder="Pronunciation guide"
        aria-label={`Pronunciation guide for ${entry.spelling}`}
        onChange={(event) => setRespell(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && respell.trim()) {
            onRespell(entry.id, respell);
          }
        }}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={!respell.trim() || !dirty}
        onClick={() => onRespell(entry.id, respell)}
      >
        {saved ? "Update" : "Set"}
      </button>
      <button type="button" className="btn btn-sm btn-clear" onClick={() => onDismiss(entry.id)}>
        Remove
      </button>
    </li>
  );
}
