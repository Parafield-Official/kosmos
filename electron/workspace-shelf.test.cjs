const path = require("node:path");
const { collectShelfWatchTargets, shelfIdentity } = require("./workspace-shelf.cjs");

describe("collectShelfWatchTargets", () => {
  it("watches the workspace, each child folder, and linked externals", () => {
    const workspace = path.resolve("/tmp/kosmos-workspace");
    const targets = collectShelfWatchTargets(workspace, ["First Book", "scratch"], [
      "/tmp/outside/linked",
      path.join(workspace, "scratch"),
    ]);
    expect(targets).toEqual([
      workspace,
      path.join(workspace, "First Book"),
      path.join(workspace, "scratch"),
      path.resolve("/tmp/outside/linked"),
    ]);
  });

  it("ignores nested or empty child names so audio folders stay unwatched", () => {
    const workspace = path.resolve("/tmp/kosmos-workspace");
    expect(collectShelfWatchTargets(workspace, ["", "..", "audio/take.wav", "Good"], [])).toEqual([
      workspace,
      path.join(workspace, "Good"),
    ]);
  });
});

describe("shelfIdentity", () => {
  it("changes when a book appears, moves, or is removed", () => {
    const empty = shelfIdentity([], "/ws");
    const one = shelfIdentity([{ id: "a", folder: "/ws/A", title: "A", author: "Ada" }], "/ws");
    const gone = shelfIdentity([], "/ws");
    const renamed = shelfIdentity([{ id: "a", folder: "/ws/B", title: "A", author: "Ada" }], "/ws");
    expect(one).not.toBe(empty);
    expect(gone).toBe(empty);
    expect(renamed).not.toBe(one);
  });
});
