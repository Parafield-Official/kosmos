import { afterEach, expect, it, vi } from "vitest";
import { getProject, saveProject, type BookProject } from "./store";
import { exportBookPack } from "./punch";

afterEach(() => vi.unstubAllGlobals());
it("preserves selections on reopen and enforces ACX in the renderer request", async () => {
  const values = new Map<string, string>();
  const exportDelivery = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, kosmosNext: { exportDelivery } });
  const project: BookProject = { id: "book", title: "Book", author: "Author", chapters: [], folder: "/book", createdAt: "", updatedAt: "",
    acxSubmission: { skipCredits: false, skipRetailSample: false, openingChapterId: "open", closingChapterId: "close", retailChapterId: "later", retailStartSeconds: 12, retailDurationSeconds: 90 } };
  saveProject(project);
  const reopened = getProject(project.id)!;
  expect(reopened.acxSubmission).toEqual(project.acxSubmission);
  values.set("kosmos-labs-engine-prefs", JSON.stringify({ spec_preset_id: "ebu-r128" }));
  await exportBookPack(reopened, "acx", true);
  expect(exportDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ presetId: "acx", mode: "acx", acxSubmission: { ...project.acxSubmission, reviewed: true } }));
  await exportBookPack(reopened, "handoff");
  expect(exportDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ presetId: "ebu-r128", mode: "handoff" }));
});

it("keeps skip choices after reopening and does not mark partial exports complete", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, kosmosNext: { exportDelivery: async () => ({ ok: true }) } });
  const project: BookProject = { id: "partial", title: "Book", author: "Author", chapters: [], folder: "/book", createdAt: "", updatedAt: "", completedAt: "old",
    acxSubmission: { skipCredits: true, skipRetailSample: true, openingChapterId: "", closingChapterId: "", retailChapterId: "", retailStartSeconds: 0, retailDurationSeconds: 60 } };
  saveProject(project);
  const reopened = getProject(project.id)!;
  expect(reopened.acxSubmission).toEqual(project.acxSubmission);
  expect((await exportBookPack(reopened, "acx", true)).completedAt).toBeUndefined();
});
