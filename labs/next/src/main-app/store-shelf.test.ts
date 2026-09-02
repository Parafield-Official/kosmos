import { afterEach, describe, expect, it, vi } from "vitest";
import { manuscriptSourcePath, shelfIdentity, type BookProject } from "./store";

function book(partial: Partial<BookProject> = {}): BookProject {
  return {
    id: "bk_1",
    title: "Northwind",
    author: "Ada",
    chapters: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("shelfIdentity", () => {
  it("stays stable across chapter edits so the 3D shelf does not remount", () => {
    const first = shelfIdentity([book()], "/ws");
    const afterSave = shelfIdentity([book({ updatedAt: "2026-09-02T00:00:00.000Z" })], "/ws");
    expect(afterSave).toBe(first);
  });

  it("changes when a book is added or removed", () => {
    expect(shelfIdentity([book()], "/ws")).not.toBe(shelfIdentity([], "/ws"));
  });
});

describe("manuscriptSourcePath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers Electron's getPathForFile so the main process can move the file", () => {
    vi.stubGlobal("window", {
      kosmosNext: {
        getPathForFile: () => "/Users/ada/Drafts/northwind.docx",
      },
    });
    const file = new File(["hi"], "northwind.docx");
    expect(manuscriptSourcePath(file)).toBe("/Users/ada/Drafts/northwind.docx");
  });

  it("falls back to File.path when getPathForFile is missing", () => {
    vi.stubGlobal("window", { kosmosNext: {} });
    const file = new File(["hi"], "northwind.docx") as File & { path?: string };
    file.path = "/tmp/northwind.docx";
    expect(manuscriptSourcePath(file)).toBe("/tmp/northwind.docx");
  });

  it("returns undefined so the caller can copy when no disk path exists", () => {
    vi.stubGlobal("window", { kosmosNext: {} });
    expect(manuscriptSourcePath(new File(["hi"], "northwind.docx"))).toBeUndefined();
  });
});
