const {
  INVITE_PREFIX,
  REPLY_PREFIX,
  MAX_CHUNK_BYTES,
  createInvite,
  createReply,
  createSecret,
  fingerprintWords,
  parseFrame,
  parseInvite,
  parseReply,
} = require("./p2p-protocol.cjs");

describe("collab invites", () => {
  it("round-trips an invite through any paste", () => {
    const secret = createSecret();
    const invite = createInvite({ projectId: "book-1", projectName: "The Pier", secret });
    expect(invite.startsWith(INVITE_PREFIX)).toBe(true);

    const parsed = parseInvite(invite);
    expect(parsed).toEqual({ projectId: "book-1", projectName: "The Pier", secret });

    // Survives the whitespace a chat app adds around a pasted link.
    expect(parseInvite(`  ${invite}\n`)).toEqual(parsed);
  });

  it("carries a connection offer and a reply in pasteable codes", () => {
    const secret = createSecret();
    const invite = createInvite({
      projectId: "book-1",
      projectName: "The Pier",
      secret,
      sdp: "v=0 offer-line",
    });
    expect(parseInvite(invite)).toMatchObject({ secret, sdp: "v=0 offer-line" });
    const reply = createReply({ secret, sdp: "v=0 answer-line" });
    expect(reply.startsWith(REPLY_PREFIX)).toBe(true);
    expect(parseReply(reply)).toEqual({ secret, sdp: "v=0 answer-line" });
    expect(parseReply("junk")).toBeNull();
  });

  it("rejects junk, tampering, and wrong books without throwing", () => {
    expect(parseInvite("")).toBeNull();
    expect(parseInvite("not an invite")).toBeNull();
    expect(parseInvite(`${INVITE_PREFIX}-!!!not-base64url!!!`)).toBeNull();

    const invite = createInvite({ projectId: "book-1", projectName: "The Pier", secret: createSecret() });
    const flipped = `${invite.slice(0, -2)}aa`;
    const parsed = parseInvite(flipped);
    if (parsed !== null) {
      // A flip that still parses must never restore the original secret.
      expect(parsed.secret).not.toHaveLength(48);
    }
    expect(parseInvite(null)).toBeNull();
  });

  it("derives stable spoken verification words from the secret", () => {
    const secret = createSecret();
    const words = fingerprintWords(secret);
    expect(words.split(" ")).toHaveLength(3);
    expect(words).toBe(fingerprintWords(secret));
    expect(words).not.toBe(fingerprintWords(createSecret()));
    expect(() => fingerprintWords("short")).toThrow();
  });
});

describe("wire frames", () => {
  it("accepts the frames a sync session speaks", () => {
    expect(parseFrame(JSON.stringify({ type: "hello", name: "Alex", role: "author" })))
      .toMatchObject({ type: "hello" });
    expect(parseFrame(JSON.stringify({
      type: "snapshot-manifest",
      project: { id: "book-1" },
      files: [{ path: "audio/01.wav", sha256: "a".repeat(64), size: 10 }],
    }))).toMatchObject({ type: "snapshot-manifest" });
    expect(parseFrame(JSON.stringify({ type: "need", paths: ["audio/01.wav"] })))
      .toMatchObject({ type: "need" });
    expect(parseFrame(JSON.stringify({
      type: "chunk",
      path: "audio/01.wav",
      index: 0,
      data: "x".repeat(64),
    }))).toMatchObject({ type: "chunk" });
    expect(parseFrame(JSON.stringify({ type: "snapshot-done" }))).toMatchObject({ type: "snapshot-done" });
  });

  it("rejects malformed or hostile frames", () => {
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "hello", name: "", role: "author" }))).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "hello", name: "x", role: "wizard" }))).toBeNull();
    expect(parseFrame(JSON.stringify({
      type: "snapshot-manifest",
      project: {},
      files: [{ path: "../escape.wav", sha256: "a".repeat(64), size: 1 }],
    }))).toBeNull();
    expect(parseFrame(JSON.stringify({
      type: "snapshot-manifest",
      project: {},
      files: [{ path: "ok.wav", sha256: "zz", size: 1 }],
    }))).toBeNull();

    const oversized = "x".repeat(MAX_CHUNK_BYTES * 2);
    expect(parseFrame(JSON.stringify({ type: "chunk", path: "a.bin", index: 0, data: oversized }))).toBeNull();
  });
});
