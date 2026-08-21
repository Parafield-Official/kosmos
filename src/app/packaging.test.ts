import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import viteConfig from "../../vite.config";
import packageJson from "../../package.json";

describe("packaged renderer configuration", () => {
  it("uses relative assets so Electron can load the renderer through file://", () => {
    expect(typeof viteConfig).toBe("object");
    expect((viteConfig as { base?: string }).base).toBe("./");
  });

  it("packages the verified Whisper model and the live follow model for zero-setup speech checking", () => {
    expect(packageJson.scripts["package:mac"]).toContain("npm run prepare:model");
    expect(packageJson.scripts["package:win"]).toContain("npm run prepare:model");
    expect(packageJson.build.extraResources).toContainEqual({
      from: "vendor/models",
      to: "models",
      filter: ["ggml-small.en.bin", "realtime_eou_120m-v1-f16.gguf"],
    });
  });

  it("uses Kosmos as the installer and window product name", () => {
    expect(packageJson.build.productName).toBe("Kosmos");
    expect(packageJson.build.artifactName).toContain("Kosmos-");
  });

  it("signs the Mac app with microphone access so a hardened runtime can hear the booth", () => {
    const mac = packageJson.build.mac as { entitlements?: string; entitlementsInherit?: string };
    expect(mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(mac.entitlementsInherit).toBe("build/entitlements.mac.plist");
    const plist = readFileSync(resolve(__dirname, "../../build/entitlements.mac.plist"), "utf8");
    expect(plist).toContain("com.apple.security.device.audio-input");
  });
});
