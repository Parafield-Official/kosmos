import viteConfig from "../../vite.config";
import packageJson from "../../package.json";

describe("packaged renderer configuration", () => {
  it("uses relative assets so Electron can load the renderer through file://", () => {
    expect(typeof viteConfig).toBe("object");
    expect((viteConfig as { base?: string }).base).toBe("./");
  });

  it("packages the verified Whisper model for zero-setup speech checking", () => {
    expect(packageJson.scripts["package:mac"]).toContain("npm run prepare:model");
    expect(packageJson.scripts["package:win"]).toContain("npm run prepare:model");
    expect(packageJson.build.extraResources).toContainEqual({
      from: "vendor/models",
      to: "models",
      filter: ["ggml-small.en.bin"],
    });
  });
});
