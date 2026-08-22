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
});
