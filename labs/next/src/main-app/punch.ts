import { pickupLineBounds } from "../../../../src/core/teleprompter/session-tape";
import { readEnginePrefs } from "./engine-prefs";
import {
  applyChapterPickups,
  applyChapterPunches,
  applyWorkingTape,
  copyOriginalToWorking,
  type BookProject,
  type ChapterPickup,
  type ChapterPunch,
} from "./store";

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** After a splice, close the flags that range covered and shift later ones. */
export function applyPunchToPickups(
  pickups: ChapterPickup[],
  applied: { pickupIds: string[]; start: number; end: number; durationDelta: number },
): ChapterPickup[] {
  const done = new Set(applied.pickupIds);
  return pickups.map((pickup) => {
    if (done.has(pickup.id) || pickup.status !== "open") {
      return done.has(pickup.id) ? { ...pickup, status: "done" } : pickup;
    }
    const start = pickup.line_start ?? pickup.t_start;
    const end = pickup.line_end ?? pickup.t_end;
    if (start < applied.end && end > applied.start) {
      return { ...pickup, status: "done" };
    }
    if (start >= applied.end && applied.durationDelta !== 0) {
      return {
        ...pickup,
        t_start: pickup.t_start + applied.durationDelta,
        t_end: pickup.t_end + applied.durationDelta,
        line_start: pickup.line_start != null ? pickup.line_start + applied.durationDelta : undefined,
        line_end: pickup.line_end != null ? pickup.line_end + applied.durationDelta : undefined,
      };
    }
    return pickup;
  });
}

export async function applyPunchRecording(
  project: BookProject,
  chapterId: string,
  pickup: ChapterPickup,
  wavBytes: Uint8Array,
  pickupIds: string[],
): Promise<BookProject> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter?.originalFile) {
    throw new Error("Record or import an original take first.");
  }
  if (!project.folder || !window.kosmosNext?.applyPunch) {
    throw new Error("Punch-in needs the desktop app.");
  }
  let working = chapter.workingFile;
  if (!working) {
    working = (await copyOriginalToWorking(project, chapterId)) ?? undefined;
  }
  if (!working) {
    throw new Error("Could not create the working file from original.");
  }
  const existing = chapter.pickups ?? [];
  const bounds = pickupLineBounds(pickup);
  const result = await window.kosmosNext.applyPunch({
    folder: project.folder,
    chapterId,
    originalFile: chapter.originalFile,
    workingFile: working,
    punches: chapter.punches,
    pickupId: pickup.id,
    expected: pickup.expected,
    heard: pickup.heard,
    tStart: bounds.start,
    tEnd: bounds.end,
    wavBase64: bytesToBase64(wavBytes),
  });
  if (!result.ok || !result.workingFile) {
    throw new Error(result.reason || "Could not apply that punch.");
  }
  const punches = punchesFromResult(result.punches, chapterId);
  const patched = applyPunchToPickups(
    existing.some((item) => item.id === pickup.id) ? existing : [...existing, pickup],
    {
      pickupIds,
      start: result.appliedStart ?? bounds.start,
      end: result.appliedEnd ?? bounds.end,
      durationDelta: result.durationDelta ?? 0,
    },
  );
  let next = applyWorkingTape(project, chapterId, result.workingFile);
  next = applyChapterPunches(next, chapterId, punches);
  next = applyChapterPickups(next, chapterId, patched);
  return {
    ...next,
    chapters: next.chapters.map((item) =>
      item.id === chapterId ? { ...item, mastered: false, acxTrafficLight: undefined } : item,
    ),
  };
}

export async function undoLatestChapterPunch(project: BookProject, chapterId: string): Promise<BookProject> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter?.originalFile) {
    throw new Error("Nothing to undo.");
  }
  if (!project.folder || !window.kosmosNext?.undoLatestPunch) {
    throw new Error("Undo needs the desktop app.");
  }
  const result = await window.kosmosNext.undoLatestPunch({
    folder: project.folder,
    chapterId,
    originalFile: chapter.originalFile,
    workingFile: chapter.workingFile,
    punches: chapter.punches,
  });
  if (!result.ok || !result.workingFile) {
    throw new Error(result.reason || "Could not undo that punch.");
  }
  let next = applyWorkingTape(project, chapterId, result.workingFile);
  next = applyChapterPunches(next, chapterId, punchesFromResult(result.punches, chapterId));
  return {
    ...next,
    chapters: next.chapters.map((item) =>
      item.id === chapterId ? { ...item, mastered: false, acxTrafficLight: undefined } : item,
    ),
  };
}

export async function masterChapterWorking(project: BookProject, chapterId: string): Promise<BookProject> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter?.workingFile) {
    throw new Error("Proofread first so there is a working file to master.");
  }
  if (!project.folder || !window.kosmosNext?.masterChapter) {
    throw new Error("Mastering needs the desktop app.");
  }
  const result = await window.kosmosNext.masterChapter({
    folder: project.folder,
    workingFile: chapter.workingFile,
    targetRmsDbfs: readEnginePrefs().acx_target_rms_dbfs,
  });
  if (!result.ok) {
    throw new Error(result.reason || "Mastering failed.");
  }
  return {
    ...project,
    chapters: project.chapters.map((item) => (item.id === chapterId ? { ...item, mastered: true } : item)),
  };
}

export async function exportBookPack(project: BookProject): Promise<BookProject> {
  if (!project.folder || !window.kosmosNext?.exportDelivery) {
    throw new Error("Export needs the desktop app.");
  }
  const result = await window.kosmosNext.exportDelivery({
    folder: project.folder,
    chapters: project.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      workingFile: chapter.workingFile,
      mastered: chapter.mastered,
      pickups: chapter.pickups,
    })),
  });
  if (!result.ok) {
    throw new Error(result.reason || "Export failed.");
  }
  return { ...project, completedAt: new Date().toISOString() };
}

export async function previewPunchRecording(
  project: BookProject,
  chapterId: string,
  pickup: ChapterPickup,
  wavBytes: Uint8Array,
): Promise<{ currentWavBase64: string; patchedWavBase64: string }> {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter?.originalFile || !project.folder || !window.kosmosNext?.previewPunch) {
    throw new Error("A before/after listen needs the desktop app and an original take.");
  }
  const bounds = pickupLineBounds(pickup);
  const result = await window.kosmosNext.previewPunch({
    folder: project.folder,
    originalFile: chapter.originalFile,
    workingFile: chapter.workingFile,
    tStart: bounds.start,
    tEnd: bounds.end,
    wavBase64: bytesToBase64(wavBytes),
  });
  if (!result.ok || !result.currentWavBase64 || !result.patchedWavBase64) {
    throw new Error(result.reason || "Could not build a before/after clip.");
  }
  return { currentWavBase64: result.currentWavBase64, patchedWavBase64: result.patchedWavBase64 };
}

function punchesFromResult(
  rows: Array<{
    id: string;
    chapter_id: string;
    pickup_id?: string;
    path: string;
    t_start: number;
    t_end: number;
    trim_silence?: boolean;
    edit_status?: string;
    expected?: string;
    heard?: string;
    created_at?: string;
    duration_delta?: number;
  }> | undefined,
  chapterId: string,
): ChapterPunch[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    chapter_id: row.chapter_id || chapterId,
    pickup_id: row.pickup_id,
    path: row.path,
    t_start: row.t_start,
    t_end: row.t_end,
    durationDelta: Number.isFinite(Number(row.duration_delta ?? (row as { durationDelta?: number }).durationDelta))
      ? Number(row.duration_delta ?? (row as { durationDelta?: number }).durationDelta)
      : undefined,
    trim_silence: row.trim_silence !== false,
    edit_status: row.edit_status === "reverted" ? "reverted" : "applied",
    expected: row.expected,
    heard: row.heard,
    created_at: row.created_at,
  }));
}
