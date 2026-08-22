const { EventEmitter } = require("node:events");
const {
  createInvite,
  createReply,
  createSecret,
  fingerprintWords,
  parseInvite,
  parseReply,
} = require("./p2p-protocol.cjs");
const { PeerSession } = require("./p2p.cjs");

/**
 * One live collaboration seat in the desktop app.
 *
 * The renderer owns the WebRTC socket. This desk owns the book: it turns
 * inbound frames into pack-merge, and pushes outbound frames back to the
 * renderer to put on the wire. No zip file is involved.
 */
class IpcHost extends EventEmitter {
  constructor(send) {
    super();
    this._send = send;
  }

  send(text) {
    return this._send(text);
  }

  close() {
    this._send = () => undefined;
  }
}

class CollabDesk {
  constructor({ hooksFor }) {
    this.hooksFor = hooksFor;
    this.reset();
  }

  reset() {
    this.session?.dispose();
    this.session = null;
    this.host = null;
    this.phase = "idle";
    this.invite = null;
    this.words = null;
    this.secret = null;
    this.expectedProjectId = null;
    this.peer = null;
    this.lastReview = null;
    this.error = null;
    this.folder = null;
    this.project = null;
    this.identity = null;
  }

  snapshot() {
    return {
      phase: this.phase,
      invite: this.invite,
      words: this.words,
      peer: this.peer,
      lastReview: this.lastReview,
      error: this.error,
      project: this.session?.project ?? this.project,
      folder: this.folder,
      projectUpdated: false,
    };
  }

  encodeInvite({ project, sdp }) {
    if (!project?.id || !project?.name) {
      throw new Error("Open a book before inviting someone");
    }
    this.secret = createSecret();
    this.expectedProjectId = project.id;
    this.words = fingerprintWords(this.secret);
    this.invite = createInvite({
      projectId: project.id,
      projectName: project.name,
      secret: this.secret,
      sdp,
    });
    this.phase = "inviting";
    this.error = null;
    return this.snapshot();
  }

  decodeInvite(text) {
    const parsed = parseInvite(text);
    if (!parsed) {
      throw new Error("That does not look like a Kosmos invite");
    }
    this.secret = parsed.secret;
    this.expectedProjectId = parsed.projectId;
    this.words = fingerprintWords(parsed.secret);
    this.phase = "joining";
    this.error = null;
    return { ...parsed, words: this.words };
  }

  encodeReply({ sdp }) {
    if (!this.secret) {
      throw new Error("Paste an invite first");
    }
    return createReply({ secret: this.secret, sdp });
  }

  decodeReply(text) {
    const parsed = parseReply(text);
    if (!parsed) {
      throw new Error("That does not look like a Kosmos reply");
    }
    if (this.secret && parsed.secret !== this.secret) {
      throw new Error("That reply is for a different invite");
    }
    return parsed;
  }

  attach({ folder, project, identity, send }) {
    if (!folder || !project || !identity?.name || !identity?.role) {
      throw new Error("Save your name and role before connecting");
    }
    if (this.expectedProjectId && project.id !== this.expectedProjectId) {
      throw new Error("That invite is for a different book.");
    }
    this.resetKeepInvite();
    this.folder = folder;
    this.project = project;
    this.identity = identity;
    this.host = new IpcHost(send);
    this.session = new PeerSession({
      folder,
      project,
      hooks: this.hooksFor(),
      host: this.host,
      identity,
    });
    this.phase = "attached";
    return this.snapshot();
  }

  resetKeepInvite() {
    this.session?.dispose();
    this.session = null;
    this.host = null;
    this.lastReview = null;
    this.error = null;
    this.peer = null;
  }

  inbound(text) {
    if (!this.session) {
      throw new Error("No live session is open");
    }
    return this.session.handleMessage(text).then(() => {
      const projectUpdated = Boolean(this.session.projectUpdated);
      if (projectUpdated) {
        this.session.projectUpdated = false;
      }
      this.lastReview = this.session.lastReview ?? this.lastReview;
      if (this.session.peerHello) {
        this.peer = {
          name: this.session.peerHello.name,
          role: this.session.peerHello.role,
        };
      }
      if (this.session.project) {
        this.project = this.session.project;
      }
      if (this.session.peerHello || projectUpdated) {
        this.phase = "connected";
      }
      return { ...this.snapshot(), projectUpdated };
    });
  }

  announce() {
    if (!this.session) {
      throw new Error("No live session is open");
    }
    return Promise.resolve(this.session.announce()).then(() => this.snapshot());
  }

  start() {
    if (!this.session) {
      throw new Error("No live session is open");
    }
    this.phase = "connected";
    return this.session.start().then(() => this.snapshot());
  }

  disconnect() {
    this.reset();
    return this.snapshot();
  }
}

module.exports = { CollabDesk, IpcHost };
