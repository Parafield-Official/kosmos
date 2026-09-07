/** Exercise the app handlers with real codecs; only Electron/Finder is replaced. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const ffmpeg = process.env.FFMPEG_PATH || path.join(root, 'vendor/bin/ffmpeg');
const ffprobe = process.env.FFPROBE_PATH || path.join(root, 'vendor/bin/ffprobe');
const filename = path.join(root, 'electron/labs-audio.cjs');
const localRequire = createRequire(filename);
const reports=[];
const context = {reports, require: name => name === 'electron' ? {app:{getAppPath:()=>root,isPackaged:false},shell:{showItemInFolder(){}}} : localRequire(name), module:{exports:{}}, __dirname:path.dirname(filename), process, Buffer, console};
vm.runInNewContext(fs.readFileSync(filename,'utf8')+`
module.exports.decodeAudioPcm = decodeAudioPcm;
const originalLoadCoreModule = loadCoreModule;
loadCoreModule = name => {const core = originalLoadCoreModule(name); return name !== 'master' ? core : {...core, measurePcm: (...args) => {const report=core.measurePcm(...args); reports.push(report); return report;}};};`,context,{filename});
const api=context.module.exports;
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function snapshot(folder){const result={};for(const e of await fsp.readdir(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isDirectory()){for(const [k,v] of Object.entries(await snapshot(p))) result[e.name+'/'+k]=v;}else result[e.name]=hash(p);}return result;}
(async()=>{
 const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'kosmos-pipeline-'));
 try {
  for(const d of ['audio','manuscript'])await fsp.mkdir(path.join(folder,d));
  await fsp.writeFile(path.join(folder,'project.json'),'{}');
  await fsp.writeFile(path.join(folder,'manuscript/chapter.txt'),'Preservation fixture');
  // High-rate input with out-of-band energy must not fold into audible 8.1 kHz.
  const tone=path.join(folder,'96k.wav');
  const tonePcm=Float32Array.from({length:96000},(_,i)=>0.125*Math.sin(2*Math.PI*36000*i/96000));
  const audioCore=localRequire(path.join(root,'dist-core/audio.cjs'));
  fs.writeFileSync(tone,Buffer.from(audioCore.encodeWavPcm16(tonePcm,96000,1)));
  const decoded=await api.decodeAudioPcm(tone,44100);
  const samples=new Float32Array(decoded.pcm.buffer,decoded.pcm.byteOffset,decoded.pcm.length/4);
  let power=0;const body=samples.subarray(1000,samples.length-1000);for(const x of body)power+=x*x;
  assert.ok(10*Math.log10(power/body.length)<-70,'sample-rate conversion introduced audible aliasing');
  const input=path.join(folder,'input.mp3');
  const phraseBytes=execFileSync(ffmpeg,['-v','error','-i',path.join(root,'public/examples/proof/on_vs_in.wav'),'-f','f32le','-ac','1','-ar','48000','pipe:1']);
  const phrase=new Float32Array(phraseBytes.buffer,phraseBytes.byteOffset,phraseBytes.length/4);
  const take=new Float32Array(48000*68);let seed=7;
  for(let i=0;i<take.length;i++){seed=(1664525*seed+1013904223)>>>0;take[i]=(seed/4294967296*2-1)*0.0001;}
  let phrasePower=0;for(const x of phrase)phrasePower+=x*x;
  const gain=10**(-24/20)/Math.sqrt(phrasePower/phrase.length);
  for(let start=48000*2;start+phrase.length<take.length-48000*2;start+=phrase.length+48000){for(let i=0;i<phrase.length;i++)take[start+i]+=phrase[i]*gain;}
  const raw=path.join(folder,'fixture.wav');fs.writeFileSync(raw,Buffer.from(audioCore.encodeWavPcm16(take,48000,1)));
  execFileSync(ffmpeg,['-v','error','-i',raw,'-b:a','192k',input]);
  const wav=await api.transcodeToWav(fs.readFileSync(input));
  for(const file of ['original.wav','working.wav'])await fsp.writeFile(path.join(folder,'audio',file),wav);
  const original=await snapshot(folder);
  // The desktop main loop must keep serving window/input events during mastering.
  let lastHeartbeat = performance.now(), maxMasteringDelay = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxMasteringDelay = Math.max(maxMasteringDelay, now - lastHeartbeat);
    lastHeartbeat = now;
  }, 20);
  let master;
  try {
    master=await api.masterWorkingFile({folder,chapterId:'one',workingFile:'working.wav',presetId:'acx',targetRmsDbfs:-20});
    maxMasteringDelay = Math.max(maxMasteringDelay, performance.now() - lastHeartbeat);
  } finally { clearInterval(heartbeat); }
  console.log(`Mastering main-loop maximum delay: ${Math.round(maxMasteringDelay)} ms`);
  assert.ok(maxMasteringDelay < 750, 'mastering blocked the desktop event loop for 750 ms or more');
  assert.equal(master.ok,true,master.reason);
  const payload={folder,mode:'acx',presetId:'ebu-r128',chapters:[{id:'one',title:'Narration',mastered:true,masteredFile:master.masteredFile}]};
  const first=await api.exportDeliveryPack(payload);assert.equal(first.ok,true,first.reason);
  const report=fs.readFileSync(path.join(first.folder,'REPORT.txt'),'utf8');assert.doesNotMatch(report,/— FAIL/);
  const encodedReports=reports.filter(r=>r.format==='mp3');assert.equal(encodedReports.length,2);for(const r of encodedReports)assert.equal(r.checks.format,'pass');
  for(const file of first.files.filter(x=>x.endsWith('.mp3'))){
   const p=path.join(first.folder,file);
   const meta=JSON.parse(execFileSync(ffprobe,['-v','error','-show_entries','stream=sample_rate,channels,bit_rate:format=duration','-of','json',p]));
   assert.equal(meta.streams[0].sample_rate,'44100');assert.equal(meta.streams[0].channels,1);assert.equal(meta.streams[0].bit_rate,'192000');
   if(file.includes('retail'))assert.ok(Number(meta.format.duration)>=60&&Number(meta.format.duration)<=300);
   const packets=JSON.parse(execFileSync(ffprobe,['-v','error','-show_packets','-show_entries','packet=size,duration_time','-of','json',p],{maxBuffer:16e6})).packets;
   assert.ok(packets.length>0&&packets.every(p=>['626','627'].includes(p.size)&&Math.abs(Number(p.duration_time)-1152/44100)<0.000001),'expected constant 192 kbps MPEG-1 Layer III frames');
   const pcm=execFileSync(ffmpeg,['-v','error','-i',p,'-f','f32le','pipe:1'],{maxBuffer:64e6});const floats=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.length/4);let sum=0,peak=0;for(const x of floats){sum+=x*x;peak=Math.max(peak,Math.abs(x));}const rms=10*Math.log10(sum/floats.length);assert.ok(rms>=-23&&rms<=-18);assert.ok(20*Math.log10(peak)<=-3);
  }
  const before=await snapshot(folder);assert.equal((await api.exportDeliveryPack(payload)).ok,true);assert.deepEqual(await snapshot(folder),before);
  const failed=await api.exportDeliveryPack({...payload,chapters:[{...payload.chapters[0],masteredFile:'missing.wav'}]});assert.equal(failed.ok,false);assert.deepEqual(await snapshot(folder),before);
  for(const [k,v]of Object.entries(original))assert.equal(hash(path.join(folder,k)),v);
  console.log('PASS: anti-alias filtering, real import/master/export, ACX preset enforcement, verified format report, decoded levels, sample duration, repeat export and failure preservation.');
 }finally{await fsp.rm(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
