const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadIdentity, saveIdentity } = require("./identity.cjs");

describe("local collaborator identity", () => {
  it("remembers who I am in app data, outside the shared project", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "booth-identity-test-"));
    try {
      await saveIdentity(userData, {
        projectId: "project-1",
        personName: "Nia Voice",
        role: "narrator",
        seat: "N1",
      });

      await expect(loadIdentity(userData, "project-1")).resolves.toEqual({
        projectId: "project-1",
        personName: "Nia Voice",
        role: "narrator",
        seat: "N1",
      });
      await expect(loadIdentity(userData, "another-project")).resolves.toBeNull();
      expect(await fs.readdir(userData)).toEqual(["identities.json"]);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it("rejects an identity with an unknown role", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "booth-identity-test-"));
    try {
      await expect(saveIdentity(userData, {
        projectId: "project-1",
        personName: "Someone",
        role: "admin",
      })).rejects.toThrow(/author or narrator/i);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });
});
