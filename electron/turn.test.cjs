const { sanitizeIceServers, mintIceServers } = require("./turn.cjs");

describe("cloudflare turn mint", () => {
  it("drops browser-blocked port 53 and keeps hotel ports", () => {
    const cleaned = sanitizeIceServers([
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:53?transport=udp",
          "turn:turn.cloudflare.com:80?transport=tcp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "short",
        credential: "lived",
      },
    ]);
    const urls = cleaned.flatMap((row) => row.urls);
    expect(urls.some((url) => url.includes(":53"))).toBe(false);
    expect(urls).toContain("turn:turn.cloudflare.com:80?transport=tcp");
    expect(urls).toContain("turns:turn.cloudflare.com:443?transport=tcp");
  });

  it("falls back to STUN when no locker secret is present", async () => {
    const minted = await mintIceServers({ secrets: null });
    expect(minted.turn).toBe(false);
    expect(minted.iceServers.some((row) => String(row.urls).includes("stun:"))).toBe(true);
  });

  it("mints from a locker response", async () => {
    const minted = await mintIceServers({
      secrets: { keyId: "abc", token: "def" },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          iceServers: [
            { urls: ["stun:stun.cloudflare.com:3478"] },
            {
              urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
              username: "u",
              credential: "c",
            },
          ],
        }),
      }),
    });
    expect(minted.turn).toBe(true);
    expect(minted.iceServers.some((row) => row.username === "u")).toBe(true);
  });
});
