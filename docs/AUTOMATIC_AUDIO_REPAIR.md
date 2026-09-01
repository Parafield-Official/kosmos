# Automatic audio repair

Kosmos treats restoration as a verified decision loop, not as one destructive
whole-file preset:

1. Preserve and measure the untouched take.
2. Detect a specific defect in a specific region.
3. Generate bounded repair candidates.
4. Compare each candidate with the source.
5. Accept the lowest-strength candidate that improves the defect while
   preserving speech.
6. Re-measure the final encoded file.
7. Turn only an unresolved region into a prepared pickup.

This is the common pattern behind iZotope RX Repair Assistant, Adobe Audition
Diagnostics, Acon Restoration Suite, and the Audible Studios edit/QC workflow.
The tools differ; the loop does not.

## Processing order

The default order is:

`de-clip → de-click → de-plosive → de-hum/noise → de-reverb/room match → level → limit → room-tone pad → encode → verify`

Clipping and impulses come first because EQ, denoise, compression, and limiting
can smear the evidence their detectors need. Every stage works from a preserved
source and records what it changed.

## Current implementation

### Clicks and clipped peaks

Export now runs FFmpeg's deterministic `adeclip` and `adeclick` filters before
noise reduction or mastering. Both use autoregressive interpolation and
overlap-save, which leaves samples outside detected damage untouched.

Kosmos independently rejects the candidate when:

- the output length changes;
- PCM is invalid or exceeds full scale;
- more than 2% of the take would be reconstructed; or
- programme level changes by more than 0.1 dB.

A safe repair is included in `REPORT.txt` and in the same delivery checklist as
noise reduction, level, peak, room tone, and encoding. A widespread repair is
not silently rendered; it becomes a targeted cleaner-take request.

`npm run verify:restoration` plants clicks and moderate clipping in narration,
runs the bundled FFmpeg, and independently checks that:

- a clean take remains sample- and level-neutral;
- both planted impulses are reduced;
- most flat-topped samples are reconstructed; and
- the output remains finite and the same duration.

### Steady and changing noise

The existing FFT cleanup uses `afftdn` with noise tracking and gain smoothing.
It tries only the reduction needed for the selected delivery target and stops at
12 dB. This handles moderate changes in a broadband floor without applying a
static noise print to an entire chapter.

### Performance pickups

Kosmos already has most of the professional pickup loop:

- Proof aligns the human read to the manuscript and identifies misreads,
  omissions, insertions, pronunciation differences, and long pauses.
- Pickups carry the sentence and surrounding timing, not only one word.
- The recorder captures a replacement.
- The splice engine trims silence, replaces the source interval, crossfades the
  seams, preserves the raw take, and invalidates stale QC.

The next automation step is to choose among alternate takes when available,
match room/level, splice the best candidate, and re-run Proof without requiring
the user to position a DAW edit.

## Next repair modules

### Plosives

Detect short low-frequency bursts aligned with P/B onsets. Generate local
de-thump and dynamic high-pass candidates with context fades. Accept only when
low-band burst energy falls while the following vowel's level, pitch band, and
transcript confidence remain stable. Capsule overload that affects the whole
syllable becomes a sentence pickup.

### Echo and room reverb

Acoustic echo cancellation and blind dereverberation are different problems.
Cancellation needs the playback/reference signal; a recorded room usually needs
blind speech dereverberation.

FFmpeg has no dedicated blind dereverb filter in the bundled runtime. A practical
offline candidate is an audited ONNX/CoreML speech-restoration model such as
Sidon, which performs denoise and dereverberation locally. Because it reconstructs
speech through a learned representation and vocoder, Kosmos must treat it as a
candidate, not a replacement: transcript alignment, timing, speaker identity,
word endings, sibilants, and residual audio must all pass before it can be used.

### Changing room sound

Analyze sliding windows for noise spectrum, EQ shape, room-tone level, and
reverb-tail changes. Cluster those windows into session profiles, repair each
region with the lowest required strength, match it to the book's reference room,
and crossfade profile boundaries. Regions that cannot converge without audible
pumping become prepared pickups.

### Performance

Software cannot recover a human performance that was never recorded without
generating a new performance. Kosmos can still automate the production outcome:

1. detect text, pronunciation, pacing, pause, repeat, and prosody outliers;
2. search attached alternates and punch recordings for the same sentence;
3. rank candidates by manuscript match, speaker/room similarity, and boundary
   continuity;
4. auto-align, splice, and re-QC the best take; or
5. open a sentence pickup with preroll when no acceptable take exists.

This keeps narration human while reducing a professional edit/QC/pickup workflow
to one guided exception instead of a manual DAW search.

## Acceptance gates

No repair is called complete from one compliance number. Each candidate must
improve its defect score and pass preservation checks:

- unchanged duration and alignment;
- no new clipping or non-finite samples;
- level-matched A/B comparison;
- stable transcript and word timings;
- bounded changed-sample/region ratio;
- stable speech-band energy and speaker identity;
- residual contains no consonants, word endings, or wanted transients;
- smooth room profile at edit boundaries; and
- final delivery measurement after encoding.

The original audio is never overwritten.

## Primary workflow sources

- [iZotope RX 11 Repair Assistant](https://docs.izotope.com/rx11/en/repair-assistant.html)
  — Voice mode, Learn, module suggestions, bypass controls, removed-signal
  audition, then Render.
- [Adobe Audition Diagnostics](https://helpx.adobe.com/si/audition/using/diagnostics-effects-waveform-editor-only.html)
  — Scan, inspect detected regions, repair selected events or Repair All.
- [Acon Restoration Suite](https://acondigital.com/products/restoration-suite)
  — separate de-clip, de-click/thump/plosive, adaptive noise, transient
  protection, and residual-listen workflows.
- [ACX audio submission requirements](https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements)
  — consistent sound/noise/spacing/pronunciation and no distracting clicks or
  plosives.
- [Audible Studios final-audio review](https://www.acx.com/mp/blog/how-to-review-your-final-audio-the-audible-studios-way)
  — technical edit, QC sheet, sentence-context pickups, and clean reinsertion.
- [FFmpeg audio filters](https://ffmpeg.org/ffmpeg-filters.html)
  — `adeclip` and `adeclick` autoregressive restoration.
- [Sidon speech restoration](https://github.com/sarulab-speech/Sidon)
  — open-source offline joint denoise/dereverb research candidate.
