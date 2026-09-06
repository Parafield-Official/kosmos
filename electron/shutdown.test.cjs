const { createShutdownGuard } = require("./shutdown.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe("shutdown preserves pending work", () => {
  it("refuses shutdown during a write and freezes new work after approval", async () => {
    const write = deferred();
    const guard = createShutdownGuard({ askRenderer: async () => ({ ok: true }), releaseRenderer() {} });
    const job = guard.run(() => write.promise);
    expect((await guard.prepare()).ok).toBe(false);
    write.resolve();
    await job;
    expect((await guard.prepare()).ok).toBe(true);
    await expect(guard.run(async () => "new write")).rejects.toThrow(/closing/i);
  });

  it("keeps the app usable when the renderer reports unsaved work", async () => {
    const release = vi.fn();
    const guard = createShutdownGuard({
      askRenderer: async () => ({ ok: false, reason: "Stop and save your recording." }),
      releaseRenderer: release,
    });
    expect(await guard.prepare()).toEqual({ ok: false, reason: "Stop and save your recording." });
    expect(await guard.run(async () => 1)).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
