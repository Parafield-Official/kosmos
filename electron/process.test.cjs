const processModule = require("node:process");
const { activeCommandCount, runCommand, terminateActiveCommands } = require("./process.cjs");

describe("local process boundary", () => {
  it("returns stdout from a successful helper", async () => {
    await expect(runCommand(processModule.execPath, ["-e", "process.stdout.write('ok')"], { timeoutMs: 1000 }))
      .resolves.toEqual(Buffer.from("ok"));
  });

  it("kills a helper that exceeds its timeout", async () => {
    await expect(runCommand(processModule.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 40 }))
      .rejects.toThrow(/timed out/i);
  });

  it("bounds helper output before it can exhaust the desktop process", async () => {
    await expect(runCommand(
      processModule.execPath,
      ["-e", "process.stdout.write('x'.repeat(4096))"],
      { timeoutMs: 1000, maxOutputBytes: 128 },
    )).rejects.toThrow(/output exceeded/i);
  });

  it("tracks and terminates active helpers during app shutdown", async () => {
    const command = runCommand(
      processModule.execPath,
      ["-e", "setTimeout(() => {}, 5000)"],
      { timeoutMs: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeCommandCount()).toBe(1);

    terminateActiveCommands({ force: true });
    await expect(command).rejects.toThrow(/exited|SIGKILL/i);
    expect(activeCommandCount()).toBe(0);
  });
});
