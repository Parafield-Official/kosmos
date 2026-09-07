const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createRequire} = require('node:module');

it('uses the source noise estimate for every original-file retry and preserves the final failure detail', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'kosmos-denoise-retry-'));
  try {
    await fs.writeFile(path.join(folder, 'project.json'), '{}');
    await fs.mkdir(path.join(folder, 'audio'));
    const source = path.join(folder, 'audio/working.wav');
    await fs.writeFile(source, 'original recording');
    const attempts = [];
    let calls = 0;
    const reason = 'Background noise measures -54.0 dBFS after mastering; ACX requires -60.0 dBFS or lower.';
    const core = {
      resolvePreset: () => ({}),
      deliveryProfile: () => ({sampleRate:44100,noiseFloorMaxDbfs:-60}),
      assessRepairCandidate: () => ({applied:false,safe:true}),
      noiseReductionAttempts: () => [8,12],
      quieterRmsTarget: () => undefined,
      selectNoiseProfile: () => null,
      assessDenoiseCandidate: () => ({safe:true}),
      masterPcm: () => ({status:'aborted',abort_code:'noise_floor',abort_reason:reason,predicted_floor_dbfs:-54,before:{noise_floor_dbfs:calls++ === 0 ? -55 : -65}}),
    };
    const filename = path.join(__dirname, 'labs-audio.cjs');
    const localRequire = createRequire(filename);
    const context = {
      require: name => name === 'node:worker_threads' ? {workerData:{kosmosAudioJob:true,appPath:path.dirname(__dirname),isPackaged:false}} : localRequire(name),
      module:{exports:{}},__dirname,process,Buffer,console,core,attempts,
    };
    vm.runInNewContext(fsSync.readFileSync(filename,'utf8') + `
      loadCoreModule = () => core;
      decodeAudioPcm = async () => ({pcm:Buffer.alloc(16),sampleRate:44100,channels:1});
      repairAudioFile = async (_core,_file,decoded) => decoded;
      denoiseAudioFile = async (_core,decoded,floor,strength) => {attempts.push({floor,strength});return decoded;};
    `, context, {filename});
    const result = await context.module.exports.masterWorkingFile({folder,chapterId:'one',workingFile:'working.wav'});
    expect(result).toEqual({ok:false,reason});
    expect(attempts).toEqual([{floor:-55,strength:8},{floor:-55,strength:12}]);
    expect(await fs.readFile(source,'utf8')).toBe('original recording');
    expect(await fs.readdir(path.join(folder,'audio'))).toEqual(['working.wav']);
  } finally {
    await fs.rm(folder,{recursive:true,force:true});
  }
});

for (const scenario of ['clean', 'quieter', 'profile', 'unsafe', 'adaptive']) {
  it(`automatically handles ${scenario} recordings without manual settings`, async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'kosmos-restoration-flow-'));
    try {
      await fs.writeFile(path.join(folder, 'project.json'), '{}');
      await fs.mkdir(path.join(folder, 'audio'));
      const source = path.join(folder, 'audio/working.wav');
      const destination = path.join(folder, 'audio/one-mastered.wav');
      await fs.writeFile(source, 'original recording');
      await fs.writeFile(destination, 'previous master');
      const attempts = [], targets = [];
      const selection = {startSample:8820,sampleCount:13230,rmsDbfs:-62};
      let filtered = false;
      const core = {
        resolvePreset: () => ({}),
        deliveryProfile: () => ({sampleRate:44100,noiseFloorMaxDbfs:-60,container:'mp3',limiterCeilingDbfs:-3.2}),
        assessRepairCandidate: () => ({applied:false,safe:true}),
        noiseReductionAttempts: () => [8,12],
        quieterRmsTarget: () => -22,
        selectNoiseProfile: () => scenario === 'adaptive' ? null : selection,
        assessDenoiseCandidate: () => ({safe:scenario !== 'unsafe'}),
        encodeWavPcm16: () => new Uint8Array([1,2,3]),
        masterPcm: (_audio,options) => {
          targets.push(options.targetRmsDbfs);
          expect(options.limiterCeilingDbfs).toBe(-3.8);
          const succeeds = scenario === 'clean' || (options.targetRmsDbfs === -22 &&
            (scenario === 'quieter' || (filtered && scenario !== 'unsafe')));
          return {status:succeeds?'ok':'aborted',abort_code:'noise_floor',abort_reason:'Noise still exceeds the limit.',
            predicted_floor_dbfs:-54,before:{noise_floor_dbfs:-62},samples:new Float32Array(4),sampleRate:44100};
        },
      };
      const filename = path.join(__dirname, 'labs-audio.cjs');
      const localRequire = createRequire(filename);
      const context = {
        require: name => name === 'node:worker_threads' ? {workerData:{kosmosAudioJob:true,appPath:path.dirname(__dirname),isPackaged:false}} : localRequire(name),
        module:{exports:{}},__dirname,process,Buffer,console,core,attempts,
        onFilter: () => {filtered = true;},
      };
      vm.runInNewContext(fsSync.readFileSync(filename,'utf8') + `
        loadCoreModule = () => core;
        decodeAudioPcm = async () => ({pcm:Buffer.alloc(16),sampleRate:44100,channels:1});
        repairAudioFile = async (_core,_file,decoded) => decoded;
        denoiseAudioFile = async (_core,decoded,floor,strength,selection) => {
          attempts.push({floor,strength,selection});onFilter();return decoded;
        };
      `, context, {filename});
      const result = await context.module.exports.masterWorkingFile({folder,chapterId:'one',workingFile:'working.wav'});
      expect(await fs.readFile(source,'utf8')).toBe('original recording');
      if (scenario === 'unsafe') {
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('withheld to protect the voice');
        expect(await fs.readFile(destination,'utf8')).toBe('previous master');
        expect(targets).toEqual([-20,-22]); // Unsafe candidates never reach normalization.
        expect(attempts.map(a=>a.strength)).toEqual([8,12,8,12]);
      } else {
        expect(result.ok).toBe(true);
        expect(result.restoration.targetRmsDbfs).toBe(scenario === 'clean' ? -20 : -22);
        expect(result.restoration.method).toBe(scenario === 'profile' ? 'learned_profile' : scenario === 'adaptive' ? 'adaptive' : 'none');
        if (scenario === 'clean' || scenario === 'quieter') expect(attempts).toEqual([]);
        else {
          expect(attempts).toEqual([{floor:-62,strength:8,selection:scenario === 'profile' ? selection : null}]);
          expect(targets).toEqual([-20,-22,-20,-22]);
        }
      }
    } finally { await fs.rm(folder,{recursive:true,force:true}); }
  });
}
