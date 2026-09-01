export const KOSMOS_RELEASE_PAGE = "https://github.com/Parafield-Official/kosmos/releases/latest";
export const LAST_SEEN_VERSION_KEY = "kosmos.last-seen-version";

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "up-to-date";

export type AppUpdateStatus = {
  phase: AppUpdatePhase;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
  skipped?: boolean;
  canInstall?: boolean;
  showBanner?: boolean;
  text?: string;
  releasePage?: string;
};

export type UpdateNoticeKind = "arriving" | "ready" | "applied" | "stuck";

export type UpdateNoticeAction = {
  kind: "install" | "open-release" | "dismiss";
  label: string;
};

export type AppliedUpdate = {
  kind: "applied";
  from: string;
  to: string;
};

export type UpdateNoticeView = {
  kind: UpdateNoticeKind;
  kicker: string;
  title: string;
  body: string;
  percent?: number;
  action?: UpdateNoticeAction;
  auto?: boolean;
};

export function rememberSeenVersion(
  currentVersion: string,
  storage: Pick<Storage, "setItem">,
): void {
  storage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);
}

export function appliedUpdateNotice(
  currentVersion: string | undefined,
  storage: Pick<Storage, "getItem" | "setItem">,
): AppliedUpdate | null {
  if (!currentVersion) {
    return null;
  }
  const last = storage.getItem(LAST_SEEN_VERSION_KEY);
  if (!last) {
    rememberSeenVersion(currentVersion, storage);
    return null;
  }
  if (last === currentVersion) {
    return null;
  }
  return { kind: "applied", from: last, to: currentVersion };
}

export function updateNoticeView(
  status: AppUpdateStatus | null | undefined,
  applied?: AppliedUpdate | null,
): UpdateNoticeView | null {
  if (status?.phase === "available" || status?.phase === "downloading") {
    const percent = Number.isFinite(status.percent) ? Math.round(status.percent as number) : undefined;
    return {
      kind: "arriving",
      kicker: "New version",
      title: status.version ? `Kosmos ${status.version} is coming in` : "A new Kosmos is coming in",
      body: percent == null
        ? "Downloading on its own. You can keep working."
        : `Downloading on its own · ${percent} percent.`,
      percent,
      auto: true,
    };
  }
  if (status?.phase === "ready" || status?.canInstall) {
    return {
      kind: "ready",
      kicker: "Installed",
      title: status.version ? `Kosmos ${status.version} is on this computer` : "The new Kosmos is on this computer",
      body: "Restart when you are not recording. Quitting applies it too.",
      action: { kind: "install", label: "Restart now" },
      auto: true,
    };
  }
  if (status?.phase === "error") {
    return {
      kind: "stuck",
      kicker: "Could not update",
      title: "This copy stayed as it is",
      body: "The booth still works. Get the latest installer if this copy cannot update itself.",
      action: { kind: "open-release", label: "Get the latest installer" },
    };
  }
  if (applied) {
    return {
      kind: "applied",
      kicker: "Updated",
      title: `You're on Kosmos ${applied.to}`,
      body: `This copy replaced ${applied.from} on its own.`,
      action: { kind: "dismiss", label: "OK" },
      auto: true,
    };
  }
  return null;
}

export function shouldShowUpdateBanner(
  status: AppUpdateStatus | null | undefined,
  applied?: AppliedUpdate | null,
): boolean {
  return updateNoticeView(status, applied) !== null;
}

export function updateBannerAction(
  status: AppUpdateStatus | null | undefined,
): { kind: "install" | "open-release"; label: string } | null {
  const action = updateNoticeView(status)?.action;
  if (action?.kind === "install") {
    return { kind: "install", label: action.label };
  }
  if (action?.kind === "open-release") {
    return { kind: "open-release", label: action.label };
  }
  return null;
}

export function settingsUpdateCopy(status: AppUpdateStatus | null | undefined): string {
  if (!status || status.skipped || status.phase === "idle") {
    return "This development copy does not check GitHub. Installed Kosmos downloads later versions itself.";
  }
  const view = updateNoticeView(status);
  if (view) {
    return view.body;
  }
  if (status.text) {
    return status.text;
  }
  if (status.currentVersion) {
    return `This copy is ${status.currentVersion}.`;
  }
  return "Installed Kosmos checks GitHub for a later version.";
}
