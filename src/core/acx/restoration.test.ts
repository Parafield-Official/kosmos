import { describe, expect, it } from "vitest";
import { selectNoiseProfile, quieterRmsTarget, denoiseDelaySamples, profiledAfftdnFilter, assessDenoiseCandidate } from "./denoise";
import { ACX_PRESET, EBU_R128_PRESET } from "./presets";

function fixture(rate: number) {
  return Float32Array.from({length:rate*3}, (_,i) => (i < rate ? 0.0005 : 0.1) * Math.sin(2*Math.PI*120*i/rate));
}

describe("automatic restoration selection and preservation", () => {
  for (const rate of [16000,44100,48000,96000]) {
    it(`selects a stable nonzero pause at ${rate} Hz without relying on filenames or timestamps`, () => {
      const selection = selectNoiseProfile(fixture(rate),rate,{noise_floor_start_seconds:0.2,noise_floor_duration_seconds:0.3});
      expect(selection?.startSample).toBe(Math.round(rate*0.2));
      expect(selection?.sampleCount).toBe(Math.round(rate*0.3));
      expect(denoiseDelaySamples(rate)).toBe(2*Math.floor(rate/80));
    });
  }
  it("does not learn digital silence, speech, a burst, or a short/out-of-range pause", () => {
    const rate=44100, samples=fixture(rate);
    const region={noise_floor_start_seconds:0.2,noise_floor_duration_seconds:0.3};
    expect(selectNoiseProfile(new Float32Array(samples.length),rate,region)).toBeNull();
    expect(selectNoiseProfile(samples,rate,{...region,noise_floor_start_seconds:1.2})).toBeNull();
    expect(selectNoiseProfile(samples,rate,{...region,noise_floor_duration_seconds:0.1})).toBeNull();
    expect(selectNoiseProfile(samples,rate,{...region,noise_floor_start_seconds:-1})).toBeNull();
    expect(selectNoiseProfile(samples,rate,{...region,noise_floor_start_seconds:3})).toBeNull();
    samples[Math.round(rate*.3)]=0.5;
    expect(selectNoiseProfile(samples,rate,region)).toBeNull();
  });
  it("does not identify constant low-level speech or constant noise as a noise-only profile", () => {
    const samples=Float32Array.from({length:44100*3},(_,i)=>.01*Math.sin(2*Math.PI*140*i/44100));
    expect(selectNoiseProfile(samples,44100,{noise_floor_start_seconds:1,noise_floor_duration_seconds:.5})).toBeNull();
  });
  it("accepts natural noise fluctuations including an isolated quieter frame", () => {
    const rate=44100, samples=fixture(rate);
    const start=Math.round(rate*.2), size=Math.round(rate*.02);
    // A low-energy frame is not a burst or evidence that speech was selected.
    for(let i=start+size*5;i<start+size*6;i++) samples[i]*=.4;
    expect(selectNoiseProfile(samples,rate,{noise_floor_start_seconds:.2,noise_floor_duration_seconds:.3})).not.toBeNull();
  });
  it("keeps quieter targets within the preset, leaves low requested targets and LUFS alone", () => {
    expect(quieterRmsTarget(ACX_PRESET,-20)).toBe(-22);
    expect(quieterRmsTarget(ACX_PRESET,-22.5)).toBeUndefined();
    expect(quieterRmsTarget(EBU_R128_PRESET,-20)).toBeUndefined();
    expect(quieterRmsTarget({...ACX_PRESET,rms_dbfs:{min:-18,max:-14}},-15)).toBe(-17);
  });
  it("caps learned-profile suppression and freezes the learned spectrum", () => {
    expect(profiledAfftdnFilter(-63,90)).toContain("nr=12");
    expect(profiledAfftdnFilter(-63,4)).toContain("tn=0");
    expect(profiledAfftdnFilter(-63,4)).toContain("0.8 afftdn sn stop");
  });
  it("accepts quiet-only attenuation but rejects deleted, shifted and damaged voice", () => {
    const rate=44100, source=fixture(rate);
    const cleaned=Float32Array.from(source,(x,i)=>i<rate?x*.3:x);
    expect(assessDenoiseCandidate(source,cleaned,rate,-69).safe).toBe(true);
    expect(assessDenoiseCandidate(source,source.slice(1),rate,-69).safe).toBe(false);
    const muted=source.slice();muted.fill(0,rate,rate+rate*.15);
    expect(assessDenoiseCandidate(source,muted,rate,-69).safe).toBe(false);
    const shifted=Float32Array.from(source,(_,i)=>source[Math.max(0,i-37)]);
    expect(assessDenoiseCandidate(source,shifted,rate,-69).safe).toBe(false);
    const invalid=source.slice();invalid[0]=NaN;
    expect(assessDenoiseCandidate(source,invalid,rate,-69).safe).toBe(false);
  });
});
