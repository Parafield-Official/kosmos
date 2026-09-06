const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
function harness(invoke = async () => ({ ok: true })) {
  const ipc = new EventEmitter(); ipc.invoke = invoke; ipc.send = vi.fn();
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'labs-preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: ipc }),
    process: { platform: 'darwin' }, window: { addEventListener() {} }, console,
  });
  const request = () => { ipc.emit('labs:shutdown-request', {}, 'nonce'); return ipc.send.mock.calls.at(-1)?.[2]; };
  return { ipc, api, request };
}
describe('sandbox preload shutdown handshake', () => {
  it('blocks unsaved recording and freezes new calls only after it is saved', async () => {
    const { api, request, ipc } = harness();
    api.setUnsavedWork('recording', 'Stop and save your recording.');
    expect(request()).toEqual({ ok: false, reason: 'Stop and save your recording.' });
    api.setUnsavedWork('recording', null);
    expect(request()).toEqual({ ok: true });
    await expect(api.saveProjectFile({ folder: '/book' })).rejects.toThrow(/closing/i);
    ipc.emit('labs:shutdown-release');
    expect(await api.saveProjectFile({ folder: '/book' })).toEqual({ ok: true });
  });
  it('refuses while IPC saves are pending and remembers a failed save until retry', async () => {
    let resolve;
    const { api, request } = harness(() => new Promise(r => { resolve = r; }));
    const saving = api.saveProjectFile({ folder: '/book' });
    expect(request().ok).toBe(false);
    resolve({ ok: false }); await saving;
    expect(request().ok).toBe(false);
    const retry = api.saveProjectFile({ folder: '/book' });
    resolve({ ok: true }); await retry;
    expect(request().ok).toBe(true);
  });
  it('does not count update installation itself as a pending save', async () => {
    let resolve;
    const { api, request } = harness(() => new Promise(r => { resolve = r; }));
    const installing = api.installAppUpdate();
    expect(request().ok).toBe(true);
    resolve({ installed: true }); await installing;
  });
});
