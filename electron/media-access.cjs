/**
 * macOS hardened-runtime apps cannot hear the microphone unless they both
 * declare the audio-input entitlement and ask TCC before Chromium opens the
 * stream. Without that, getUserMedia often "succeeds" with a silent track,
 * which the room check reports as −∞ dBFS.
 */

function isMicrophonePermission(permission) {
  return permission === "media" || permission === "microphone" || permission === "audioCapture";
}

async function ensureMicrophoneAccess(systemPreferences, platform = process.platform) {
  if (platform !== "darwin") {
    return true;
  }
  if (typeof systemPreferences?.askForMediaAccess !== "function") {
    return true;
  }
  return Boolean(await systemPreferences.askForMediaAccess("microphone"));
}

module.exports = { isMicrophonePermission, ensureMicrophoneAccess };
