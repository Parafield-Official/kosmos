import { useCallback, useEffect, useRef, useState } from "react";
import { pickupLineBounds } from "../../../../src/core/teleprompter/session-tape";
import { readChapterAudioUrl, type BookProject, type BookChapter, type ChapterPickup } from "./store";
import { playbackErrorMessage } from "./playback-error";

type Session = {
  key: string;
  audio: HTMLAudioElement;
  start: number;
  end: number;
  finished: boolean;
  dispose: () => void;
};
type Place = { key: string; at: number; window: { start: number; end: number } };

/** Playback can stop while the reader's place and source tape remain selected. */
export function useReviewPlayback(project: BookProject, chapter: BookChapter | null, chapterId: string) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const requestRef = useRef(0);
  const context = useRef({ project, chapter });
  context.current = { project, chapter };
  const urls = useRef(new Map<string, string>());

  const dispose = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.dispose();
  }, []);

  useEffect(() => {
    // A different chapter, replaced tape, or applied/reverted punch invalidates
    // both the old audio bytes and its retained reading position.
    requestRef.current += 1;
    dispose();
    setPlaying(null);
    setPlace(null);
    setError(null);
    setLoading(false);
    return () => {
      requestRef.current += 1;
      dispose();
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [project.id, project.folder, chapterId, chapter?.originalFile, chapter?.workingFile,
    chapter?.punches, chapter?.recordedWords, chapter?.proofTranscript, dispose]);

  const stopPlayback = useCallback(() => {
    requestRef.current += 1;
    const session = sessionRef.current;
    if (session) {
      session.audio.pause();
      setPlace({ key: session.key, at: Math.min(session.audio.currentTime, session.end), window: { start: session.start, end: session.end } });
    }
    setPlaying(null);
    setLoading(false);
  }, []);

  const playRange = useCallback(async (slot: "original" | "working", pickup: ChapterPickup) => {
    const request = ++requestRef.current;
    const key = `${slot}-${pickup.id}`;
    setError(null);
    const previous = sessionRef.current;
    let session = previous?.key === key && !previous.finished ? previous : null;
    try {
      if (!session) {
        dispose();
        setPlaying(null);
        const { project, chapter } = context.current;
        const file = slot === "original" ? chapter?.originalFile : chapter?.workingFile;
        if (!file) throw new Error("No recording");
        setLoading(true);
        let url = urls.current.get(file);
        if (!url) {
          const loaded = await readChapterAudioUrl(project, file);
          if (request !== requestRef.current) {
            if (loaded) URL.revokeObjectURL(loaded);
            return;
          }
          if (!loaded) throw new Error("Recording unavailable");
          url = loaded;
          urls.current.set(file, url);
        }
        const bounds = pickupLineBounds(pickup);
        const start = Math.max(0, bounds.start - (bounds.wordOnly ? 0.5 : 0.15));
        const end = bounds.end + (bounds.wordOnly ? 0.5 : 0.15);
        const audio = new Audio(url);
        const active: Session = { key, audio, start, end, finished: false, dispose: () => {} };
        const remember = () => setPlace({ key, at: Math.min(audio.currentTime, end), window: { start, end } });
        const finish = () => {
          if (sessionRef.current !== active) return;
          active.finished = true;
          audio.pause();
          remember();
          setPlaying(null);
        };
        const onTime = () => {
          if (sessionRef.current !== active) return;
          remember();
          if (audio.currentTime >= end) finish();
        };
        const onPause = () => {
          if (sessionRef.current !== active || !audio.paused) return;
          remember();
          setPlaying(null);
        };
        const onError = () => {
          if (sessionRef.current !== active) return;
          stopPlayback();
          dispose();
          urls.current.delete(file);
          URL.revokeObjectURL(url);
          setError(playbackErrorMessage());
        };
        active.dispose = () => {
          audio.removeEventListener("timeupdate", onTime);
          audio.removeEventListener("ended", finish);
          audio.removeEventListener("pause", onPause);
          audio.removeEventListener("error", onError);
          audio.pause();
        };
        sessionRef.current = active;
        session = active;
        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("ended", finish);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("error", onError);
        audio.currentTime = start;
        remember();
      }
      setLoading(false);
      setPlaying(key);
      await session.audio.play();
      if (request !== requestRef.current) return;
    } catch (reason) {
      if (request !== requestRef.current) return;
      setLoading(false);
      setPlaying(null);
      setError(playbackErrorMessage(reason));
      for (const [file, url] of urls.current) {
        if (url === session?.audio.src) {
          urls.current.delete(file);
          URL.revokeObjectURL(url);
        }
      }
      dispose();
    }
  }, [dispose, stopPlayback]);

  const seek = useCallback((seconds: number) => {
    const session = sessionRef.current;
    if (!session) return;
    session.audio.currentTime = Math.max(session.start, Math.min(session.end, seconds));
    session.finished = session.audio.currentTime >= session.end;
    setPlace({ key: session.key, at: session.audio.currentTime, window: { start: session.start, end: session.end } });
  }, []);

  return { playing, playKey: place?.key ?? null, playAt: place?.at ?? null,
    playWindow: place?.window ?? null, error, loading, playRange, stopPlayback, seek };
}
