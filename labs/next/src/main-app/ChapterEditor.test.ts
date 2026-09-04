import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterEditor } from "./ChapterEditor";
import type { BookProject } from "./store";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const project: BookProject = {
  id: "bk_windows",
  title: "Northwind",
  author: "Ada",
  folder: "C:\\Kosmos\\Northwind",
  manuscript: "northwind.docx",
  chapters: [{
    id: "ch01",
    title: "Chapter 1",
    wordCount: 1,
    recordedPct: 0,
    hasOriginalAudio: false,
    hasWorkingAudio: false,
    hasMasteredAudio: false,
    resumeWordIndex: 0,
    proofed: false,
    mastered: false,
  }],
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
};

describe("ChapterEditor persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores an edit after an immediate app close cancels the debounce", async () => {
    vi.useFakeTimers();
    let diskHtml = "<p>Original</p>";
    const writeChapterContent = vi.fn(async (payload: { html: string }) => {
      diskHtml = payload.html;
      return { ok: true };
    });
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      kosmosNext: {
        readChapterContent: vi.fn(async () => ({ ok: true, html: diskHtml })),
        writeChapterContent,
      },
    });
    vi.stubGlobal("document", {
      createElement: () => {
        let html = "";
        return {
          get innerHTML() {
            return html;
          },
          set innerHTML(value: string) {
            html = value;
          },
          querySelector: () => null,
        };
      },
    });
    const editorNode = { innerHTML: "" };
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(ChapterEditor, {
          project,
          chapterId: "ch01",
          onBack: () => undefined,
          onChange: () => undefined,
        }),
        {
          createNodeMock: (element) =>
            (element.props as { className?: string }).className === "ma-prose ma-prose-edit" ? editorNode : null,
        },
      );
      await Promise.resolve();
    });

    editorNode.innerHTML = "<p>Edited spacing</p>";
    act(() => {
      renderer!.root.findByProps({ className: "ma-prose ma-prose-edit" }).props.onInput();
      renderer!.unmount();
    });

    const reopenedEditorNode = { innerHTML: "" };
    await act(async () => {
      renderer = create(
        createElement(ChapterEditor, {
          project,
          chapterId: "ch01",
          onBack: () => undefined,
          onChange: () => undefined,
        }),
        {
          createNodeMock: (element) =>
            (element.props as { className?: string }).className === "ma-prose ma-prose-edit"
              ? reopenedEditorNode
              : null,
        },
      );
      await Promise.resolve();
    });

    expect(reopenedEditorNode.innerHTML).toBe("<p>Edited spacing</p>");
    expect(diskHtml).toBe("<p>Edited spacing</p>");
    renderer!.unmount();
  });
});
