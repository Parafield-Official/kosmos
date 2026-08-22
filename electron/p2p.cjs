const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  MAX_CHUNK_BYTES,
  createInvite,
  createSecret,
  fingerprintWords,
  parseFrame,
  parseInvite,
} = require("./p2p-protocol.cjs");

/**
 * Live collaboration sessions.
 *
 * A session is two Kosmos apps keeping one book in step. The transport is
 * abstracted behind a `host` (WebRTC in the app; an in-memory loopback for
 * tests), and every payload is the same snapshot a zip pack used to carry:
 * project.json, scripts, alignments, audio. The receiving side stages the
 * snapshot to disk and hands it to reviewPack/applyPack, so the pack-merge
 * rules — dismissed stays dismissed, disagreements surface — stay the single
 * authority. The wire adds nothing the pack path does not already enforce.
 */

const SNAPSHOT_EXCLUDE = new Set([".git", ".ci-runtime", "export"]);

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Collect snapshot-worthy files under a project folder, POSIX-relative. */
async function collectSnapshotFiles(folder) {
  const files = [];
  async function walk(current) {
    const directory = path.join(folder, current);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relative = current ? `${current}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        const top = relative.split("/")[0];
        if (current === "" && SNAPSHOT_EXCLUDE.has(top)) {
          continue;
        }
        await walk(relative);
      } else if (entry.isFile()) {
        const stat = await fs.stat(path.join(folder, ...relative.split("/")));
        files.push({ path: relative, size: stat.size });
      }
    }
  }
  await walk("");
  return files;
}

async function copyTree(from, to) {
  const entries = await collectSnapshotFiles(from);
  for (const entry of entries) {
    const source = path.join(from, ...entry.path.split("/"));
    const destination = path.join(to, ...entry.path.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

/**
 * In-memory loopback host. Production swaps this for a WebRTC host with the
 * same four verbs; every test runs against both shapes.
 */
class MemoryHost extends EventEmitter {
  constructor() {
    super();
    this.links = new Map();
  }

  /** Wire two hosts together, optionally lossy per direction. */
  link(other) {
    this.links.set(other, true);
    other.links.set(this, true);
  }

  unlink(other) {
    this.links.delete(other);
    other?.links.delete(this);
  }

  send(text) {
    for (const [peer] of this.links) {
      peer.emit("message", text);
    }
  }

  close() {
    this.links.clear();
  }
}

class PeerSession {
  /**
   * @param {object} options
   * @param {string} options.folder       local project folder on disk
   * @param {object} options.project      parsed project.json
   * @param {object} options.hooks        the same hooks object pack-import uses
   * @param {object} options.host         send/close host (MemoryHost now)
   * @param {{name: string, role: string}} options.identity
   */
  constructor({ folder, project, hooks, host, identity }) {
    this.folder = folder;
    this.project = project;
    this.hooks = hooks;
    this.host = host;
    this.identity = identity;
    this.stagingRoot = null;
    this.incomingFiles = new Map();
    this.openTransfers = new Map();
    this.appliedSummary = null;

    host.on("message", (text) => {
      void this.handleMessage(text).catch(() => {
        this.sendFrame({ type: "error", message: "That message could not be read." });
      });
    });
  }

  get projectId() {
    return this.project.id;
  }

  sendFrame(frame) {
    return this.host.send(JSON.stringify(frame));
  }

  start() {
    void this.sendFrame({
      type: "hello",
      name: this.identity.name,
      role: this.identity.role,
      projectId: this.projectId,
    });
    return this.sendManifest();
  }

  async sendManifest() {
    const files = [];
    for (const entry of await collectSnapshotFiles(this.folder)) {
      const buffer = await fs.readFile(path.join(this.folder, ...entry.path.split("/")));
      files.push({ ...entry, sha256: sha256Hex(buffer) });
    }
    await this.sendFrame({
      type: "snapshot-manifest",
      project: this.project,
      files,
    });
    return files.length;
  }

  /** Serve everything the peer says it lacks. */
  async handleNeed(frame) {
    for (const relativePath of frame.paths) {
      const absolute = path.join(this.folder, ...relativePath.split("/"));
      const content = await fs.readFile(absolute);
      const total = Math.ceil(content.length / MAX_CHUNK_BYTES);
      for (let index = 0; index < total; index += 1) {
        const slice = content.subarray(index * MAX_CHUNK_BYTES, (index + 1) * MAX_CHUNK_BYTES);
        await this.sendFrame({ type: "chunk", path: relativePath, index, total, data: slice.toString("base64") });
      }
    }
    await this.sendFrame({ type: "snapshot-done" });
  }

  async stageChunk(frame) {
    const manifestEntry = this.incomingFiles.get(frame.path);
    if (!manifestEntry) {
      throw new Error("Chunk arrived for a file that was never offered");
    }
    let transfer = this.openTransfers.get(frame.path);
    if (!transfer) {
      transfer = { chunks: new Map(), received: 0 };
      this.openTransfers.set(frame.path, transfer);
    }
    if (!transfer.chunks.has(frame.index)) {
      transfer.chunks.set(frame.index, Buffer.from(frame.data, "base64"));
      transfer.received += transfer.chunks.get(frame.index).length;
    }
    if (transfer.received < manifestEntry.size) {
      return false;
    }
    const ordered = [...transfer.chunks.keys()].sort((a, b) => a - b)
      .map((index) => transfer.chunks.get(index));
    const assembled = Buffer.concat(ordered);
    if (assembled.length !== manifestEntry.size || sha256Hex(assembled) !== manifestEntry.sha256) {
      this.openTransfers.delete(frame.path);
      throw new Error(`Checksum failed for ${frame.path}`);
    }
    const destination = path.join(this.stagingRoot, ...frame.path.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, assembled);
    this.openTransfers.delete(frame.path);
    return true;
  }

  /** Copy a file we already have into the incoming staging tree. */
  async stageLocalCopy(relativePath) {
    if (!this.stagingRoot) {
      return;
    }
    const source = path.join(this.folder, ...relativePath.split("/"));
    const destination = path.join(this.stagingRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }

  /** Ignore late duplicates of a file that already landed. */
  isAlreadyStaged(relativePath) {
    return Boolean(
      this.stagingRoot
      && fsSync.existsSync(path.join(this.stagingRoot, ...relativePath.split("/"))),
    );
  }

  async handleMessage(text) {
    const frame = parseFrame(text);
    if (!frame) {
      return;
    }
    switch (frame.type) {
      case "hello":
        this.peerHello = frame;
        return;
      case "snapshot-manifest": {
        if (this.applyingManifest) {
          return;
        }
        this.applyingManifest = true;
        try {
          // A fresh manifest resets any half-finished staging.
          await this.resetStaging();
          this.finalized = false;
          this.incomingProject = frame.project;
          this.incomingFiles = new Map(frame.files.map((entry) => [entry.path, entry]));
          const needed = [];
          for (const entry of frame.files) {
            const localPath = path.join(this.folder, ...entry.path.split("/"));
            try {
              const local = await fs.readFile(localPath);
              if (sha256Hex(local) !== entry.sha256) {
                needed.push(entry.path);
              } else {
                // Already here and identical: copy into staging so review can
                // read the incoming tree even when we skip the bytes on the wire.
                await this.stageLocalCopy(entry.path);
              }
            } catch {
              needed.push(entry.path);
            }
          }
          await this.sendFrame({ type: "need", paths: needed });
          if (needed.length === 0) {
            this.finalized = true;
            await this.finalizeIncoming();
          }
        } finally {
          this.applyingManifest = false;
        }
        return;
      }
      case "need":
        await this.handleNeed(frame);
        return;
      case "chunk": {
        // After finalize we no longer accept chunks: this manifest is done.
        if (this.finalized || !this.incomingFiles.size) {
          return;
        }
        if (this.isAlreadyStaged(frame.path)) {
          return;
        }
        const complete = await this.stageChunk(frame);
        if (complete && !this.finalized && this.allStaged()) {
          this.finalized = true;
          await this.finalizeIncoming();
          await this.sendFrame({
            type: "applied",
            summary: this.appliedSummary ?? {},
          });
        }
        return;
      }
      case "snapshot-done":
        if (!this.finalized && this.allStaged()) {
          this.finalized = true;
          await this.finalizeIncoming();
          await this.sendFrame({
            type: "applied",
            summary: this.appliedSummary ?? {},
          });
        }
        return;
      case "applied":
        return;
      case "error":
        return;
      default:
        return;
    }
  }

  allStaged() {
    if (this.stagingRoot === null) {
      return false;
    }
    for (const [relativePath] of this.incomingFiles) {
      if (this.openTransfers.has(relativePath)) {
        return false;
      }
      if (!fsSync.existsSync(path.join(this.stagingRoot, ...relativePath.split("/")))) {
        return false;
      }
    }
    return true;
  }

  async resetStaging() {
    if (this.stagingRoot) {
      await fs.rm(this.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    this.stagingRoot = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "kosmos-collab-"));
    this.openTransfers = new Map();
  }

  /** Stage-complete: first-join copies the book; later rounds use pack merge. */
  async finalizeIncoming() {
    if (!this.stagingRoot || !this.incomingProject) {
      return;
    }
    await fs.writeFile(
      path.join(this.stagingRoot, "project.json"),
      JSON.stringify(this.incomingProject),
      "utf8",
    );
    if (this.isFirstJoin()) {
      await this.materializeSnapshot();
      return;
    }
    const review = await this.hooks.reviewPack({
      folder: this.folder,
      project: this.project,
      stagingPath: this.stagingRoot,
      hooks: this.hooks,
    });
    this.lastReview = review;
    if ((review.plan.conflicts?.length ?? 0) > 0) {
      // A person already decided something different: hold, do not overwrite.
      this.awaitingDecision = review;
      return;
    }
    await this.applyStaged();
  }

  isFirstJoin() {
    const localChapters = this.project?.chapters ?? [];
    const incomingChapters = this.incomingProject?.chapters ?? [];
    if (incomingChapters.length === 0) {
      return false;
    }
    const localIds = new Set(localChapters.map((chapter) => chapter.id));
    return incomingChapters.every((chapter) => !localIds.has(chapter.id));
  }

  /** Empty local book: take the incoming tree as-is. */
  async materializeSnapshot() {
    await copyTree(this.stagingRoot, this.folder);
    const saved = await this.hooks.saveProject(this.folder, this.incomingProject);
    this.project = saved.project;
    this.appliedSummary = { firstJoin: true };
    this.lastReview = {
      plan: { decisions: [], conflicts: [], empty: false },
      summary: "Book arrived.",
    };
    await fs.rm(this.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    this.stagingRoot = null;
    this.incomingFiles = new Map();
  }

  async applyStaged() {
    if (!this.stagingRoot) {
      return null;
    }
    const result = await this.hooks.applyPack({
      folder: this.folder,
      project: this.project,
      stagingPath: this.stagingRoot,
      hooks: this.hooks,
    });
    this.project = result.project;
    this.appliedSummary = result.applied ?? {};
    await fs.rm(this.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    this.stagingRoot = null;
    this.incomingFiles = new Map();
    return result;
  }

  dispose() {
    this.host.close();
    if (this.stagingRoot) {
      try {
        fsSync.rmSync(this.stagingRoot, { recursive: true, force: true });
      } catch {
        // Best effort: a leftover temp dir is harmless.
      }
      this.stagingRoot = null;
    }
  }
}

/** Create an invite code for a project (the narrator's side). */
function buildInvite(project) {
  const secret = createSecret();
  return {
    invite: createInvite({ projectId: project.id, projectName: project.name, secret }),
    words: fingerprintWords(secret),
    secret,
  };
}

module.exports = {
  MemoryHost,
  PeerSession,
  SNAPSHOT_EXCLUDE,
  buildInvite,
  collectSnapshotFiles,
  sha256Hex,
};
