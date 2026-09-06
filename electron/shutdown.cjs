/** A fail-closed barrier shared by window close, app quit and update install. */
function createShutdownGuard({ askRenderer, releaseRenderer }) {
  let pending = 0;
  let closing = false;
  let approved = false;
  let preparation = null;
  async function run(operation) {
    if (closing) throw new Error('Kosmos is closing. Please wait before starting more work.');
    pending += 1;
    try { return await operation(); }
    finally { pending -= 1; }
  }
  function release() {
    closing = false;
    approved = false;
    releaseRenderer();
  }
  function prepare() {
    if (approved) return Promise.resolve({ ok: true });
    if (preparation) return preparation;
    if (pending) return Promise.resolve({ ok: false, reason: 'Kosmos is still saving or processing audio. Wait for it to finish, then try again.' });
    closing = true;
    preparation = (async () => {
      try {
        const result = await askRenderer();
        if (result?.ok !== true) {
          release();
          return { ok: false, reason: result?.reason || 'Kosmos could not confirm that your work is saved. The app will stay open.' };
        }
        approved = true;
        return { ok: true };
      } catch {
        release();
        return { ok: false, reason: 'Kosmos could not confirm that your work is saved. The app will stay open.' };
      } finally { preparation = null; }
    })();
    return preparation;
  }
  return { run, prepare, release, get approved() { return approved; } };
}
let nextToken = 0;
function requestRendererApproval({ win, ipcMain, isTrusted, timeoutMs = 5000 }) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    const sender = win.webContents;
    const token = String(++nextToken);
    const finish = (result) => {
      clearTimeout(timer);
      ipcMain.removeListener("labs:shutdown-reply", listener);
      resolve(result);
    };
    const listener = (event, replyToken, result) => {
      if (event.sender === sender && replyToken === token && isTrusted(event)) finish(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "Kosmos could not confirm that your work is saved. Try again when the window responds." }), timeoutMs);
    ipcMain.on("labs:shutdown-reply", listener);
    try { sender.send("labs:shutdown-request", token); }
    catch { finish({ ok: false, reason: "The window is unavailable. Kosmos will stay open." }); }
  });
}
module.exports = { createShutdownGuard, requestRendererApproval };
