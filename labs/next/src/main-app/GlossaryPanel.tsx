import { useEffect, useRef, useState } from "react";
import type { GlossaryEntry } from "../../../../src/core/project/types";
import { readChapterAudioUrl, type BookProject } from "./store";

function fieldChars(value: string, min: number, max = 56): number {
  return Math.min(max, Math.max(min, [...value].length + 3));
}

export function GlossaryPanel({
  title,
  summary,
  entries,
  bookTotal,
  allowAdd,
  emptyCopy,
  project,
  onRespell,
  onDismiss,
  onAdd,
  onClip,
}: {
  title: string;
  summary: string;
  entries: GlossaryEntry[];
  bookTotal: number;
  allowAdd?: boolean;
  emptyCopy: string;
  project?: BookProject;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onAdd?: (spelling: string, respell: string) => void;
  onClip?: (id: string, blob: Blob) => void;
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
    <section className={`ma-glossary${entries.length === 0 ? " is-empty" : ""}`} aria-label={title}>
      <header className="ma-glossary-head">
        <h2>{title}</h2>
        <p>{summary}</p>
        {bookTotal > 0 ? <p className="ma-glossary-book">{bookTotal} flagged in the book</p> : null}
      </header>

      <div className="ma-glossary-pane">
        {entries.length === 0 ? (
          <p className="ma-glossary-empty">{emptyCopy}</p>
        ) : (
          <ul className="ma-glossary-list">
            {entries.map((entry) => (
              <GlossaryRow
                key={entry.id}
                entry={entry}
                project={project}
                onRespell={onRespell}
                onDismiss={onDismiss}
                onClip={onClip}
              />
            ))}
          </ul>
        )}
      </div>

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
            placeholder="Guide"
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
  project,
  onRespell,
  onDismiss,
  onClip,
}: {
  entry: GlossaryEntry;
  project?: BookProject;
  onRespell: (id: string, respell: string) => void;
  onDismiss: (id: string) => void;
  onClip?: (id: string, blob: Blob) => void;
}) {
  const [respell, setRespell] = useState(entry.respell ?? "");
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const saved = (entry.respell ?? "").trim();
  const dirty = respell.trim() !== saved;
  const canRecord = Boolean(onClip);
  const hasClip = Boolean(entry.clip_path || pendingUrl);

  useEffect(() => {
    setRespell(entry.respell ?? "");
  }, [entry.respell]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
      }
    };
  }, []);

  async function toggleRecord() {
    if (!onClip) {
      return;
    }
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
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
          const url = URL.createObjectURL(blob);
          setPendingUrl((prev) => {
            if (prev) {
              URL.revokeObjectURL(prev);
            }
            return url;
          });
          onClip(entry.id, blob);
        }
      };
      recorderRef.current = recorder;
      recorder.start(80);
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }

  async function togglePlay() {
    const localUrl = pendingUrl;
    if (!localUrl && (!project || !entry.clip_path)) {
      return;
    }
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const url = localUrl ?? (project && entry.clip_path ? await readChapterAudioUrl(project, entry.clip_path) : null);
    if (!url) {
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      setPlaying(false);
      if (!localUrl) {
        URL.revokeObjectURL(url);
      }
    };
    await audio.play();
    setPlaying(true);
  }

  return (
    <li className={`${saved || hasClip ? "is-set" : ""}${hasClip ? " has-clip" : ""}`.trim() || undefined}>
      <strong>{entry.spelling}</strong>
      <input
        className="neu-input ma-guide-input"
        value={respell}
        size={fieldChars(respell.trim() || entry.spelling, 16)}
        placeholder="Guide"
        aria-label={`Pronunciation guide for ${entry.spelling}`}
        onChange={(event) => setRespell(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && respell.trim()) {
            onRespell(entry.id, respell);
          }
        }}
      />
      <div className="ma-word-acts">
        {canRecord ? (
          <button
            type="button"
            className={`ma-word-act${recording ? " is-live" : ""}`}
            aria-label={recording ? `Stop recording ${entry.spelling}` : `Record ${entry.spelling}`}
            title={recording ? "Stop" : "Record"}
            onClick={() => void toggleRecord()}
          >
            {recording ? <WaveGlyph /> : <MicGlyph />}
          </button>
        ) : null}
        {hasClip ? (
          <button
            type="button"
            className={`ma-clip-file${playing ? " is-live" : ""}`}
            aria-label={playing ? `Pause ${entry.spelling}` : `Play ${entry.spelling}`}
            title={playing ? "Pause" : "Play clip"}
            onClick={() => void togglePlay()}
          >
            {playing ? <PauseGlyph /> : <PlayGlyph />}
            <span>Clip</span>
          </button>
        ) : null}
        <button
          type="button"
          className="ma-word-act"
          disabled={!respell.trim() || !dirty}
          aria-label={saved ? `Save ${entry.spelling}` : `Set ${entry.spelling}`}
          title={saved ? "Save" : "Set"}
          onClick={() => onRespell(entry.id, respell)}
        >
          <CheckGlyph />
        </button>
        <button
          type="button"
          className="ma-word-act is-danger"
          aria-label={`Remove ${entry.spelling}`}
          title="Remove"
          onClick={() => onDismiss(entry.id)}
        >
          <TrashGlyph />
        </button>
      </div>
    </li>
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

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.6 8.2 6.6 11.2 12.4 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 4.4h9.6M6.2 4.4V3.2h3.6v1.2M5.1 4.4l.5 8.2h4.8l.5-8.2" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}
