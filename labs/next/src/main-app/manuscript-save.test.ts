import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceBookChapters, writeChapterContents, type BookProject } from "./store";

const project: BookProject = { id: "book", title: "Book", author: "Author", folder: "/books/book", chapters: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };

describe("saving an analyzed manuscript", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not publish chapter cards when saving their script files fails", async () => {
    const saveProjectFile = vi.fn();
    vi.stubGlobal("window", { kosmosNext: { writeChapterContents: vi.fn().mockResolvedValue({ ok: false }), saveProjectFile } });
    await expect(replaceBookChapters(project, [], [{ id: "new", html: "<p>Body</p>" }])).rejects.toThrow(/save|write/i);
    expect(saveProjectFile).not.toHaveBeenCalled();
  });

  it("writes all scripts before replacing the saved chapter list", async () => {
    const calls: string[] = [];
    vi.stubGlobal("window", { kosmosNext: {
      listProjects: vi.fn(), createProject: vi.fn(),
      writeChapterContents: async () => { calls.push("scripts"); return { ok: true }; },
      saveProjectFile: async (book: BookProject) => { calls.push("project"); return book; },
    } });
    await replaceBookChapters(project, [], []);
    expect(calls).toEqual(["scripts", "project"]);
  });

  it("surfaces hosted storage failures instead of reporting an empty import as saved", async () => {
    vi.stubGlobal("window", { localStorage: { setItem: () => { throw new Error("quota exceeded"); } } });
    await expect(writeChapterContents({ ...project, folder: undefined }, [{ id: "a", html: "<p>Text</p>" }])).rejects.toThrow(/quota|save/i);
  });
});
