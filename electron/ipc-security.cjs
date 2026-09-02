/**
 * Keep privileged IPC bound to the one secured Lightbox renderer.  A preload
 * bridge is not an authorization boundary by itself: if a renderer navigates
 * away from the packaged UI, it must lose access to every privileged handler.
 */
function isTrustedWindowEvent(event, window, isTrustedRenderer) {
  return Boolean(
    window
    && !window.isDestroyed()
    && event?.sender
    && event.sender.id === window.webContents.id
    && isTrustedRenderer(event.sender),
  );
}

function assertTrustedWindowEvent(event, window, isTrustedRenderer) {
  if (!isTrustedWindowEvent(event, window, isTrustedRenderer)) {
    throw new Error("Blocked IPC request from an untrusted renderer.");
  }
}

module.exports = {
  assertTrustedWindowEvent,
  isTrustedWindowEvent,
};
