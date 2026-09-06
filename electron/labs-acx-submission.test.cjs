const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function exporter({ badSample = false, paddedDuration = 299.04 } = {}) {
  const filename = path.join(__dirname, 'labs-audio.cjs');
  const localRequire = createRequire(filename);
  const state = { presets: [], encoded: [], measured: 0 };
  const context = { require: name => name === 'electron' ? { app: {}, shell: { showItemInFolder() {} } } : localRequire(name),
    module: { exports: {} }, __dirname, process, Buffer, console, state, badSample, paddedDuration };
  vm.runInNewContext(fsSync.readFileSync(filename, 'utf8') + `
    decodeAudioPcm = async file => ({ pcm: Buffer.alloc(Math.round((file.includes('99_retail') ? paddedDuration : file.includes('long') ? 400 : 20) * 1000) * 4), sampleRate: 1000, channels: 1, format: 'mp3', bitrateKbps: 192 });
    encodeDeliveryAudio = async (_input, output) => { state.encoded.push(path.basename(output)); await fs.writeFile(output, 'encoded'); };
    loadCoreModule = name => name === 'master' ? {
      resolvePreset: id => { state.presets.push(id); return { label: id }; },
      deliveryProfile: () => ({ sampleRate: 1000, folderName: 'acx', extension: 'mp3', container: 'mp3', headSeconds: 1.5, includeRetailSample: true }),
      measurePcm: input => { state.measured++; const bad = badSample && Math.abs(input.samples.length / 1000 - paddedDuration) < .01; return { traffic_light: bad ? 'red' : 'green', checks: { rms: bad ? 'fail' : 'pass' } }; },
    } : name === 'export' ? {
      chapterFileName: chapter => String(chapter.index).padStart(2, '0') + '_chapter.mp3',
      buildExportPlan: () => ({ readmeFiles: [] }),
      reportText: entries => entries.map(entry => entry.fileName).join('\\n'), revealTargetInExportPack: files => files[0],
    } : {};
  `, context);
  return { run: context.module.exports.exportDeliveryPack, state };
}
const submission = { openingChapterId: 'open', closingChapterId: 'close', retailChapterId: 'long', retailStartSeconds: 1.5, retailDurationSeconds: 296, reviewed: true };
const chapters = ['open', 'short', 'long', 'close'].map(id => ({ id, title: id, mastered: true, masteredFile: id + '.wav' }));
let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kosmos-acx-submission-'));
  await fs.writeFile(path.join(root, 'project.json'), '{}');
  await fs.mkdir(path.join(root, 'audio'));
  for (const chapter of chapters) await fs.writeFile(path.join(root, 'audio', chapter.masteredFile), 'master');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const payload = () => ({ folder: root, mode: 'acx', presetId: 'ebu-r128', chapters, acxSubmission: submission });

describe('ACX submission transaction', () => {
  it('forces ACX, exports recorded credits separately, and samples a later chapter after a short first chapter', async () => {
    const { run, state } = exporter();
    const result = await run(payload());
    expect(result.ok).toBe(true);
    expect(state.presets).toEqual(['acx']);
    expect(result.files).toEqual(['00_opening_credits.mp3', '01_chapter.mp3', '02_chapter.mp3', '98_closing_credits.mp3', '99_retail_sample.mp3', 'REPORT.txt']);
    expect(await fs.readFile(path.join(result.folder, 'REPORT.txt'), 'utf8')).toContain('99_retail_sample.mp3');
    expect(state.measured).toBe(9);
  });
  it.each([
    [undefined, /credits/],
    [{ ...submission, closingChapterId: 'open' }, /credits/],
    [{ ...submission, retailChapterId: 'open' }, /narration chapter/],
    [{ ...submission, retailDurationSeconds: 300 }, /60–296/],
    [{ ...submission, reviewed: false }, /checklist/],
    [{ ...submission, retailChapterId: 'short' }, /longer chapter/],
    [{ ...submission, retailStartSeconds: 390 }, /longer chapter/],
    [{ ...submission, retailStartSeconds: 150 }, /beyond this chapter/],
  ])('refuses incomplete or invalid submissions: %j', async (acxSubmission, reason) => {
    const result = await exporter().run({ ...payload(), acxSubmission });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });
  it.each([{ badSample: true }, { paddedDuration: 300.042 }])('preserves the old pack when the encoded sample fails: %j', async options => {
    await fs.mkdir(path.join(root, 'export/acx'), { recursive: true });
    await fs.writeFile(path.join(root, 'export/acx/previous.mp3'), 'previous');
    const result = await exporter(options).run(payload());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Retail sample/);
    expect(await fs.readFile(path.join(root, 'export/acx/previous.mp3'), 'utf8')).toBe('previous');
    expect((await fs.readdir(path.join(root, 'export')))).toEqual(['acx']);
  });
});

describe('optional ACX assets', () => {
  it.each([[true, false], [false, true], [true, true]])('allows skipCredits=%s and skipRetailSample=%s while reporting omissions', async (skipCredits, skipRetailSample) => {
    const selected = { ...submission, skipCredits, skipRetailSample };
    const incoming = chapters.map(chapter => skipCredits && ['open', 'close'].includes(chapter.id) ? { ...chapter, mastered: false } : chapter);
    const result = await exporter().run({ ...payload(), chapters: incoming, acxSubmission: selected });
    expect(result.ok).toBe(true);
    expect(result.files.includes('00_opening_credits.mp3')).toBe(!skipCredits);
    expect(result.files.includes('98_closing_credits.mp3')).toBe(!skipCredits);
    expect(result.files.includes('99_retail_sample.mp3')).toBe(!skipRetailSample);
    const report = await fs.readFile(path.join(result.folder, 'REPORT.txt'), 'utf8');
    expect(report).toContain('partial pack');
    if (skipCredits) expect(report).toContain('Opening and closing credit recordings');
    if (skipRetailSample) expect(report).toContain('Retail sample');
    expect(await fs.readFile(path.join(root, 'audio/open.wav'), 'utf8')).toBe('master');
  });
  it('exports a chapter without any credit or sample selection when both are explicitly skipped', async () => {
    const result = await exporter().run({ ...payload(), chapters: [chapters[1]], acxSubmission: { skipCredits: true, skipRetailSample: true, reviewed: true } });
    expect(result.ok).toBe(true);
    expect(result.files).toEqual(['01_chapter.mp3', 'REPORT.txt']);
  });
  it('still refuses a book with no included chapters', async () => {
    const result = await exporter().run({ ...payload(), chapters: [chapters[0], chapters[3]], acxSubmission: { ...submission, skipCredits: true, skipRetailSample: true } });
    expect(result.ok).toBe(false);
  });
});
