import { useEffect, useRef, useState } from "react";
import type { GlossaryEntry } from "../../../../src/core/project/types";
import { readChapterAudioUrl, type BookProject } from "./store";

/** Flashcards for chapter words that already have a guide or clip. */
export function PronunciationCheatSheet({
  entries,
  project,
}: {
  entries: GlossaryEntry[];
  project: BookProject;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const count = entries.length;
  const safeIndex = count === 0 ? 0 : ((index % count) + count) % count;
  const entry = entries[safeIndex];

  const ids = entries.map((item) => item.id).join("|");
  useEffect(() => {
    setIndex(0);
  }, [ids]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => value + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => value - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  }, [safeIndex]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (!entry) {
    return <p className="booth-cheat-empty">No guides in this chapter yet.</p>;
  }

  const guide = entry.respell?.trim();
  const hasClip = Boolean(entry.clip_path);

  async function playClip() {
    if (!entry.clip_path) {
      return;
    }
    if (playing) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const url = await readChapterAudioUrl(project, entry.clip_path);
    if (!url) {
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(true);
    audio.onended = () => {
      setPlaying(false);
      audioRef.current = null;
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
      setPlaying(false);
      audioRef.current = null;
      URL.revokeObjectURL(url);
    };
    try {
      await audio.play();
    } catch {
      setPlaying(false);
      audioRef.current = null;
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="booth-cheat">
      <p className="booth-cheat-count">
        {safeIndex + 1} of {count}
      </p>
      <p className="booth-cheat-word">{entry.spelling}</p>
      {guide ? <p className="booth-cheat-guide">{guide}</p> : <p className="booth-cheat-guide is-mute">No written guide</p>}
      <div className="booth-cheat-nav">
        <button type="button" className="booth-tool" onClick={() => setIndex((value) => value - 1)} disabled={count < 2}>
          Previous
        </button>
        {hasClip ? (
          <button type="button" className="booth-tool is-primary" onClick={() => void playClip()}>
            {playing ? "Playing…" : "Play clip"}
          </button>
        ) : null}
        <button type="button" className="booth-tool" onClick={() => setIndex((value) => value + 1)} disabled={count < 2}>
          Next
        </button>
      </div>
    </div>
  );
}
