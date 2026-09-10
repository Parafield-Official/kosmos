/** Run the actual packaged entry point and renderer, with no Electron mocks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { auditMacArchitecture } = require('./audit-mac-architecture.cjs');
const { zipSync, strToU8 } = require('fflate');
const { downloadProofModel } = require('../electron/model.cjs');

const appPath = path.resolve(process.argv[2]);
const arch = process.argv[3];
const evidence = path.resolve(process.argv[4] || 'mac-evidence');
const resources = path.join(appPath, 'Contents/Resources');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-packaged-check-'));
fs.mkdirSync(evidence, { recursive: true });
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, arch, 'Must execute on the requested native architecture.');
const system = { arch, macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() };
const report = { system, assertions: [], errors: [] };
const log = fs.openSync(path.join(evidence, 'app.log'), 'w');
let child, socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child && child.exitCode !== null) throw new Error(`App exited with ${child.exitCode}.`);
    try { const result = await action(); if (result) return result; } catch (error) { if (Date.now() + 500 >= end) throw error; }
    await pause(300);
  }
  throw new Error('Timed out waiting for packaged app.');
}

(async () => {
  auditMacArchitecture(path.join(appPath, 'Contents/MacOS'), arch);
  auditMacArchitecture(path.join(resources, 'bin'), arch);
  report.assertions.push('Native app and bundled tools match host architecture');
  const manuscript = path.join(temp, 'fixture.docx');
  fs.writeFileSync(manuscript, zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Intel manuscript import works.</w:t></w:r></w:p></w:body></w:document>'),
  }));
  const imported = execFileSync(path.join(resources, 'bin/markitdown'), [manuscript], { encoding: 'utf8', timeout: 120000 });
  assert.match(imported, /Intel manuscript import works/);
  report.assertions.push('Packaged manuscript helper converts a DOCX');
  const model = await downloadProofModel(path.join(temp, 'proof-model'));
  assert.equal(model.available, true, 'Speech fixture must use the checksum-verified production model.');
  const userData = path.join(temp, 'user-data');
  child = spawn(path.join(appPath, 'Contents/MacOS/Kosmos'), ['--remote-debugging-port=0', `--user-data-dir=${userData}`], {
    stdio: ['ignore', log, log], env: { ...process.env, WHISPER_MODEL_PATH: model.path },
  });
  const port = await until(() => Number(fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0]));
  const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url.includes('index.html')));
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  let nextId = 0;
  const requests = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && requests.has(message.id)) {
      const { resolve, reject, timer } = requests.get(message.id); requests.delete(message.id); clearTimeout(timer);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.text);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, 60000);
    requests.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Runtime.enable');
  await until(() => evaluate('Boolean(window.kosmosNext && document.querySelector("#root")?.textContent?.trim().length > 20)'));
  report.assertions.push('Packaged renderer renders and exposes the real preload bridge');
  const project = await evaluate(`window.kosmosNext.createProject(${JSON.stringify({ title: 'Intel compatibility book', parentFolder: temp, author: 'Test' })})`);
  assert.equal(project.title, 'Intel compatibility book');
  const saved = await evaluate(`window.kosmosNext.saveProjectFile(${JSON.stringify({ ...project, title: 'Saved Intel book', chapters: [{ id: 'one', title: 'Chapter One' }] })})`);
  assert.equal(saved.title, 'Saved Intel book');
  const written = await evaluate(`window.kosmosNext.writeChapterContent(${JSON.stringify({ folder: project.folder, chapterId: 'one', html: '<p>Saved chapter on Intel.</p>' })})`);
  assert.equal(written.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project.folder, 'project.json'))).title, 'Saved Intel book');
  const read = await evaluate(`window.kosmosNext.readChapterContent(${JSON.stringify({ folder: project.folder, chapterId: 'one' })})`);
  assert.match(JSON.stringify(read), /Saved chapter on Intel/);
  report.assertions.push('Actual renderer IPC creates, saves, and reads a book and chapter');
  fs.copyFileSync(path.join(__dirname, '../public/examples/proof/on_vs_in.wav'), path.join(project.folder, 'audio/proof.wav'));
  const proof = await evaluate(`window.kosmosNext.transcribeChapter(${JSON.stringify({ folder: project.folder, file: 'proof.wav' })})`);
  assert.equal(proof.ok, true, JSON.stringify(proof));
  assert.ok(proof.words?.length > 0, 'Native CPU proof must return recognized words.');
  assert.equal(proof.timingEngine, 'whisper.cpp');
  report.proof = proof;
  report.assertions.push('Packaged native CPU speech engine transcribes the fixture through renderer IPC');
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, 'app.png'), Buffer.from(shot.data, 'base64'));
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { report.errors.push(error.stack || String(error)); console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), pause(5000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
  fs.closeSync(log);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
});
