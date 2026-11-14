# Recording and playback plan

Status: core recording, editing, looping, and MIDI export implemented. See the implementation record below for validation and the remaining scheduling limitation.

## Intended behavior

- Rename **Audio** to **Just play** and **MIDI** to **Send MIDI**. Add **Recorded buffer** as the third tab.
- Record live performances automatically from the first note, regardless of which tab is visible. Include computer keys, pointer/touch piano playing, and notes received from the selected MIDI input while MIDI input is enabled.
- Recorded buffer opens a horizontally scrollable, meterless piano roll containing the current session's notes. Recording continues while it is open.
- Provide clear, basic note editing, a time-range/loop selection, play/stop, and separate **Download entire buffer** and **Download selected range** actions.
- Treat the buffer as editable MIDI note data, rather than an audio recording. Timing, pitch, channel, and velocity survive capture, editing, playback, and export.

Proposed defaults: the buffer lasts for the current page session; playback uses the most recently selected audio/MIDI output; playback and editor audition do not record themselves. There is no record-arm step. Reload persistence, MIDI controller/pedal automation, audio export, and tempo analysis are follow-ups.

## Existing architecture and library fit

`src/instrument/controller.ts` owns accepted local note presses/releases, shared-pitch ownership, output mode, and lifecycle cleanup. `src/midi.ts` currently reduces incoming messages to pitch/on-off and sends outgoing notes on channel 1 at velocity 64. Incoming notes highlight the keyboard without sounding the synth. `src/audio.ts` starts voices immediately and keys them by pitch. These are the integration points; recording should not be added separately to every keyboard component.

The installed versions are `@audio-ui/react` 0.13.0 and `@audio-ui/core` 0.22.1. Their declarations expose the required primitives:

- `PianoRoll.Root` accepts controlled notes, note selection, edit callbacks, audition callbacks, and explicit pitch/length bounds. Its note shape is `{ id, pitch, start, length, velocity? }`, with normalized velocity.
- `Timeline.Root` accepts arbitrary time units, explicit zoom in pixels per unit, and `snapStep={0}` for no grid. Use seconds, a seconds ruler, and no bars, beats, time signature, metronome, or automatic quantization.
- `Timeline.Viewport` supplies horizontal scrolling. `Timeline.Range` with `drawable` and two `RangeHandle`s supplies an independent time selection. `PianoRoll.SelectionSpan` describes selected notes and must not be mistaken for this loop range.
- The primitives supply editor interaction, not Qwerkey's recording store, audio engine, MIDI exporter, or transport. Compose the installed primitives directly and keep their existing versions unless a prototype reveals a concrete blocker.

References: [PianoRoll API](https://audio-ui.dev/docs/react/piano-roll), [Timeline API](https://audio-ui.dev/docs/react/timeline). Installed declarations are the authority for the pinned versions.

## 1. Separate tabs, output routing, and transport

Introduce `tab: 'play' | 'midi' | 'buffer'` separately from the existing audio/MIDI output route. Use accessible `tablist`, `tab`, and `tabpanel` semantics and keyboard navigation.

- Just play and Send MIDI retain the current keyboards and their respective controls. Selecting them selects the corresponding route, with the existing release behavior, deferred MIDI permission, and Safari restriction. Update visible copy and accessibility labels.
- Recorded buffer replaces the performance panel with the roll and its toolbar. Opening it releases held local notes at the navigation time, closing their recordings, but retains the current output route and MIDI input subscription. It must not request MIDI access merely by opening.
- Show a small playback output selector in Recorded buffer, defaulting to that retained route, with the applicable sound controls or MIDI output selector available. Explicitly choosing MIDI follows the existing permission/browser behavior. Leaving the tab, changing output/ports, or clearing stops playback first.
- Keep QWERTY live playing available when the instrument background has focus. Editor gestures and shortcuts keep editor focus and must not trigger Tonnetz notes. Extend `useInstrument`'s focus filtering to the roll and range controls, including their focusable grid containers.

## 2. Add one MIDI-compatible recording store

Add `src/instrument/recording.ts` with a controller-owned store, monotonic clock injection, and explicit reset/disposal. Store editable notes in one canonical representation:

```ts
interface RecordedNote {
  id: string;
  pitch: number;              // MIDI integer 0–127
  channel: number;            // MIDI channel nibble 0–15
  velocity: number;           // MIDI note-on velocity 1–127
  releaseVelocity: number;    // MIDI note-off velocity 0–127
  start: number;              // seconds from this buffer's origin
  duration: number;           // positive seconds once released
  source: 'local' | 'midi';
}
```

Keep pending note-ons separately, keyed by their actual stream/channel/pitch identity, with stable note IDs. Expose growing display lengths without fabricating a permanent note-off. Validate finite nonnegative times and MIDI ranges at store boundaries. Adapt seconds directly to PianoRoll's `start`/`length`, and convert velocity through `/ 127`; preserve channel, source, and release velocity by ID when applying editor changes. New editor notes use channel 1 and velocity 64.

Use `performance.now()` as the recording clock, normalizing received MIDI timestamps to that clock. Set time zero at the first accepted note after initialization or Clear; retain silence between later notes. Tab changes never reset this origin. Track elapsed extent separately from the last note end so deleting a note does not unexpectedly shift later music or the loop.

Capture rules:

- Local capture follows effective live note-on/off dispatch: the first owner of a pitch starts a note and the last release ends it. Repeated keydown and multiple owners of the same pitch do not duplicate the note. Use the current outgoing velocity default of 64 and channel 1 in both routes.
- Extend MIDI reception to retain channel, velocity, release velocity, and timestamp, rather than recording from the highlight set. A velocity-zero note-on is a note-off. Key incoming state by channel/pitch; aggregate pitches only for highlights. A repeated note-on on the same input/channel/pitch closes the prior note and starts a new one; orphan note-offs do nothing.
- Record incoming notes even though they currently only highlight the keyboard. Retain that live monitoring behavior. Keep incoming and local capture identities separate, and do not forward incoming notes to MIDI output automatically.
- Record playback intent before synth voice stealing and exclude ADSR release tails; MIDI duration means key-down duration. Lack of a selected MIDI output does not prevent local note capture.
- Mark events as `live`, `playback`, or `preview` at the controller boundary. Only `live` enters the recorder. Externally routed MIDI feedback cannot be identified reliably from note messages; do not create an automatic MIDI thru path.
- Close pending recordings on release-all, tab/route changes that release notes, blur, pagehide, document hiding, input replacement/disconnection, and disposal. Duplicate cleanup must be harmless.

Keep the buffer and transport subscriptions separate from high-frequency keyboard snapshots. Append/finalize notes incrementally; update pending lengths and the playhead through bounded display updates while visible. Do not copy the entire history on every animation frame or drop old notes silently.

## 3. Build the meterless Recorded buffer panel

Add `RecordedBuffer.tsx` and a small store-to-roll adapter under `src/components/instrument/`. Use subpath imports from `@audio-ui/react/piano-roll` and `@audio-ui/react/timeline`, with project-owned CSS.

- Compose a seconds ruler, drawable time range with start/end handles, PianoRoll keys/rows/notes, note resize handles, marquee selection, velocity lane, and playhead in a shared timeline. Use explicit zoom and an actual horizontal scrollbar so long recordings grow beyond the viewport. Include zoom in/out and Fit actions, without rescaling automatically after every note.
- Start with a useful visible pitch range around the existing piano, expanding to cover all recorded MIDI pitches, including 0 and 127. Allow vertical scrolling while keeping the pitch labels and seconds ruler aligned. Do not clamp incoming MIDI to the playable keyboard's 41–96 range.
- Basic manipulation means selecting one/multiple notes, moving in time/pitch, resizing, deleting, drawing a note, and editing velocity. Supply explicit positive minimum note/range lengths and a fixed keyboard time step, for example 1 ms minimum and 10 ms arrow steps, independent of total recording length. Capture itself stays unquantized.
- Maintain `selectedNoteIds` separately from `selectedTimeRange: [start, end] | null`. The highlighted time range is used for looping and selected-range export. Provide exact start/end seconds inputs and a Clear range action; selection must include silence as well as notes.
- Opening the tab retains the entire history and initially fits its existing extent. New notes extend the timeline without moving a viewport the user has scrolled into the past. Pending notes grow visibly and are read-only until released; committed edits apply by ID against the latest store so a concurrent incoming note is never overwritten by an old editor array.
- Clear stops transport/audition, empties notes and selections, resets time/playhead, and starts a new buffer. If an incoming or live note remains held, reopen its recorder-only entry at zero without retriggering sound, so its eventual release is paired correctly. Provide an inline Undo clear action using a snapshot of the cleared buffer.
- Show an empty-state hint. Disable playback for an empty buffer and range export without a valid nonempty-duration time range. Export may contain silence when the selected range contains no notes.

## 4. Implement loop playback with explicit note ownership

Add `src/instrument/transport.ts` and route its events through controller-owned output adapters. Maintain playing/stopped state, playhead, frozen playback data, and a cancellation generation.

- Play starts at the selected range start; without a selection it uses the whole current buffer extent. Freeze both notes and bounds when starting, so new live recordings do not change a loop mid-pass. Stop returns to the range start. The next Play takes a fresh snapshot.
- Repeat the range until Stop. Treat it as half-open `[start, end)`: notes crossing its start are retriggered at the start, notes crossing its end are released at the end, and notes beginning exactly at its end belong to the next range. Reuse the same clipping helper for export.
- Give playback and preview their own owner namespaces. For audio, aggregate owners per pitch; for MIDI, per channel/pitch. Stopping playback releases only playback owners, preserving a live note on the same pitch. Update keyboard/roll highlights from combined owners without feeding them back into recording.
- Use an audio clock and bounded lookahead scheduling; use animation frames only for visual position. Extend the audio service to accept scheduled note times and cancellable playback voices, and MIDI sending to accept channel, velocity, and browser-clock timestamps. Map clocks explicitly. Test start/resume after a suspended context; Play is an audio-enable user gesture when needed.
- Stop, output changes, device removal, blur, hidden-page transitions, pagehide, and disposal cancel queued future starts and issue matching note-offs. In MIDI, clear queued playback messages on the selected output where supported, then restore required live-note state if cleanup would affect a shared pitch. Do not leave timestamped notes queued after Stop. Guard all late callbacks with the cancellation generation.
- Editing notes/range while playing stops transport before applying the change. Recording new live notes can continue against the frozen playback snapshot. Preview on edit uses the preview origin and stops on gesture cancellation/navigation.

## 5. Export valid MIDI for the buffer or selected range

Add a pure `src/instrument/midi-file.ts` exporter. Choose a small maintained writer only after checking its API and browser payload, or implement the limited note-only SMF writer with byte-level tests.

- Generate a Standard MIDI File containing explicit tempo, paired note-on/off events, channels, attack/release velocities, and end-of-track. Use a fixed 60 BPM encoding tempo and 1000 ticks per quarter note so one tick is 1 ms. This is an encoding convention; there is no displayed meter or inferred musical tempo. Omit the time-signature event.
- Entire buffer exports all edited notes from buffer zero. Selected range exports every intersecting note, clips at both boundaries, and rebases its start to zero. Preserve leading/trailing silence within the selected range using the final track time.
- Snapshot pending notes at the click time, treating that instant as their temporary end without changing the live recording. Apply the same snapshot rule when starting playback.
- Round to ticks only during serialization, ensure every exported note lasts at least one tick, use deterministic ordering with note-offs before new note-ons at equal times, and write proper variable-length delta times. Normalize overlapping notes on the same channel/pitch into playable unions for export so one source's note-off cannot cut off another; retain the separate source notes in the editable buffer.
- Download `.mid` through a Blob URL with distinct whole/range filenames, then revoke the URL. Export requires neither MIDI permission nor selected hardware.

## Delivery and verification

Implement in reviewable stages, each with a working build:

1. **Tab state and copy:** rename labels, add the third tab/panel, separate routing, and preserve existing MIDI/Safari/focus contracts.
2. **Recording:** add the store, MIDI metadata, note-origin tagging, and lifecycle finalization; verify timing and shared ownership with an injected clock.
3. **Editor:** compose the installed primitives, adapters, scrolling, manipulation, range controls, and Clear/Undo clear.
4. **Transport:** implement scheduling, route adapters, clipping, loop boundaries, cancellation, and audition without recursive recording.
5. **MIDI download and documentation:** implement/export-test SMF, update README usage, and run integration/regression checks.

Verification should cover:

- Deterministic recording cases: chords, repeated keydown, duplicate local owners, incoming channels/velocities, retriggers, velocity-zero note-off, late/orphan release, idle gaps, Clear while held, and every cleanup path.
- Editor behavior: pointer/touch/keyboard manipulation, unchanged channel metadata, range selection independent from note selection, seconds/free timing, out-of-keyboard-range pitches, long horizontal scrolling, and concurrent MIDI capture during an edit.
- Playback: correct clipped boundary notes over multiple iterations, live/playback shared pitches, Stop during lookahead, route changes/disconnects, no post-stop sounds or MIDI messages, no feedback into the buffer, and Strict Mode teardown.
- MIDI files: parse generated bytes with an independent reader; check headers/deltas/end-of-track, channels/velocities, event pairing, overlap normalization, rounding, rebased boundaries, pending notes, and selected silence.
- Run `npm run build` and the production Playwright suite, adding recording/editor/transport/download specs alongside the current audio/MIDI/lifecycle coverage. Inspect the panel at the supported 667 px minimum and desktop widths; confirm scrolling stays within the roll, hydration succeeds, and opening the tab does not request MIDI permission. Compare the client bundle before/after and verify an alternate deployment base.

Completion means every accepted live note reaches the session buffer, the three tabs preserve routing semantics, the meterless roll can edit/clear/select/loop, stopping leaves no owned notes or scheduled starts behind, and both downloads open with correct timing in an independent MIDI reader. This planning change does not require running the application suite; implementation validation remains to be performed.


## Implementation record

Implemented with the existing locked audio/ui versions and no new dependencies.
The controller records local effective note ownership and channel-aware incoming
MIDI. The session store retains open notes and merges editor changes by ID.
Recorded buffer composes the headless PianoRoll and Timeline with seconds,
free timing, scroll/zoom, independent loop range, velocity edits, Clear/Undo,
and whole/range MIDI downloads. Audio playback respects velocity, MIDI playback
retains channels and release velocity, and playback/preview owners are excluded
from capture. Output changes and lifecycle cleanup release owned notes.

The transport uses cancellable deadline-based browser timers, dispatching every
note edge and deriving each loop from its original clock epoch to avoid cumulative
drift. It does not implement the proposed Web Audio clock/lookahead or future MIDI
timestamp queue. Heavy main-thread work can therefore introduce playback jitter;
timestamped scheduling remains an outstanding item from stage 4. No future starts
are queued in the audio/MIDI engines after Stop.

Validation: production build/typecheck pass, the full 68-test Chromium suite passes,
and focused recording tests cover MIDI byte parsing, note metadata, boundaries,
clear-held behavior, editing, looping, cancellation, and concurrent editor/input
updates. The panel was visually inspected at desktop width. No deployment or
physical MIDI hardware check was performed.
