import { useState } from "react";
import { simulateFinishedTake } from "./debug-finish-take";
import type { BookProject } from "./store";

/** Dev-only: fake a finished take on the open chapter so proof and master can be tested. */
export function DebugFinishTakeButton({
  project,
  chapterId,
  onChange,
}: {
  project: BookProject;
  chapterId: string;
  onChange: (next: BookProject) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm ma-debug-finish"
        disabled={busy}
        onClick={() => {
          setError(null);
          setBusy(true);
          void simulateFinishedTake(project, chapterId)
            .then(onChange)
            .catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Could not build a debug take.");
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Faking take…" : "Debug: finish take"}
      </button>
      {error ? <p className="ma-error">{error}</p> : null}
    </>
  );
}
