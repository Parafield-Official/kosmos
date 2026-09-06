const { createShutdownGuard } = require('./shutdown.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('shutdown preserves pending work', () => {
  it('refuses shutdown during a file write, then freezes new work after approval', async () => {
    const write = deferred();
    const guard = createShutdownGuard({ askRenderer: async () => ({ ok: true }), releaseRenderer() {} });
    const job = guard.run(() => write.promise);
    expect((await guard.prepare()).ok).toBe(false);
    write.resolve(); await job;
    expect((await guard.prepare()).ok).toBe(true);
    await expect(guard.run(async () => 'new write')).rejects.toThrow(/closing/i);
  });
  it('keeps the app usable after an unsaved recording or a missing renderer response', async () => {
    let response = { ok: false, reason: 'Stop and save your recording.' };
    const release = vi.fn();
    const guard = createShutdownGuard({ askRenderer: async () => response, releaseRenderer: release });
    expect(await guard.prepare()).toEqual(response);
    expect(await guard.run(async () => 1)).toBe(1);
    response = null;
    expect((await guard.prepare()).ok).toBe(false);
    expect(release).toHaveBeenCalled();
  });
  it('coalesces duplicate close attempts and recovers from handshake errors', async () => {
    const handshake = deferred();
    const ask = vi.fn(() => handshake.promise);
    const guard = createShutdownGuard({ askRenderer: ask, releaseRenderer() {} });
    const a = guard.prepare(); const b = guard.prepare();
    handshake.resolve({ ok: true });
    expect(await a).toEqual({ ok: true }); expect(await b).toEqual({ ok: true });
    expect(ask).toHaveBeenCalledTimes(1);
    guard.release();
    const broken = createShutdownGuard({ askRenderer: async () => { throw Error('gone'); }, releaseRenderer() {} });
    expect((await broken.prepare()).ok).toBe(false);
    expect(await broken.run(async () => 2)).toBe(2);
  });
});

describe('renderer approval authentication and timeout', () => {
  const { EventEmitter } = require('node:events');
  const { requestRendererApproval } = require('./shutdown.cjs');
  it('rejects a reply from another window and times out without closing', async () => {
    vi.useFakeTimers();
    try {
      const ipc = new EventEmitter();
      const sender = { send: vi.fn() };
      const win = { isDestroyed: () => false, webContents: sender };
      const reply = requestRendererApproval({ win, ipcMain: ipc, isTrusted: () => true, timeoutMs: 100 });
      const token = sender.send.mock.calls[0][1];
      ipc.emit('labs:shutdown-reply', { sender: {} }, token, { ok: true });
      await vi.advanceTimersByTimeAsync(100);
      expect((await reply).ok).toBe(false);
      expect(ipc.listenerCount('labs:shutdown-reply')).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('accepts only the current trusted request and cleans up its listener', async () => {
    const ipc = new EventEmitter();
    const sender = { send: vi.fn() };
    const win = { isDestroyed: () => false, webContents: sender };
    const reply = requestRendererApproval({ win, ipcMain: ipc, isTrusted: () => true });
    const token = sender.send.mock.calls[0][1];
    ipc.emit('labs:shutdown-reply', { sender }, 'stale', { ok: true });
    ipc.emit('labs:shutdown-reply', { sender }, token, { ok: true });
    expect(await reply).toEqual({ ok: true });
    expect(ipc.listenerCount('labs:shutdown-reply')).toBe(0);
  });
});
