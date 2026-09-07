# Playback convenience, clarity, and performance follow-up

Built on teleprompter commit `c5ddcef`. The follow-up fixes are local workspace changes; no release was published.

## User-visible behavior

- Proofread retains the last audio position, its original/updated source, and the corresponding text highlight when playback pauses or finishes. Locate remains available. Keeping the source is important: a punched working tape may have different timings from the original.
- Both the flag-list Pause button and the action-sheet Pause button now pause; Play resumes the paused clip at that position. Once a clip finishes, Play replays it from the beginning. The action-sheet progress display stays at the retained position while paused and does not reuse another clip's position.
- Failed Play requests and media errors show a plain-language message with a next step. Errors appear inside the action sheet when that sheet is open, and beside the main playback UI otherwise. Retrying clears the old message; recordings that failed loading are loaded again on retry.
- Loading a Proofread recording has visible status. Unrelated project metadata changes no longer stop playback or reload the audio. Switching chapters, replacing recordings, or changing punches/timings clears the old session and cached audio.
- Old playback promises and events cannot overwrite a newer session's state. Queued pause events are ignored if the audio has already resumed. Audio listeners and object URLs are cleaned up when sessions are replaced or the screen closes.

## Performance

Recording-screen playback previously reconstructed the transcript and aligned the manuscript on every audio `timeupdate`. `createChapterPlaybackClock` now builds that alignment once for each source and timing revision. Original and working timelines have separate caches. Manuscript changes, new recorded/proof timings, chapter changes, and punches invalidate the appropriate cached alignment. Cursor lookups preserve existing timing behavior, including seeking backward.

Proofread also reuses its alignment when moving between clips on the same unchanged tape.

Repeatable benchmark: `node_modules/.bin/jiti scripts/benchmark-playback-clock.ts`.

| Synthetic 6,000-word chapter, 60 position updates | Measured time |
| --- | ---: |
| Previous implementation | 1,525.51 ms |
| New one-time alignment setup | 23.53 ms |
| New 60 cached position updates | 0.78 ms |

All 60 resulting token positions were identical. This is a local benchmark of the position-mapping work, not an end-to-end frame-rate measurement or a claim about every user's hardware.

## Verification

- **224 tests passed in 20 files**, covering playback lifecycle, error/retry behavior, late events, chapter/punch invalidation, alignment caching, timing, manuscript selection, preferences, and the existing live-follow logic.
- **23 Electron UI checks passed**, including the previous 18 highlighting/scrolling regressions, real Proofread controls, original-source position retention, visible errors and retry, and native decoding/pause/resume/completion of a synthetic silent WAV.
- `npm run build` passed, including TypeScript and the production renderer. Existing Vite mixed-import and chunk-size warnings remain.
- `git diff --check` passed.

Electron artifacts: `/var/folders/bp/_84kkvn91hn4k3nd_q4rwmnw0000gn/T/kosmos-prompter-check-I53PGI`.

The regression script's `--baseline` option now explicitly targets `2ae0d51`, so committing new changes does not silently move the baseline. The additional follow-up UI cases run against current code; baseline mode retains the original 18-case matrix.

No microphone narration or speech-model behavior was changed. This follow-up tested playback with isolated synthetic data, not a user's recordings or a published installer.
