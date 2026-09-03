const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { appPathForContext, isRetryableNetworkError, notarizeMacApp } = require("../scripts/notarize-macos.cjs");

function contextFor(appOutDir) {
  return {
    appOutDir,
    electronPlatformName: "darwin",
    packager: { appInfo: { productFilename: "Kosmos" } },
  };
}

describe("resilient macOS notarization", () => {
  it("uses the signed macOS app supplied by Electron Builder", () => {
    expect(appPathForContext(contextFor("/tmp/out"))).toBe("/tmp/out/Kosmos.app");
    expect(appPathForContext({ electronPlatformName: "win32" })).toBeNull();
  });

  it("recognizes the runner network failure seen in the v0.1.16 release", () => {
    expect(isRetryableNetworkError(new Error("NSURLErrorDomain Code=-1009: No network route"))).toBe(true);
    expect(isRetryableNetworkError(new Error("Apple rejected the submission"))).toBe(false);
  });

  it("submits once, then retries status checks using the same submission id", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-notarize-test-"));
    const appPath = path.join(directory, "Kosmos.app");
    const calls = [];
    const logs = [];
    let infoAttempt = 0;
    try {
      await fs.mkdir(appPath);
      await notarizeMacApp(contextFor(directory), {
        env: {
          APPLE_API_KEY: "/tmp/key.p8",
          APPLE_API_KEY_ID: "KEYID",
          APPLE_API_ISSUER: "ISSUER",
        },
        logger: (line) => logs.push(line),
        sleepFor: async () => undefined,
        pollIntervalMs: 1,
        timeoutMs: 1_000,
        run: async (command, args) => {
          calls.push([command, args]);
          if (command === "ditto") {
            return { stdout: "" };
          }
          if (args[0] === "notarytool" && args[1] === "submit") {
            return { stdout: JSON.stringify({ id: "submission-123", status: "In Progress" }) };
          }
          if (args[0] === "notarytool" && args[1] === "info") {
            infoAttempt += 1;
            if (infoAttempt === 1) {
              throw new Error("NSURLErrorDomain Code=-1009: No network route");
            }
            return { stdout: JSON.stringify({ id: "submission-123", status: "Accepted" }) };
          }
          if (args[0] === "stapler" && args[1] === "staple") {
            return { stdout: "" };
          }
          throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
        },
      });

      const submissions = calls.filter(([, args]) => args[0] === "notarytool" && args[1] === "submit");
      const infos = calls.filter(([, args]) => args[0] === "notarytool" && args[1] === "info");
      expect(submissions).toHaveLength(1);
      expect(infos).toHaveLength(2);
      expect(infos.every(([, args]) => args[2] === "submission-123")).toBe(true);
      expect(logs.join("\n")).toContain("temporary network error");
      expect(logs.join("\n")).toContain("submission submission-123: Accepted");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
