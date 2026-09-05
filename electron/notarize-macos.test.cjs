const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  ARCHIVE_FILE_NAME,
  STATE_FILE_NAME,
  appPathForContext,
  submitMacApp,
} = require("../scripts/notarize-macos.cjs");
const {
  createToken,
  getSubmission,
  isRetryable,
  pollUntilComplete,
} = require("../scripts/wait-for-notarization.cjs");

function contextFor(appOutDir) {
  return {
    appOutDir,
    electronPlatformName: "darwin",
    packager: {
      appInfo: {
        productFilename: "Kosmos",
        version: "0.1.17",
      },
    },
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("asynchronous macOS notarization", () => {
  it("uses the signed macOS app supplied by Electron Builder", () => {
    expect(appPathForContext(contextFor("/tmp/out/mac-arm64"))).toBe("/tmp/out/mac-arm64/Kosmos.app");
    expect(appPathForContext({ electronPlatformName: "win32" })).toBeNull();
  });

  it("submits once and preserves the exact signed app plus non-secret state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-notarize-test-"));
    const appDirectory = path.join(root, "dist", "mac-arm64");
    const appPath = path.join(appDirectory, "Kosmos.app");
    const calls = [];
    try {
      await fs.mkdir(appPath, { recursive: true });
      await fs.mkdir(path.join(appPath, "Contents", "Resources"), { recursive: true });
      await fs.writeFile(path.join(appPath, "Contents", "Resources", "app-update.yml"), [
        "provider: generic",
        "url: https://parafield-official.github.io/kosmos/updates/",
        "updaterCacheDirName: booth-desk-updater",
        "",
      ].join("\n"));
      const state = await submitMacApp(contextFor(appDirectory), {
        env: {
          APPLE_API_KEY: "/private/key.p8",
          APPLE_API_KEY_ID: "KEYID",
          APPLE_API_ISSUER: "ISSUER",
          GITHUB_REF: "refs/tags/v0.1.17",
          GITHUB_REF_NAME: "v0.1.17",
          GITHUB_RUN_ID: "12345",
          GITHUB_SHA: "abc123",
        },
        createdAt: () => "2026-09-03T00:00:00.000Z",
        logger: () => undefined,
        run: async (command, args) => {
          calls.push([command, args]);
          if (command === "ditto") {
            await fs.writeFile(args.at(-1), "signed app archive");
            return { stdout: "" };
          }
          if (args[0] === "notarytool" && args[1] === "submit") {
            return { stdout: JSON.stringify({ id: "2e60c541-0f6b-4263-b71b-bb307acdca15" }) };
          }
          throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
        },
      });

      const stagingDirectory = path.join(root, "dist", "notarization");
      const savedState = JSON.parse(await fs.readFile(path.join(stagingDirectory, STATE_FILE_NAME), "utf8"));
      expect(await fs.readFile(path.join(stagingDirectory, ARCHIVE_FILE_NAME), "utf8")).toBe("signed app archive");
      expect(savedState).toEqual(state);
      expect(savedState).toMatchObject({
        submissionId: "2e60c541-0f6b-4263-b71b-bb307acdca15",
        sourceRunId: "12345",
        sourceSha: "abc123",
        version: "0.1.17",
      });
      expect(JSON.stringify(savedState)).not.toContain("/private/key.p8");
      expect(calls.filter(([, args]) => args[0] === "notarytool" && args[1] === "submit")).toHaveLength(1);
      expect(calls.some(([, args]) => args[0] === "notarytool" && args[1] === "info")).toBe(false);
      expect(calls.some(([, args]) => args[0] === "stapler")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to submit a macOS app that cannot download future updates", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-notarize-test-"));
    const appDirectory = path.join(root, "dist", "mac-arm64");
    const appPath = path.join(appDirectory, "Kosmos.app");
    const calls = [];
    try {
      await fs.mkdir(appPath, { recursive: true });
      await expect(submitMacApp(contextFor(appDirectory), {
        env: {
          APPLE_API_KEY: "/private/key.p8",
          APPLE_API_KEY_ID: "KEYID",
          APPLE_API_ISSUER: "ISSUER",
        },
        logger: () => undefined,
        run: async (command, args) => {
          calls.push([command, args]);
          return { stdout: JSON.stringify({ id: "unexpected-submission" }) };
        },
      })).rejects.toThrow(/app-update\.yml/i);
      expect(calls).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates a valid ES256 App Store Connect token without embedding the key", () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const token = createToken({
      keyId: "KEYID",
      issuerId: "ISSUER",
      privateKey,
      now: () => 1_800_000_000_000,
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: "KEYID", typ: "JWT" });
    expect(payload).toMatchObject({ iss: "ISSUER", aud: "appstoreconnect-v1" });
    expect(payload.exp - payload.iat).toBe(600);
    expect(Buffer.from(encodedSignature, "base64url")).toHaveLength(64);
    expect(token).not.toContain("PRIVATE KEY");
  });

  it("reads Apple's documented submission response", async () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const result = await getSubmission({
      submissionId: "2e60c541-0f6b-4263-b71b-bb307acdca15",
      credentials: { keyId: "KEYID", issuerId: "ISSUER", privateKey },
      fetchImpl: async () => jsonResponse({
        data: {
          attributes: {
            createdDate: "2026-09-03T00:00:00.000Z",
            name: "Kosmos-signed-app.zip",
            status: "Accepted",
          },
          id: "2e60c541-0f6b-4263-b71b-bb307acdca15",
          type: "submissions",
        },
      }),
    });
    expect(result.status).toBe("Accepted");
  });

  it("retries temporary status errors and keeps the same submission id", async () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const urls = [];
    const logs = [];
    let attempt = 0;
    const submissionId = "2e60c541-0f6b-4263-b71b-bb307acdca15";
    const result = await pollUntilComplete({
      submissionId,
      credentials: { keyId: "KEYID", issuerId: "ISSUER", privateKey },
      logger: (line) => logs.push(line),
      sleepFor: async () => undefined,
      pollIntervalMs: 1,
      timeoutMs: 1_000,
      fetchImpl: async (url) => {
        urls.push(url);
        attempt += 1;
        if (attempt === 1) {
          return jsonResponse({ errors: [{ status: "503" }] }, 503);
        }
        return jsonResponse({
          data: {
            attributes: { status: attempt === 2 ? "In Progress" : "Accepted" },
            id: submissionId,
            type: "submissions",
          },
        });
      },
    });

    expect(result.status).toBe("Accepted");
    expect(urls).toHaveLength(3);
    expect(urls.every((url) => url.endsWith(submissionId))).toBe(true);
    expect(logs.join("\n")).toContain("temporary error");
    expect(logs.join("\n")).toContain("Accepted");
    expect(isRetryable(Object.assign(new Error("service unavailable"), { statusCode: 503 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error("forbidden"), { statusCode: 403 }))).toBe(false);
  });
});
