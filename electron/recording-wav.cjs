/**
 * Validate browser recorder WAVs before they enter a project.
 *
 * Kept outside main.cjs so the accepted recording contract can be tested
 * without booting Electron.
 */
function assertRecorderPcmBounds(decoded, kind) {
  const sampleRateAccepted = kind === "live"
    ? Number.isInteger(decoded?.sampleRate) && decoded.sampleRate >= 8_000 && decoded.sampleRate <= 96_000
    : decoded?.sampleRate === 44_100;
  if (
    !decoded
    || !sampleRateAccepted
    || !Number.isInteger(decoded.channels)
    || decoded.channels !== 1
    || !decoded.samples
    || !Number.isInteger(decoded.samples.length)
    || decoded.samples.length === 0
    || decoded.samples.length % decoded.channels !== 0
  ) {
    throw new Error(
      kind === "live"
        ? "Live recorder WAV must contain mono PCM samples between 8 and 96 kHz"
        : "Recorder WAV must contain 44.1 kHz mono PCM samples",
    );
  }
}

module.exports = { assertRecorderPcmBounds };
