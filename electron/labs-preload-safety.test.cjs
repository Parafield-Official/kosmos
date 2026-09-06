const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function harness(invoke = async () => ({ ok: true })) {
  const ipc = new EventEmitter();
  ipc.invoke = invoke;
  ipc.send = vi.fn();
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "labs-preload.cjs"), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: ipc,
      webUtils: { getPathForFile: () => "" },
    }),
    process: { platform: "darwin" },
    window: { addEventListener() {} },
    console,
  });
  const request = () => {
    ipc.emit("labs:shutdown-request", {}, "nonce");
    return ipc.send.mock.calls.at(-1)?.[2];
  };
  return { ipc, api, request };
}

describe("sandbox preload shutdown handshake", () => {
  it("blocks an unsaved recording and freezes saves only after approval", async () => {
    const { api, request, ipc } = harness();
    api.setUnsavedWork("recording:book:chapter", "Stop and save your recording.");
    expect(request()).toEqual({ ok: false, reason: "Stop and save your recording." });
    api.setUnsavedWork("recording:book:chapter", null);
    expect(request()).toEqual({ ok: true });
    await expect(api.saveProjectFile({ folder: "/book" })).rejects.toThrow(/closing/i);
    ipc.emit("labs:shutdown-release");
    expect(await api.saveProjectFile({ folder: "/book" })).toEqual({ ok: true });
  });

  it("remembers a failed save until a successful retry", async () => {
    const results = [{ ok: false }, { ok: true }];
    const { api, request } = harness(async () => results.shift());
    await api.saveProjectFile({ folder: "/book" });
    expect(request().ok).toBe(false);
    await api.saveProjectFile({ folder: "/book" });
    expect(request().ok).toBe(true);
  });

  it("does not count update installation itself as a pending save", async () => {
    let resolve;
    const { api, request } = harness(() => new Promise((done) => { resolve = done; }));
    const installing = api.installAppUpdate();
    expect(request()).toEqual({ ok: true });
    resolve({ installed: true });
    await installing;
  });
});
