import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

/** Shared warning dialog. Lit cream card, short title, one line, Cancel | verb. */
export function ConfirmAlert({
  title,
  body,
  confirm,
  cancel = "Cancel",
  busy = false,
  busyLabel,
  portal = true,
  global = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  cancel?: string;
  busy?: boolean;
  busyLabel?: string;
  portal?: boolean;
  global?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const subId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const dialog = (
    <div className={global ? "ma-scrim is-global" : "ma-scrim"} role="presentation" onClick={onCancel}>
      <div
        className="ma-alert neu-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ma-alert-copy">
          <h2 className="ma-alert-title" id={titleId}>
            {title}
          </h2>
          <p className="ma-alert-sub" id={subId}>
            {body}
          </p>
        </div>
        <div className="ma-alert-actions">
          <button type="button" className="ma-alert-btn" onClick={onCancel} disabled={busy} autoFocus>
            {cancel}
          </button>
          <button type="button" className="ma-alert-btn ma-alert-btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel ?? confirm) : confirm}
          </button>
        </div>
      </div>
    </div>
  );

  if (!portal) {
    return dialog;
  }
  const host = document.querySelector(".vault-overlay") ?? document.querySelector(".main-app");
  return host ? createPortal(dialog, host) : dialog;
}

export function analyzeManuscriptCopy(replaceManuscript: boolean, hasRecordings: boolean) {
  return {
    title: replaceManuscript ? "Replace manuscript?" : "Re-analyze this book?",
    body: hasRecordings
      ? "Chapters and recordings will be rebuilt from the manuscript. This can’t be undone."
      : "Every chapter will be rebuilt from the manuscript. This can’t be undone.",
    confirm: replaceManuscript ? "Replace" : "Re-analyze",
  };
}

export function deleteChapterCopy(title: string, hasTape: boolean) {
  return {
    title: "Delete chapter?",
    body: hasTape
      ? `“${title}” and its recordings will be permanently deleted. This can’t be undone.`
      : `“${title}” will be permanently deleted. This can’t be undone.`,
    confirm: "Delete",
  };
}
