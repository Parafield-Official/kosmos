import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./collab-link.ts"), "utf8");

describe("live collab ICE", () => {
  it("keeps public STUN and accepts minted locker servers", () => {
    expect(source).toContain("stun:stun.l.google.com:19302");
    expect(source).toContain("stun:stun.cloudflare.com:3478");
    expect(source).toContain("iceTransportPolicy stays \"all\"");
    expect(source).toContain("createHostOffer(iceServers: RTCIceServer[] = ICE_SERVERS)");
  });

  it("does not bake the dead Open Relay login or the long-lived Cloudflare token", () => {
    expect(source).not.toContain("openrelayproject");
    expect(source).not.toContain("turn:openrelay.metered.ca");
    expect(source).not.toContain("c7d66fa653fcab13bf7539044735ddef8ea08972fedf102e821e95412eafee4a");
  });
});
