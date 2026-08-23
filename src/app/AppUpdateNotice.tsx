import { useEffect, useState } from "react";
import {
  appliedUpdateNotice,
  rememberSeenVersion,
  updateNoticeView,
  type AppUpdateStatus,
  type AppliedUpdate,
  type UpdateNoticeView,
} from "./app-update";

const APPLIED_NOTICE_MS = 8_000;

export function AppUpdateNoticeCard({
  view,
  embedded = false,
  onAction,
}: {
  view: UpdateNoticeView;
  embedded?: boolean;
  onAction?: () => void;
}) {
  const progress = view.percent;
  const indeterminate = view.kind === "arriving" && progress == null;
  return (
    <aside
      className={[
        "update-notice",
        `update-notice-${view.kind}`,
        embedded ? "update-notice-embedded" : "",
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <header className="update-notice-kicker">
        <p>{view.kicker}</p>
        {view.auto ? <span>Auto</span> : null}
      </header>
      <h2>{view.title}</h2>
      <p className="update-notice-body">{view.body}</p>
      {view.kind === "arriving" ? (
        <div
          className={indeterminate ? "update-notice-progress indeterminate" : "update-notice-progress"}
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : progress}
        >
          <span style={indeterminate ? undefined : { transform: `scaleX(${Math.max(0, Math.min(100, progress ?? 0)) / 100})` }} />
        </div>
      ) : null}
      {view.action ? (
        <button
          className={view.action.kind === "install" ? "update-notice-action primary" : "update-notice-action"}
          type="button"
          onClick={onAction}
        >
          {view.action.label}
        </button>
      ) : null}
    </aside>
  );
}

export function AppUpdateNotice({
  status,
  hidden = false,
}: {
  status: AppUpdateStatus | null;
  hidden?: boolean;
}) {
  const [applied, setApplied] = useState<AppliedUpdate | null>(null);

  useEffect(() => {
    if (!status?.currentVersion || typeof window === "undefined") {
      return;
    }
    setApplied(appliedUpdateNotice(status.currentVersion, window.localStorage));
  }, [status?.currentVersion]);

  const view = updateNoticeView(status, applied);

  useEffect(() => {
    if (view?.kind !== "applied" || !status?.currentVersion) {
      return;
    }
    const timer = window.setTimeout(() => {
      rememberSeenVersion(status.currentVersion as string, window.localStorage);
      setApplied(null);
    }, APPLIED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [view?.kind, status?.currentVersion]);

  if (hidden || !view) {
    return null;
  }

  const notice = view;
  function act() {
    if (notice.action?.kind === "install") {
      void window.boothDesk?.installAppUpdate();
      return;
    }
    if (notice.action?.kind === "open-release") {
      void window.boothDesk?.openKosmosRelease();
      return;
    }
    if (notice.action?.kind === "dismiss" && status?.currentVersion) {
      rememberSeenVersion(status.currentVersion, window.localStorage);
      setApplied(null);
    }
  }

  return <AppUpdateNoticeCard view={notice} onAction={act} />;
}
