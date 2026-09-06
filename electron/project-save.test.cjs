const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { saveProjectJson, readProjectJson } = require('./project-save.cjs');
describe('recoverable project metadata', () => {
  let root, file;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'kosmos-save-')); file = path.join(root, 'project.json'); });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
  it('serializes overlapping revisions and keeps the previous valid revision', async () => {
    await fs.writeFile(file, JSON.stringify({ chapters: [], revision: 0 }));
    await Promise.all(Array.from({ length: 12 }, (_, i) => saveProjectJson(file, { chapters: [], revision: i + 1 })));
    expect((await readProjectJson(file)).revision).toBe(12);
    expect(JSON.parse(await fs.readFile(`${file}.previous`, 'utf8')).revision).toBe(11);
  });
  it('preserves the last project on failed publication and permits a later retry', async () => {
    await saveProjectJson(file, { chapters: [], revision: 1 });
    const rename = fs.rename;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === file) throw Object.assign(Error('disk unavailable'), { code: 'EIO' });
      return rename(from, to);
    });
    await expect(saveProjectJson(file, { chapters: [], revision: 2 })).rejects.toThrow();
    expect((await readProjectJson(file)).revision).toBe(1);
    spy.mockRestore();
    await saveProjectJson(file, { chapters: [], revision: 3 });
    expect((await readProjectJson(file)).revision).toBe(3);
  });
  it('recovers a truncated marker without overwriting its valid backup on the next save', async () => {
    await saveProjectJson(file, { chapters: [], revision: 1 });
    await saveProjectJson(file, { chapters: [], revision: 2 });
    await fs.writeFile(file, '{');
    expect((await readProjectJson(file)).revision).toBe(1);
    await saveProjectJson(file, { chapters: [], revision: 3 });
    expect(JSON.parse(await fs.readFile(`${file}.previous`, 'utf8')).revision).toBe(1);
  });
});
