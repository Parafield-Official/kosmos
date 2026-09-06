# ACX pipeline audit after v0.1.28

## Confirmed compressor defect and escape

The pre-v0.1.28 compressor applied a nonlinear amplitude mapping independently to each sample above -28 dBFS. This reshaped waveform cycles and introduced harmonics. v0.1.28 uses a smoothed energy detector and attack/release gain instead. Existing 100 Hz and 1 kHz settled-tone regression tests reject added odd harmonics above -60 dB relative to the fundamental. They do not constitute general listening-quality validation.

The previous independent ACX verification script called masterPcm and separately copied encoder arguments. It did not exercise import, automatic repair/denoise, and the actual export transaction together. Loudness and format checks cannot establish perceptual fidelity.

## Fixes on this audit branch (not released)

- Actual app mastering/export decodes to the delivery sample rate through FFmpeg's filtered converter before reaching JavaScript's linear resampler. Prevents out-of-band energy folding into the audible band on downsampling. Decoder regression failed before the fix; real codec test checks 36 kHz at 96 kHz is rejected below -70 dBFS after conversion to 44.1 kHz.
- Known bad MP3 bitrate or known prohibited VBR fails even when another metadata field is unknown. Two failing regressions reproduced the old warning-first behavior.
- Export measurements receive constant-bitrate provenance for MP3s encoded immediately by our own explicit CBR encoder. Arbitrary imports do not receive this assumption.
- New real-codec pipeline verification exercises app handlers with a looped repository speech fixture, import from 48 kHz MP3, repair/master, ACX override of another selected preset, final decoded level and format checks, sample duration, repeat export and failed-export preservation. Only Electron app context and Finder reveal are substituted. Added to required CI job.

## Remaining risks / validation gaps

These are code-review findings needing dedicated fixtures and listening evaluation, not established customer root causes:

- Speech boundaries are selected with amplitude thresholds; very quiet initial/final consonants may be misclassified and trimmed. Need annotated soft-onset/soft-ending recordings and content-preservation tests.
- Noise floor uses a quiet window. A quiet window does not establish that background noise under speech is acceptable. Generated pads must not be treated as evidence of clean narration.
- Denoising retries are capped at 12 dB but lack a perceptual speech-preservation gate. Numerical success alone cannot exclude musical-noise artifacts.
- Stereo downmix averages channels. Opposite-phase narration can cancel; unequal channel quality can degrade output. Need stereo phase/channel fixtures and explicit refusal or channel handling.
- JavaScript core and pickup paths still contain linear resamplers. This branch fixes the desktop Master/Export entry points, not every direct-core or pickup caller.
- Repair changes are limited globally by sample count and RMS; that cannot prove a local consonant was preserved.
- Credits are README placeholders in this release; a complete submission still requires actual opening/closing credit recordings. A technically valid chapter/sample is not a complete accepted audiobook.

A diverse original-narration reference corpus with listening review is still required. The customer's already-processed MP3 cannot demonstrate removal of baked-in distortion or prove the original recording would sound correct. No release-wide guarantee is justified by this audit.

## Completed desktop-path audit findings, September 6, 2026

Scope: packaged entry point electron/labs.cjs; preload IPC; import/transcode; working/pickup state; repair/denoise; mastering/gating/trimming/normalization; export/encoding; final measurement; retail sample and credits; publication/rollback; narrator-facing readiness; CI. Legacy electron/main.cjs is excluded from the packaged application and was not treated as the shipping path. This is a code and targeted reproduction audit, not exhaustive perceptual, platform, cloud-storage or crash validation.

### Confirmed defects and implementation gaps

| Priority | Finding | Evidence / user impact | Proposed fix | Status |
|---|---|---|---|---|
| P1 | Quiet boundary content can be deleted | analyzeSpeech/speechBody in master.ts selects threshold crossings with no preservation margin. Synthetic signal above room noise loses 0.2 s at EACH end (acx-audit-observations.json). Demonstrates signal loss, not a measured customer word deletion. | Preserve original boundary audio by default; use conservative speech-aware bounds with lead/tail margin and human-speech fixtures. | Open |
| P1 | All-green noise result can hide a noisy internal interval | measure.ts selects quietest window. Reproduction with -43 dBFS internal interval reports -83 dBFS floor and every check passes because quiet ends dominate. | Inspect multiple internal pauses; distinguish representative noise estimate from quietest interval; flag nonstationary noise and exclude manufactured pads from narration quality claims. | Open |
| P1 | Handoff and default playback can use obsolete master | applyWorkingTape sets mastered=false but retains masteredFile; chapterPackSource and vault-media prefer masteredFile regardless. Reproduction selects old-master.wav instead of new-pickup.wav. ACX delivery itself blocks mastered=false. | Select master only when current/valid; invalidate stale preview/master provenance after any working edit. | Open |
| P1 | Downsampling without anti-alias filtering | Original desktop path handed native-rate PCM to linear interpolation. Real 96 kHz test validates out-of-band rejection after fix. Not the explanation for the supplied 44.1 kHz MP3. | Convert in FFmpeg before JS Master/Export. Audit remaining direct-core and pickup resampling separately. | Desktop paths fixed locally |
| P1 | Readiness claims exceed checks | ExportAcxScreen says Ready for Audible based solely on mastered count; exportBookPack sets completedAt after technical export. Credits are README placeholders; no listening/content check is required. | Separate technical export completion from submission readiness; explicitly indicate missing user-supplied content and listening review. Honor user skip options as incomplete submission, not ACX approval. | Open; UI deferred |
| P2 | Failure can occur after audio publication | Injected markerFileSet failure returns ok:false while active chapter file already contains new export (acx-publication-observation.json). | Stage/validate markers before audio publication, or explicitly report audio export success with marker failure. | Open |
| P2 | Known noncompliant encoding could be downgraded to unknown warning | Low bitrate with unknown VBR, or known VBR with unknown bitrate, returned warn. Failing tests reproduced both. | Evaluate known failures before unknown metadata. | Fixed locally |
| P2 | Correct export has unknown-CBR warning | Actual encoder creates CBR but measurement omitted vbr. | Supply CBR provenance only for the immediately generated output; validate actual encoder in real-codec test. | Fixed locally |
| P2 | Retail sample is a time slice without editorial boundaries | retailSampleRange starts at assumed pad length and cuts at max duration; may stop mid-word/sentence. No content screening/approval. | Preview and approve a passage ending at a safe boundary; avoid explicit material; keep validation after encoding. | Open; selection UI deferred |
| P2 | Retail minimum is stricter than current published page | acx_spec.json forces 60 seconds; current ACX page says 5 minutes or less, not a stated 60-second minimum. A book with only short chapters can be blocked. Older ACX guidance did specify 1–5 min. | Reconcile versioned rules; avoid claiming current ACX requires the old minimum without confirmation. | Open |
| P2 | EBU selection contradicts ACX export controls | UI retains EBU selector and global mastering preference, but ACX export intentionally forces ACX. A chapter mastered for EBU may be refused on ACX export without the page making the distinction clear. | Label target-specific actions and readiness; offer explicit remaster for chosen delivery target. | Open |
| P2 | Restoration details disappear | masterWorkingFile returns result metrics but not repair assessment or denoise strength; renderer types discard metrics and export entries do not pass processing fields to reportText. Report heading suggests restoration details that are absent. | Persist processing provenance per master and include it in report and comparison history. | Open |
| P2 | Readable filename order breaks for 100+ chapters | chapterFileName pads only to 2 digits, so lexical order places 100 before 11; generic names omit prologue/epilogue titles. | Use consistent project-wide index width and safe section labels; preserve explicit upload order. | Open |
| P2 | Pipeline tests omitted actual app orchestration | verify-acx.mjs copied encoder args, bypassing import/repair/export. | New real-handler test and required CI step added; verifies 48 kHz import, conversion, mastering, CBR output metadata, levels, repeat export, failure preservation. | Added locally; passed |

### Risks that still need targeted reproduction, not confirmed failures

- Automatic denoise has a strength cap, but no local speech-detail or perceptual-artifact assessment. The cap alone cannot guarantee natural sound. Need noisy narration fixtures and aligned before/after listening.
- Repair acceptance checks global changed-sample ratio and global RMS; a concentrated change in a consonant could remain within those limits. Test local windows and labeled speech events.
- Stereo channel averaging can cancel opposite-phase signal or combine a noisy channel with a clean one. Exact cancellation may be refused as no speech, but partial cancellation and tonal damage need fixtures and policy.
- Master completion applies a project snapshot captured before the asynchronous operation. Navigation/concurrent edits may make it stale. Need renderer integration tests and revision-bound master provenance.
- Export directory publication is not queued by project. Concurrent calls and external project edits need controlled race tests; the UI disables a local button but that is not a backend lock.
- Atomic rename protects ordinary write failures, but there is no demonstrated hard-crash recovery for a directory moved to backup before publication, and no full power-loss durability guarantee. Need process-kill tests and recovery discovery.
- 120-minute sources produce large full-buffer PCM and multiple JS array copies; no near-limit memory/latency validation was performed. Need isolated resource-budget tests on supported Windows/macOS machines.
- Peak checking is after encoding, so a peak overshoot is safely refused; automatic encode-adjust-retry is absent. Need transient-heavy examples to quantify unnecessary retries for narrators.
- Chapters can each meet RMS bounds but differ audibly in tone/background/volume. There is no demonstrated whole-book consistency assessment.

### Protections verified in this pass

- Actual desktop import, Master, export and final decoding ran successfully using real bundled codecs on a controlled speech fixture.
- The existing customer-file test verified two identical exports and preserved audio/manuscript/project files on a pre-publication failure.
- Export forces ACX settings and checks the final encoded chapter and sample, with sample duration after MP3 padding.
- Missing master inputs cause refusal; previous published exports survive that refusal.
- Project paths enforce containment and reject symlink components; source assets are separate from output artifacts.
- Shutdown guard tracks backend IPC operations; existing unit coverage passes. This is normal-shutdown protection, not hard-crash proof.
- Full automated suite: 132 files / 989 tests passed; application build passed. Real pipeline integration script passed separately. Newly configured CI job has not run remotely.

### Fix order

1. Content preservation: conservative boundaries, stale master selection/provenance, representative internal noise assessment.
2. Publication integrity: marker transaction boundary, project-level serialization, stale async results.
3. Honest delivery readiness and reporting: technical vs listening/content completion, credit/sample requirements, restoration history, target-selection consistency.
4. Broaden regression corpus: natural voices and soft consonants, 44.1/48/96 kHz, stereo phase, clipped/noisy/echoed inputs, transients, long chapters, repeated saves/exports and interrupted publication.
5. Listening review with original narrator recordings before making narrator-quality claims. Avoid shipping speculative DSP adjustments based only on numerical passes.

### Primary source checked

ACX Audio Submission Requirements, published April 15, 2026, retrieved September 6, 2026:
https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements

Current guidance includes spoken opening/closing credits, a sample no longer than five minutes, consistent sound and channels, absence of extraneous noises, chapter/section structure, and MP3 delivery requirements. The page also restricts unauthorized automated narration; meeting audio numbers does not establish eligibility of an ElevenLabs recording. This audit does not determine whether the customer has an authorization.

## Authorized fixes completed locally — September 6, 2026

This section supersedes the corresponding open statuses above; the baseline JSON reproductions are retained unchanged. No release, tag, version bump, or promotion was initiated for these changes.

- **Boundary preservation:** automatic threshold-based cropping is removed. Only effectively digital silence (absolute sample amplitude at most 1e-9) is stripped. Quiet boundary content and existing room tone remain. Excessively long room tone may consequently require manual editing rather than automatic deletion of possible speech. Regression covers quiet signal at both ends.
- **Stale masters:** working edits clear the master reference and measured readiness. Playback and handoff also reject a legacy master reference when its mastered flag is false. Old audio files are not deleted. This does not resolve the separately documented asynchronous snapshot race.
- **Noise reporting:** substantially louder internal low-level intervals trigger a review warning and explanation even if the quietest window passes. This is an uncertainty detector, not proof of noise or a guarantee of clean speech; a quiet consonant can warrant review. The numerical estimate remains the quietest-window measurement.
- **Publication:** marker generation and writes now occur inside the staged audio pack before the directory transaction. Failure preserves the previous pack. Marker files now live in the pack's markers/ subdirectory (export/acx/markers or export/acx-handoff/markers), and are listed in the result. Existing shared export/markers files are untouched.
- **Readiness wording:** the existing screen says ready to export audio and requests listening review and recorded credits, rather than claiming Audible readiness. Measured passes are labeled technical passes. The deferred credit/sample selection UI is not included.
- **Bitrate:** the earlier local audit changes retain known-invalid bitrate/VBR failures and supply CBR provenance for explicitly encoded delivery files.

Validation: application build passed; 133 test files / 995 tests passed. Real-codec desktop-handler verification passed (import, mastering, ACX encoding, final checks, sample duration, repeat export and failed-export preservation). The independent codec check measured RMS -20.65 dBFS and peak -3.50 dBFS; the app estimates true peak -3.46 dBFS and correctly warns about proximity to the limit. Its former all-green assertion has been replaced by no failed requirements plus verified encoding; independent numerical bounds remain enforced. Independent codec verification finished with 18/18 checks passing. New regressions first reproduced the defects before fixes.

The wider audit's other open findings and risks remain open. Original narration listening comparisons are still needed to assess perceptual quality across voices and recording conditions. These fixes do not establish universal ACX acceptance.
