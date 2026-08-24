import { describe, expect, it } from "vitest";
import { boothShortcutAction } from "./booth-controls";

describe("narrator booth shortcuts", () => {
  it.each([
    ["F7", "continue"],
    ["F8", "restart"],
    ["F9", "mark"],
    ["F10", "toggle-pause"],
  ] as const)("maps %s to %s while recording", (key, action) => {
    expect(boothShortcutAction({ key, recording: true, paused: false, halted: key === "F7" })).toBe(action);
  });

  it("only continues when the page is stopped", () => {
    expect(boothShortcutAction({ key: "F7", recording: true, paused: false, halted: false })).toBeNull();
  });

  it("does not restart or mark while paused", () => {
    expect(boothShortcutAction({ key: "F8", recording: true, paused: true, halted: false })).toBeNull();
    expect(boothShortcutAction({ key: "F9", recording: true, paused: true, halted: false })).toBeNull();
    expect(boothShortcutAction({ key: "F10", recording: true, paused: true, halted: false })).toBe("toggle-pause");
  });

  it("ignores key repeat, editable controls, and keys outside a recording", () => {
    expect(boothShortcutAction({ key: "F8", recording: true, paused: false, halted: false, repeat: true })).toBeNull();
    expect(boothShortcutAction({ key: "F8", recording: true, paused: false, halted: false, editing: true })).toBeNull();
    expect(boothShortcutAction({ key: "F8", recording: false, paused: false, halted: false })).toBeNull();
  });
});
