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

  it("rejects unsafe project keys before writing the local identity map", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "booth-identity-test-"));
    try {
      await expect(saveIdentity(userData, {
        projectId: "__proto__",
        personName: "Someone",
        role: "author",
      })).rejects.toThrow(/project id/i);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it("serializes concurrent writes so identities for two projects are not lost", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "booth-identity-test-"));
    try {
      await Promise.all([
        saveIdentity(userData, { projectId: "project-a", personName: "Author", role: "author" }),
        saveIdentity(userData, { projectId: "project-b", personName: "Narrator", role: "narrator", seat: "N2" }),
      ]);
      await expect(loadIdentity(userData, "project-a")).resolves.toMatchObject({ personName: "Author" });
      await expect(loadIdentity(userData, "project-b")).resolves.toMatchObject({ personName: "Narrator", seat: "N2" });
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it("recovers from a malformed local identity cache when saving a new identity", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "booth-identity-test-"));
    try {
      await fs.writeFile(path.join(userData, "identities.json"), "not json");
      await saveIdentity(userData, { projectId: "project-1", personName: "Alex", role: "author" });
      await expect(loadIdentity(userData, "project-1")).resolves.toMatchObject({ personName: "Alex" });
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });
});
