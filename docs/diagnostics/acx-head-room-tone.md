# ACX head room tone failure on long lead-ins — October 12, 2026

## Symptom

A customer mastered an ElevenLabs MP3 (Chapter 6, 7:09, mono 44.1 kHz, 192 kbps CBR) for ACX and got:

> Mastered output failed required ACX / Audible checks: head room tone.

Reproduced with the real desktop handler (`masterWorkingFile`: import transcode, worker, FFmpeg repair, `masterPcm`) and with `masterPcm` alone.

## Root cause

The file opens with **4.18 s of ±1 PCM16-step dither** (−91.5 dBFS RMS) before the first breath; speech ends 0.16 s before the end.

Since v0.1.29 (`15106c9`), mastering deliberately keeps the take's own lead-in and tail: only exact digital zeros are stripped, because amplitude-based cropping had deleted quiet speech. But `padRoomTone` still prepended the full 1.5 s generated pad unconditionally, without knowing the limit it was building towards:

```
head = 1.5 s pad + 4.18 s recorded lead-in = 5.68 s  >  ACX maximum 5.0 s
```

The judge (`measurePcm`) knew the 0.5–5 s limit; the planner (`padRoomTone`) did not. The failure was detected only after all processing, as a terminal `structure` abort the restoration retries never consider. Lifting only the 5 s ceiling reproduces the exact output the shipped code builds: every other check passes, and the head measures 5.68 s.

This is not specific to voice generators. Any take whose recorded lead-in or tail exceeds 3.5 s fails the same way, including a narrator who records several seconds of room tone before reading, as ACX encourages.

Why earlier fixes and tests did not catch it: every room-tone fixture had a lead-in of 2 s or less. The v0.1.29 audit noted that long room tone "may require manual editing", but nothing tested what happened; it was a hard, unexplained failure.

Waveform and mel-spectrogram figures were made from the customer's audio and are kept out of the repository. They show a flat ±1-step lead-in from 0 to 4.18 s, a breath at 4.2 s, the first word at 5.6 s, and in the shipped master a measured head of 5.68 s past the 5.0 s line.

## Fix (`src/core/acx/master.ts`)

`planBoundaryTrim` decides, once and before gain, how much recorded room tone must go so that the generated pad plus the kept lead-in or tail stays at or below the limit minus 0.5 s:

1. **Same ruler as the judge.** The excess is measured with `measureBoundaryRoomTone`, which is the exact frame, noise-floor and room-tone code `measurePcm` uses.
2. **Independent bound on what may go.** The meter's noise floor adapts to the take. On unbroken narration with one loud click it calls the voice itself room tone, and the gate then lowers it. Only an unbroken run of frames from the file edge, measured before the gate and at least 35 dB below the take's 95th-percentile level, can be removed. ACX-compliant room tone is 37 dB or more below narration, so any breath, consonant or click stops the run. The 1 s nearest the speech is never removed. A first version without this bound deleted 60 s of a test take, which `verify-acx-pipeline` caught.
3. **Decided once.** Generated pads are capped at −70 dBFS while the take's room rises with gain, so a post-gain verdict can differ. Reusing one decision keeps the level target computed on the file that ships.
4. **Margin for export.** Export re-measures the encoded MP3, and encoder delay adds about 40 ms to the head; the 0.5 s margin keeps a master that only just fits from failing on export.

When no trim is needed (the pad plus the recorded edge measures 4.5 s or less, i.e. a lead-in or tail up to about 3 s), the master is identical to the shipped one, sample for sample.

## Result on the customer file

| | Shipped | Fixed |
|---|---|---|
| Master | aborted: head room tone | ok |
| Head / tail | 5.68 s / 1.66 s | 4.50 s / 1.66 s |
| Recorded lead-in kept | — | 3.00 of 4.18 s (far 1.18 s removed) |
| ACX export | — | ok; FFmpeg: head 4.54 s, tail 1.68 s, RMS −20.6 dBFS, peak −4.2 dBFS, 192 kbps CBR mono |

## Regression coverage

- `src/core/acx/master-boundaries.test.ts`:
  - The customer geometry.
  - A sweep of 9 lead-in and tail geometries (0–15 s) × 3 edge types (dither, a −72 dBFS room, digital zero). Each case is judged after the PCM16 write and checks that no lead-in is removed unless the limit requires it.
  - Unbroken narration with a click, which must never be trimmed.
- `scripts/verify-acx-pipeline.cjs`: a voice-generator-shaped 192 kbps MP3 through import, master and ACX export with real codecs. The encoded head and tail are checked with a plain −60 dB gate rather than the app's meter. Against the shipped core it fails with the customer's exact error.

## Still open

- Generated pads are capped at −70 dBFS while a noisy room is raised by gain. A −72 dBFS room needing +12.7 dB produces a 1.5 s pad about 11 dB quieter than the room that follows. This is audible as a step at the pad boundary, and the meter then reads that room as speech. This predates the fix and should be matched or crossfaded separately.
- The meter's adaptive noise floor can mistake unbroken quiet narration with a loud click for room tone; the gate then attenuates it 30 dB. Trimming no longer trusts it, but the gate still does.
- `masteringStructuralFailure` messages give no measured value or next step; a too-long head that cannot be safely trimmed should say how long it is and how to fix it.
