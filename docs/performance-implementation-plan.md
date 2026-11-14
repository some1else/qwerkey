# Performance implementation plan

Implement in the order below, using the measurements in `docs/performance-analysis.md` as the baseline. Deliver the live-playing fix before changing playback scheduling or the sound chain. Application behavior must retain note ownership, recording, background playback, overdubbing, editing, MIDI routing, and cleanup.

1. **Make the performance check reproducible.**

   Move the temporary benchmark into a portable repository script, resolving dependencies through package imports and accepting the preview URL as an argument. Keep diagnostic timing runs separate from the normal correctness suite. Save the original results and the browser/machine configuration.

   Exercise recordings of 0, 500, and 2,000 notes at 16 notes/second. Add realistic pitch/time distributions and a longer-recording stress case. Cover Keyboard view, visible Buffer playback, and hidden-Buffer overdubbing. Collect event-handler duration, timer lateness, long tasks, frame intervals, main-thread task duration, and editor DOM mutations. Run CPU profiling separately from primary timing measurements to reduce observer overhead.

   Add deterministic regression checks for the actual failure: hidden capture must not mount note/velocity controls, and unchanged parameter controls must not update with every note. Avoid fragile whole-machine timing assertions in ordinary CI.

   **Acceptance:** a repeatable before/after comparison and a correctness regression that fails on the current hidden-editor implementation.

2. **Suspend the hidden editor while preserving the recording session.**

   Files: `src/components/instrument/Instrument.tsx`, `RecordedBuffer.tsx`; new `RecordedBufferEditor.tsx` and `src/hooks/useBufferSession.ts`.

   Keep `RecordedBuffer` mounted as a memoized session shell with stable `controller` and `visible` props. Extract transport ownership, recording integration, loop bounds, play/stop generation guards, and Space handling into `useBufferSession`. Render the expensive timeline/piano-roll editor only while visible.

   Preserve selection, zoom, timeline extent, and viewport offsets in the persistent shell/session. Restore offsets and attach ruler listeners when the view mounts. Obtain a fresh recording snapshot on entry. Space availability and export/play operations must query the current recording store rather than rely on a stale displayed array.

   Stop display polling while hidden and stopped. Keep transport synchronization active during hidden playback/overdubbing, without producing editor state updates. Backgrounding the page, disposing the controller, and Strict Mode cleanup must still stop and release everything correctly. Changing application tabs must not stop playback.

   Memoize `AudioParameters` using its existing stable parameter object and controller reference. Give MIDI controls only the port/mode data they need instead of the changing full note snapshot. Keep callbacks passed into memoized children stable.

   **Acceptance:** no editor note DOM or display snapshots during hidden, stopped capture; all notes appear on reopening; Space works immediately after recording; loop, selection, zoom, scroll, and playback survive view changes. On the reference machine, target below 30% main-thread utilization at 2,000 recorded notes, no accumulating input backlog, and a nominal four-second sequence finishing within approximately 4.25 seconds. Treat these timing numbers as local benchmark targets.

3. **Make recording reads cheap and prevent note-wide updates.**

   Files: `src/instrument/recording.ts`, `src/hooks/useBufferSession.ts`, `RecordedBufferEditor.tsx`.

   Expose cheap recording metadata such as note count, revision, and whether notes are pending. Add change subscriptions so the session can distinguish real data changes from held-note duration animation. Preserve immediate capture of every note edge; batch only observer/display work.

   Calculate extent from retained completed extent plus pending notes, without cloning the recording. Preserve the current Fit behavior: ordinary deletions do not automatically discard historical trailing duration. Cache snapshots when revision and pending state permit reuse. Use immutable completed-note objects and replace pending/edited objects rather than mutating objects already exposed to a consumer. Preserve identities for unaffected notes and their piano-roll value objects.

   Limit held-note display growth to the visible view's refresh rate. Replace large `Math.max(...array)` and `Math.min(...array)` patterns with reductions. Compute pitch bounds and other whole-recording metadata on relevant changes rather than every playhead update.

   **Acceptance:** stable snapshots when nothing changes; extent reads scale with held notes rather than recording length; old snapshots do not change after note-off; clear-with-held-notes, retriggers, concurrent editor merges, Fit, and recording across loop wraps retain their existing semantics. Include a large-recording case that cannot fail from spread argument limits.

4. **Bound visible rendering and make note feedback immediate.**

   Files: `RecordedBufferEditor.tsx`, `src/hooks/useInstrument.ts`, `src/components/instrument/Keyboards.tsx`, `PianoKeyboard.tsx`, `src/styles/app.css`.

   Keep the complete note collection in `PianoRoll.Root` so editing and selection operate on the whole recording. At the note-rendering boundary, mount note/handle and velocity elements only for notes intersecting the visible time/pitch window, plus modest overscan. Include long notes crossing viewport boundaries. Retain focused and actively dragged elements until the interaction finishes. Preserve offscreen selection for export, deletion, and transposition.

   Verify the installed piano-roll library's keyboard, marquee, and drag behavior with omitted note elements before choosing the exact adapter. Do not pass a filtered recording to the root or allow the adapter to delete offscreen notes. Use the existing primitives and value model rather than replacing the editor library.

   Separate playhead motion from note-array updates; update a small playhead consumer or transform from `requestAnimationFrame`. If the Timeline context forces all note consumers to update, isolate that position update outside the shared note-rendering subtree while keeping seek state synchronized.

   Coalesce visual note notifications to at most one update per animation frame. Keep controller truth, audio/MIDI commands, and recording events synchronous. Track brief presses so a note pressed and released in one frame still gets visible feedback without remaining logically held. Preserve immediate handling of enable, output, parameter, and lifecycle state changes. Set the active computer-key background transition to zero; retain release fading.

   **Acceptance:** editor element count follows the visible window; scrolling, zooming, dragging, marquee selection, keyboard navigation, and offscreen selected-note operations remain correct. Visible playback must not remap all notes for every playhead tick. Short taps, chords, duplicate owners, and cleanup produce correct highlights without dropped sound events.

5. **Reduce DSP cost with a device-rate audio context.**

   Files: `src/audio.ts`, `tests/audio.spec.js`, `tests/parameters.spec.js`, `README.md`.

   Replace the forced 192 kHz constructor with `new AudioContext({ latencyHint: 'interactive' })`, allowing the output device's preferred sample rate. Initially retain both dynamics stages, the existing 4× soft clipper, final ceiling, envelope defaults, voice count, unison, and panning. This isolates sample-rate cost from tonal and dynamics changes.

   Update the test that explicitly asserts 192 kHz. Render the actual graph at 44.1 and 48 kHz, checking finite samples, the -1 dBFS ceiling, dense chords, overloads, early releases, stealing, and parameter extremes. Compare offline processing time and impulse onset delay with the baseline. Update the README's oversampling description.

   **Acceptance:** the app no longer forces the whole graph to 192 kHz; output protection and voice behavior remain correct; the reference eight-voice offline benchmark shows the expected substantial reduction in work. Report processing cost and signal delay separately. Listen for aliasing or tonal regressions before considering this change validated for release.

6. **Make recorded playback resistant to main-thread timer jitter.**

   Files: `src/instrument/transport.ts`, `src/hooks/useBufferSession.ts`, `src/instrument/controller.ts`, `src/audio.ts`, `src/midi.ts`.

   Separate playback scheduling from live note commands. Add an explicit scheduled-output interface with event identity, target time, and cancellation; retain the existing immediate press/release path for live input and audition. Share ownership resolution so overlapping live/playback notes retain their current behavior.

   Use a short look-ahead scheduler for recorded events: begin with a 25 ms pump and a 100 ms scheduling horizon, then tune against the benchmark. Map transport time to `AudioContext.currentTime` for audio scheduling and the performance clock for timestamped MIDI output. Keep the scheduler independent of React renders and the visual playhead. Do not add this horizon as a delay to live playing.

   Track scheduled and sounding events separately. Tag playback generations so stop, seek, loop edits, output changes, and disposal invalidate future events. Cancel/disconnect future audio voices, release sounding playback owners, and clear/reconcile queued MIDI events on the affected output without releasing unrelated live owners. Ensure a scheduled future voice cannot prematurely steal a currently sounding live voice.

   Reconcile recording edits by note identity. Reuse unchanged edges and avoid re-sorting the entire recording merely because a pending note's displayed duration grows. Preserve overdubs on subsequent loop passes and notes held across loop boundaries. On stalls beyond the horizon, resume the current musical position without bursting through obsolete note-ons.

   **Acceptance:** deterministic clock tests and controlled main-thread stalls show stable scheduled timestamps within the look-ahead window. Stop/seek/output changes leave no future stray notes; unchanged notes are not retriggered on edits; overlapping live/playback owners, loop-wrap ordering, and hidden overdubbing pass regression tests. Timestamped fake MIDI ports must exercise queue clearing as well as sending.

7. **Evaluate the remaining fixed audio delay, then complete validation.**

   Compare the current two-dynamics bus with a single-dynamics bus that retains soft clipping and the final ceiling. Measure impulse onset, overload behavior, transient shape, and loudness across single notes and dense chords at device sample rates. Adopt the simpler bus only if it provides a useful delay reduction with acceptable dynamics and timbre. Keep this as a separate change from the device-rate context so it can be assessed and reverted independently. A custom AudioWorklet limiter is outside the initial fix and should be considered only if measurements show the simpler bus is insufficient.

   Run `npm test` for the finished implementation, including the existing keyboard, pointer, MIDI, recording, UX, and Strict Mode coverage. Add tests only for the new failure modes and scheduling contracts. Repeat the performance matrix on the production build with the editor open/closed, playback stopped/running, and overdubbing active. Include sustained rapid playing so recordings grow naturally, not just seeded bursts.

   Verify Chromium and Safari audio behavior, a mobile viewport, and real MIDI hardware where available. Measure physical input-to-output latency with a loopback setup where available; distinguish those results from browser timing proxies. Record unavailable hardware/browser checks explicitly rather than treating them as passed.

   **Acceptance:** all automated behavior checks pass; hidden-editor cost no longer grows with recording length; visible editor work is bounded by the viewport; scheduling remains correct under load; sound-quality and ceiling checks support any audio graph change. Update the performance analysis with final measurements and any remaining limitations.

Ship the changes as reviewable commits: benchmark/regression coverage; persistent session and hidden-editor isolation; recording/rendering efficiency; device-rate audio; scheduled playback; and, only if validated, dynamics simplification. The first responsiveness improvement can be delivered after step 2 without waiting for changes to the audio graph.


Implementation status: the measured live-playing bottleneck, recording snapshot/extent caching, horizontal note rendering, independent playhead animation, batched visual highlights, device-rate audio context, and benchmark/regression coverage are implemented. The persistent session remains in the memoized `RecordedBuffer` shell rather than a separate hook. Full vertical virtualization, recording change subscriptions, audio-clock look-ahead playback, incremental event reconciliation, and the optional dynamics simplification remain outstanding. Browser/hardware checks beyond Chromium remain outstanding. See the analysis document for production benchmark results.
