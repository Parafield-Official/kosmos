# Stopped Read and Review Flow Audit

Date: 2026-08-24
Surface: Teleprompter stopped-recording state and manuscript Review

## What was confusing

1. **“Start narrating” was ambiguous after Stop.** The page position remained, but starting capture created a new booth tape. The UI implied continuation without providing append semantics.
2. **“Read again from the start” hid replacement.** It did not say that the newly saved read would become the chapter's current booth recording.
3. **The destructive action had no confirmation.** A narrator could replace the current read with one click and no summary of the recording at risk.
4. **Playback was presented without a next-step decision.** Listen, Review, Continue, and Start over had equal visual weight even though they have very different consequences.
5. **Review source selection was implicit.** “Check this read” could open a proof surface while an uploaded take was also present, without naming which recording was being checked.
6. **Completion was invisible.** Duration showed how long the recording was, but not how much of the manuscript had timed audio.

## Corrected information architecture

### After the first Stop

- Show **Recording stopped** as a decision state.
- Show duration and a thin manuscript-coverage line.
- Make **Continue recording** the primary action.
- Explain that Continue appends at the saved manuscript cursor.
- Offer **Choose recording for Review** as the secondary action.
- Keep **Start over…** visually separate and caution-colored.

### Continue

- Seed the active booth tape with the saved audio.
- Restore the exact saved manuscript cursor.
- Offset new speech timing by the retained tape duration.
- Merge the previous and new manuscript timelines on Stop.
- Save the combined tape as the current booth read.

### Start over

- Require an explicit confirmation dialog.
- Identify the duration and manuscript coverage of the current read.
- State that the new read replaces the current booth read only after it stops and saves successfully.
- State that the attached chapter take is unaffected.

### Review

- Ask the narrator to choose **Booth read** or **Attached chapter take** before entering Review.
- Check the selected source, then open the full manuscript Review.
- Keep the selected source named in Review.
- Show a thin recorded-coverage line above the manuscript and a continuation message when coverage is incomplete.

## Visual hierarchy

1. Continue recording — primary blue action.
2. Choose recording for Review — neutral secondary action.
3. Start over — caution treatment with an ellipsis indicating another decision.
4. Audio playback — supporting evidence beneath the decision, not the only visible state.

## Acceptance checks

- A stopped read can be continued without losing its existing audio.
- Continue resumes at the saved manuscript cursor even if the page was moved after Stop.
- Start over cannot begin without confirmation when a booth read exists.
- Canceling the dialog changes no files or state.
- Selecting a Review source checks that source and opens the manuscript Review.
- Both the stopped card and Review manuscript expose recorded coverage.
- If an append cannot be saved, the prior booth tape remains the current recording.
