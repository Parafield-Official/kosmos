const { CollabDesk } = require("./collab.cjs");
const { parseInvite, parseReply } = require("./p2p-protocol.cjs");

function desk() {
  return new CollabDesk({
    hooksFor: () => ({
      reviewPack: async () => ({ plan: { decisions: [], conflicts: [], empty: true }, summary: "ok" }),
      applyPack: async ({ project }) => ({ project, applied: {} }),
      readAlignment: async () => null,
      saveProject: async (folder, project) => ({ folder, project }),
      readChapterDocument: async () => ({ spans: [] }),
      validateIncomingProject: () => {},
    }),
  });
}

describe("collab desk invites", () => {
  it("mints a pasteable invite and a matching reply", () => {
    const live = desk();
    const snapshot = live.encodeInvite({
      project: { id: "book-1", name: "The Pier" },
      sdp: "v=0 host-offer",
    });
    expect(snapshot.phase).toBe("inviting");
    expect(snapshot.words.split(" ")).toHaveLength(3);
    expect(parseInvite(snapshot.invite).sdp).toBe("v=0 host-offer");

    const guest = desk();
    const decoded = guest.decodeInvite(snapshot.invite);
    expect(decoded.words).toBe(snapshot.words);
    const reply = guest.encodeReply({ sdp: "v=0 guest-answer" });
    const parsedReply = live.decodeReply(reply);
    expect(parsedReply.sdp).toBe("v=0 guest-answer");
    expect(parseReply("nope")).toBeNull();
  });

  it("rejects a reply meant for someone else", () => {
    const live = desk();
    live.encodeInvite({ project: { id: "book-1", name: "The Pier" }, sdp: "v=0" });
    const stranger = desk();
    stranger.encodeInvite({ project: { id: "book-1", name: "The Pier" }, sdp: "v=0" });
    const reply = stranger.encodeReply({ sdp: "v=0 other" });
    expect(() => live.decodeReply(reply)).toThrow(/different invite/);
  });

  it("lets the guest announce so the host learns their name", async () => {
    const live = desk();
    const guest = desk();
    live.encodeInvite({ project: { id: "book-1", name: "The Pier" }, sdp: "v=0" });
    guest.decodeInvite(live.invite);
    live.attach({
      folder: "/tmp/a",
      project: { id: "book-1", name: "The Pier", schema: 1, chapters: [] },
      identity: { name: "Alex", role: "author" },
      send: (text) => guest.inbound(text),
    });
    guest.attach({
      folder: "/tmp/b",
      project: { id: "book-1", name: "The Pier", schema: 1, chapters: [] },
      identity: { name: "Sam", role: "narrator" },
      send: (text) => live.inbound(text),
    });
    await guest.announce();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(live.snapshot().peer).toEqual({ name: "Sam", role: "narrator" });
  });

  it("refuses to attach an invite to a different open book", () => {
    const live = desk();
    live.encodeInvite({ project: { id: "book-1", name: "The Pier" }, sdp: "v=0" });
    expect(() => live.attach({
      folder: "/tmp/a",
      project: { id: "book-other", name: "Other", schema: 1, chapters: [] },
      identity: { name: "Alex", role: "author" },
      send: () => undefined,
    })).toThrow(/different book/);
  });
});
