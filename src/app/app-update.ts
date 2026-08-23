export const KOSMOS_RELEASE_PAGE = "https://github.com/Manishram-ai/kosmos/releases/latest";

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

export function shouldShowUpdateBanner(status: AppUpdateStatus | null | undefined): boolean {
  return Boolean(status?.showBanner && status.text);
}

export function updateBannerAction(
  status: AppUpdateStatus | null | undefined,
): { kind: "install" | "open-release"; label: string } | null {
  if (!status?.showBanner) {
    return null;
  }
  if (status.canInstall || status.phase === "ready") {
    return { kind: "install", label: "Restart to update" };
  }
  if (status.phase === "error") {
    return { kind: "open-release", label: "Get the latest installer" };
  }
  return null;
}

export function settingsUpdateCopy(status: AppUpdateStatus | null | undefined): string {
  if (!status || status.skipped || status.phase === "idle") {
    return "This development copy does not check GitHub. Installed Kosmos downloads later versions itself.";
  }
  if (status.text) {
    return status.text;
  }
  if (status.currentVersion) {
    return `This copy is ${status.currentVersion}.`;
  }
  return "Installed Kosmos checks GitHub for a later version.";
}
