/** Keep platform error details out of the reading flow; give a useful next step. */
export function playbackErrorMessage(reason?: unknown): string {
  if (reason && typeof reason === "object" && "name" in reason && reason.name === "NotAllowedError") {
    return "Audio playback was blocked. Click Play to try again.";
  }
  return "This recording couldn’t be played. Try Play again. If it still fails, reopen the chapter.";
}
