const {
  assertTrustedWindowEvent,
  isTrustedWindowEvent,
} = require("./ipc-security.cjs");

function windowWith(id) {
  return {
    isDestroyed: () => false,
    webContents: { id },
  };
}

describe("privileged IPC boundary", () => {
  it("accepts only the secured renderer that owns the Lightbox window", () => {
    const window = windowWith(41);
    const sender = { id: 41 };
    expect(isTrustedWindowEvent({ sender }, window, (candidate) => candidate === sender)).toBe(true);
    expect(isTrustedWindowEvent({ sender: { id: 41 } }, window, () => false)).toBe(false);
    expect(isTrustedWindowEvent({ sender: { id: 42 } }, window, () => true)).toBe(false);
  });

  it("fails closed for an untrusted or missing sender", () => {
    const window = windowWith(41);
    expect(() => assertTrustedWindowEvent({}, window, () => true)).toThrow(/untrusted renderer/i);
    expect(() => assertTrustedWindowEvent({ sender: { id: 42 } }, window, () => true))
      .toThrow(/untrusted renderer/i);
  });
});
