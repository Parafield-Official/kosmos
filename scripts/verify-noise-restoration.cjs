/** Real bundled-codec checks for automatic noise learning and sample alignment. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'electron/labs-audio.cjs');
const localRequire = createRequire(filename);
const core = localRequire(path.join(root,'dist-core/master.cjs'));
const context = {
  require: name => name === 'node:worker_threads' ? {workerData:{kosmosAudioJob:true,appPath:root,isPackaged:false}} : localRequire(name),
  module:{exports:{}},__dirname:path.dirname(filename),process,Buffer,console,
};
vm.runInNewContext(fs.readFileSync(filename,'utf8')+'\nmodule.exports.denoiseAudioFile=denoiseAudioFile;',context,{filename});
const power = samples => samples.reduce((sum,x)=>sum+x*x,0)/samples.length;
(async () => {
  for (const sampleRate of [16000,44100,48000,96000]) {
    // Different spectra in quiet and active regions make an uncorrected hop
    // visible. Include sound in the first and last frame to catch tail loss.
    let seed=391;
    const source=Float32Array.from({length:sampleRate*3+137},(_,i)=>{
      seed=(1664525*seed+1013904223)>>>0;
      const t=i/sampleRate;
      const noise=(seed/4294967296*2-1)*0.0006+0.0005*Math.sin(2*Math.PI*90*t);
      const active=t<0.1||t>1;
      return noise+(active ? 0.08*Math.sin(2*Math.PI*193*t)+0.025*Math.sin(2*Math.PI*479*t) : 0);
    });
    const original=Buffer.from(source.buffer).toString('base64');
    const selection=core.selectNoiseProfile(source,sampleRate,{noise_floor_start_seconds:0.3,noise_floor_duration_seconds:0.4});
    assert.ok(selection,'stable pause should be selected');
    for (const profile of [selection,null]) {
      const result=await context.module.exports.denoiseAudioFile(core,{sampleRate,channels:1,pcm:Buffer.from(source.buffer)},selection.rmsDbfs,12,profile);
      assert.equal(result.pcm.length,source.byteLength,'cleanup must preserve exact length');
      const cleaned=new Float32Array(result.pcm.buffer,result.pcm.byteOffset,result.pcm.length/4);
      assert.equal(Buffer.from(source.buffer).toString('base64'),original,'cleanup mutated its source');
      // Correlation at +/- one sample must peak at zero; this catches both the
      // filter delay and off-by-one errors across odd FFT hop sizes.
      let bestLag=null,best=-Infinity;
      for (let lag=-1;lag<=1;lag++) {
        let dot=0,a2=0,b2=0;
        for(let i=sampleRate*2;i<sampleRate*2.5;i++) {const a=source[i],b=cleaned[i+lag];dot+=a*b;a2+=a*a;b2+=b*b;}
        const correlation=dot/Math.sqrt(a2*b2);
        if(correlation>best){best=correlation;bestLag=lag;}
      }
      assert.equal(bestLag,0,`timing shifted at ${sampleRate} Hz`);
      assert.ok(best>0.99,'voice-like waveform changed excessively');
      assert.ok(power(cleaned.subarray(0,Math.floor(sampleRate*.02)))>power(source.subarray(0,Math.floor(sampleRate*.02)))*.5,'opening sound lost');
      assert.ok(power(cleaned.subarray(-Math.floor(sampleRate*.02)))>power(source.subarray(-Math.floor(sampleRate*.02)))*.5,'ending sound lost');
      assert.equal(core.assessDenoiseCandidate(source,cleaned,sampleRate,selection.rmsDbfs).safe,true);
      if(profile) {
        const a=power(source.subarray(Math.round(sampleRate*.4),Math.round(sampleRate*.7)));
        const b=power(cleaned.subarray(Math.round(sampleRate*.4),Math.round(sampleRate*.7)));
        assert.ok(10*Math.log10(b/a)<-3,'learned cleanup did not reduce the quiet noise');
      }
      console.log(`PASS: ${sampleRate} Hz ${profile?'learned':'adaptive'} cleanup; exact duration, zero lag, opening/ending sound and voice guard.`);
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
