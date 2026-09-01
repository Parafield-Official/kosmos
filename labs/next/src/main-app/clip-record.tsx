import { useEffect, useRef, useState } from "react";
import { ConfirmAlert } from "./ConfirmAlert";

/** Confirm before a pronunciation clip overwrites an existing one. */
export function ReplaceClipAsk({
  word,
  onCancel,
  onConfirm,
}: {
  word?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = word?.trim();
  return (
    <ConfirmAlert
      global
      title="Replace this clip?"
      body={
        label
          ? `Recording again overwrites the clip for “${label}”. This can’t be undone.`
          : "Recording again overwrites the current clip. This can’t be undone."
      }
      confirm="Replace"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export function useClipRecorder(onBlob?: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [ask, setAsk] = useState(false);
  const onBlobRef = useRef(onBlob);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const freshTimer = useRef(0);
  const aliveRef = useRef(true);
  const startingRef = useRef(false);

  onBlobRef.current = onBlob;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      window.clearTimeout(freshTimer.current);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  function markFresh() {
    setFresh(true);
    window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => {
      if (aliveRef.current) {
        setFresh(false);
      }
    }, 780);
  }

  async function start() {
    if (!onBlobRef.current || startingRef.current || recorderRef.current) {
      return;
    }
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
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
        if (!aliveRef.current) {
          return;
        }
        setRecording(false);
        if (chunks.length === 0) {
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        markFresh();
        onBlobRef.current?.(blob);
      };
      recorderRef.current = recorder;
      // A timeslice emitted a new Blob event every 80 ms even though the clip is
      // only consumed after Stop. One final chunk preserves the encoded audio
      // while avoiding needless renderer callbacks and allocations.
      recorder.start();
      setRecording(true);
    } catch {
      if (aliveRef.current) {
        setRecording(false);
      }
    } finally {
      startingRef.current = false;
    }
  }

  function request(hasClip: boolean) {
    if (!onBlobRef.current) {
      return;
    }
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (hasClip) {
      setAsk(true);
      return;
    }
    void start();
  }

  return {
    recording,
    fresh,
    ask,
    request,
    confirmReplace() {
      setAsk(false);
      void start();
    },
    cancelAsk() {
      setAsk(false);
    },
  };
}
