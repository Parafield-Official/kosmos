import { useEffect, useRef, useState } from "react";

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
    <div className="ma-scrim is-global" role="presentation" onClick={onCancel}>
      <div
        className="ma-alert neu-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ma-clip-replace-title"
        aria-describedby="ma-clip-replace-sub"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ma-alert-copy">
          <h2 className="ma-alert-title" id="ma-clip-replace-title">
            Replace this clip?
          </h2>
          <p className="ma-alert-sub" id="ma-clip-replace-sub">
            {label
              ? `Recording again overwrites the current clip for “${label}”.`
              : "Recording again overwrites the current clip."}
          </p>
        </div>
        <div className="ma-alert-actions">
          <button type="button" className="ma-alert-btn" onClick={onCancel} autoFocus>
            Keep
          </button>
          <button type="button" className="ma-alert-btn ma-alert-btn-danger" onClick={onConfirm}>
            Replace
          </button>
        </div>
      </div>
    </div>
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
    if (!onBlobRef.current) {
      return;
    }
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
      recorder.start(80);
      setRecording(true);
    } catch {
      if (aliveRef.current) {
        setRecording(false);
      }
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
