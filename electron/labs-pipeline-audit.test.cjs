const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function loadDecoder() {
  const filename = path.join(__dirname, 'labs-audio.cjs');
  const localRequire = createRequire(filename);
  const calls = [];
  const context = { require: name => name === 'electron' ? { app: {}, shell: {} } : localRequire(name), module: { exports: {} }, __dirname, process, Buffer, console, calls };
  vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}
    probeAudio = async () => ({sampleRate: 96000, channels: 1, duration: 1, format: 'wav'});
    runFfmpeg = async args => {calls.push(args); return Buffer.alloc(44100 * 4);};
    module.exports.decodeAudioPcm = decodeAudioPcm;
  `, context);
  return { decode: context.module.exports.decodeAudioPcm, calls };
}
describe('delivery sample-rate conversion', () => {
  it('uses the codec resampler before mastering instead of unfiltered decimation', async () => {
    const {decode, calls} = loadDecoder();
    const result = await decode('96k-narration.wav', 44100);
    expect(calls[0][calls[0].indexOf('-ar') + 1]).toBe('44100');
    expect(result.sampleRate).toBe(44100);
  });
});
