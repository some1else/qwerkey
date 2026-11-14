# Refactor plan: @audio-ui/react

## Objective

Adopt audio/ui primitives for Qwerkey's audio controls and, subject to behavioral compatibility, its piano keyboard. Keep the existing Astro page, React instrument island, Tonnetz layout, synthesis, MIDI routing, and session behavior. This document is a plan only; no dependencies or application code have been changed.

Use the headless npm package and the existing CSS. The project already has React 19, which the package requires, and does not use shadcn/ui or Tailwind. The [package documentation](https://www.npmjs.com/package/@audio-ui/react) identifies `@audio-ui/react` as the behavior/accessibility layer; styled registry components are a separate option. Verify peer dependencies for the selected release before installing it.

## Current implementation

- `src/components/instrument/AudioParameters.tsx` renders an oscillator select and seven uncontrolled numeric inputs. Validation currently lives in their browser input handlers. Accepted values go directly to the controller.
- `src/instrument/controller.ts` owns source-based note lifetimes, active-key snapshots, mode changes, and the audio/MIDI services. Parameter values are currently private to the synth, rather than included in snapshots.
- `src/components/instrument/Keyboards.tsx` renders 50 Tonnetz computer keys and 56 piano keys, MIDI pitches 41–96 inclusive.
- `Instrument.tsx` handles pointer presses for both keyboards; `useInstrument.ts` handles global keyboard input, pointer release, focus, and cleanup.
- The browser specs cover the native audio graph, envelopes, polyphony, MIDI, input ownership, layout, SSR/hydration, and Strict Mode cleanup. Retain these contracts throughout the refactor.

## Component mapping

| Existing control | Proposed UI | Preserved contract |
| --- | --- | --- |
| Oscillator | Native select | Sin/Tri/Saw/Sqr; default Tri |
| Voices | Native numeric input | Integer 1–64; default 8; immediate voice limiting |
| Attack, decay, release | `Knob` plus numeric input | 0–10000 ms, step 1; defaults 9/1800/2200; linear scale allows zero |
| Sustain | Horizontal `Fader` plus numeric input | -96–0 dB, step 0.1; default -12; linear in dB |
| Frequency | `Knob` plus numeric input | 1–20000 Hz, step 1; default 440; logarithmic travel |
| Resonance | `Knob` plus numeric input | 0.1–30 Q, step 0.1; default 0.7; logarithmic travel |
| Piano | `Piano.Root`, `Piano.Keys`, `Piano.Key` if compatible | 41–96, current dimensions, scrolling, highlights, and note ownership |
| Tonnetz computer keys | Existing custom view and mappings | Staggered geometry, duplicate pitches, labels, and release colors |
| Playback mode and MIDI ports | Existing buttons/selects | Permission timing, Safari handling, port selection, and session state |

The [Knob documentation](https://audio-ui.dev/docs/components/base/knob) describes logarithmic scales, fine drag, and reset behavior. Keep reset targets explicit through `defaultValue` even with controlled values. The [Fader API](https://www.audio-ui.dev/docs/react/fader) provides continuous change and commit callbacks; set the sustain range explicitly rather than relying on its defaults.

An envelope editor, meters, sequencer, velocity-sensitive synthesis, and an audio engine replacement are outside this refactor. In particular, the current sustain setting is a held dB level; a generic breakpoint editor would require additional semantic design.

## 1. Verify compatibility and establish the baseline

1. Run the current production build and Playwright suite before implementation. Record client JavaScript/CSS sizes and screenshots at 375, 667, and 1280 px. Existing historical migration measurements are not a fresh baseline.
2. Select an exact `@audio-ui/react` version, inspect its peer requirements and exported types, and update `package.json`/`package-lock.json` together. Use per-primitive subpath imports where supported. Avoid adding registry infrastructure or unrelated framework upgrades.
3. In a temporary test harness, verify a styled Knob/Fader and the Piano under Astro prerendering and hydration. Read the installed declarations/source for shared props, CSS variables, and note event details; do not infer primitive props from registry-only options.
4. Resolve the piano questions below before replacing its current event adapter. Record the selected version, evidence, and decision in this document during implementation. If Piano cannot preserve the required semantics through supported composition, retain the custom piano and complete the parameter migration independently.

**Exit criterion:** A reproducible baseline, compatible locked dependency, and an explicit piano go/no-go decision.

### Piano compatibility questions

The [Piano documentation](https://audio-ui.dev/docs/components/base/piano) exposes external highlights through `activeNotes`, note callbacks, per-touch play, and button keys with keyboard navigation. It also describes glide between keys, unlike Qwerkey's current captured press. Its listed Root props do not include a glide toggle. Treat compatibility as unverified until the selected package is inspected.

- Can each note-on/off pair be associated reliably with its pointer or focused-key owner, including cancellation? Verify callback event details and multiple contacts on the same pitch.
- Can captured-press behavior be retained through supported APIs? Cancelling a new glide note alone is insufficient if the original note has already been released.
- Can blur, pagehide, hidden-document transitions, mode changes, and disposal clear both library-held interaction state and controller-held notes? A later callback must not revive a cleared note or release a new owner.
- Can the existing 56-key geometry, partial end octaves, black-key hit areas, and horizontal scroll strip be styled without conflicting with primitive positioning?

Do not silently introduce glissando or change shared-pitch release behavior to make the migration pass. An incompatible Piano remains a separately documented follow-up.

## 2. Give parameter widgets one accepted state

1. Extract the existing parameter metadata into a typed module, such as `src/instrument/parameters.ts`: labels, units, bounds, steps, default/reset values, and display scale. Keep `defaultParameters` as the source of initial synth values; avoid circular imports.
2. Add accepted `parameters: Readonly<SynthParameters>` to controller snapshots. Make `setParameters` validate finite numbers, ranges, and step alignment, plus oscillator choices, before updating the synth and publishing the accepted state. Use a tolerant step check for decimal values. Reject invalid edits rather than silently clamping typed text; publish only real changes.
3. Keep transient numeric draft text local to each parameter widget. Empty, out-of-range, or off-step text must leave the last accepted engine value intact. Valid edits should apply immediately as today. Define blur/Escape to restore the accepted value, and knob/fader changes to replace stale draft text.
4. Keep accepted settings across mode changes. Reset them only with a fresh instrument/controller lifecycle, matching current session scope.

**Exit criterion:** Existing parameter behavior remains valid, and multiple views of one parameter stay synchronized without losing draft edits on unrelated note renders.

## 3. Migrate the audio parameter panel

1. Add small project-owned `ParameterKnob` and `ParameterFader` wrappers under `src/components/instrument/`. Assemble primitive parts, provide labels/units, and style focus, disabled, and interaction states in `src/styles/app.css`.
2. Drive each primitive with accepted `value`, an explicit default/reset target, and the metadata limits. Retain a separately labelled visible numeric input for exact entry; keep existing numeric IDs where practical. Give the slider a distinct accessible name such as “Frequency control” to avoid ambiguous labels.
3. Send accepted `onValueChange` values synchronously to `controller.setParameters`. Do not defer sound changes to effects or gesture commit. Preserve held-note updates for oscillator/frequency/resonance, next-note ADSR behavior, and immediate polyphony enforcement. Commit callbacks need no persistence behavior in this scope.
4. Keep controls below the piano. Fit or wrap them within the existing 667 px minimum page layout, and preserve the audio/MIDI visibility rules.
5. Check `useInstrument`'s ignored focus targets against the actual primitive DOM. Focused parameter controls must consume their own keyboard interaction without triggering Tonnetz notes. Keep normal focus on a control after an edit.

**Exit criterion:** Knobs/fader and numeric entry agree, preserve engine semantics, support pointer/touch/keyboard input, and do not cause accidental notes.

## 4. Migrate the piano if the compatibility gate passes

1. Extract `PianoKeyboard.tsx` from `Keyboards.tsx` and compose the headless Piano with explicit pitch bounds. Adapt `state.active` to the array expected by `activeNotes`; highlights from MIDI must remain display-only.
2. Route primitive note events through a small adapter into the existing controller's `press`/`release` API. Preserve stable owners across overlapping input sources and call the controller directly from callbacks. Ignore velocity for this refactor so loudness stays unchanged.
3. Remove the piano's old delegated pointer-down path when the primitive becomes responsible for it. Keep Tonnetz pointer handling and its document release listeners. Namespace piano owners to prevent those listeners from releasing piano notes accidentally; integrate controller-wide cleanup with the primitive's interaction reset.
4. Preserve piano focus for its own navigation rather than unconditionally calling the existing instrument focus helper. Global QWERTY handling must not intercept piano navigation or activate Tonnetz notes while a piano button has focus. Keep focus restoration after enabling audio and changing modes.
5. Retain useful pitch data attributes/test hooks and scope button styles so the existing mode-button CSS does not affect piano keys. Map primitive active state into current visuals and retain the scroll area below the playable keys.

**Exit criterion:** No double dispatch, stuck notes, premature releases, or highlight feedback; current pointer semantics and layout are preserved, with accessible piano navigation added.

## 5. Verify and document

- Run `npm run build` and the full production Playwright suite; use the existing separate CI typecheck/build/artifact-test jobs. A serial browser run is available if local resource contention makes parallel runs unreliable.
- Extend `parameters.spec.js` with gesture changes, reset, exact entry, invalid drafts, decimal stepping, and numeric/slider synchronization. Assert native audio changes as well as displayed values.
- If Piano migrates, extend `pointer.spec.js` and `keyboard.spec.js` for cross-surface shared pitches, two contacts on one pitch, release outside the key, cancellation/lost capture, navigation, and release-all during a gesture. Keep real-touch coverage and the non-playing scroll strip.
- Preserve `audio.spec.js` render checks and `midi.spec.js` boundary fakes. Retain hydration without browser globals at render time, the audio enable gesture/retry path, deferred MIDI permission, and Strict Mode teardown tests in `migration.spec.js`.
- Compare layout and production payload against the fresh baseline; verify root deployment and a rebuilt alternate base. Report measured bundle growth and responsiveness.
- Update the README with control gestures/reset, exact entry, accessibility, selected package version, and any deferred piano limitation. Remove only superseded code/styles.

Deliver stages as sequential reviewable changes: dependency/compatibility evidence, shared parameter state, parameter UI, compatible piano migration, and final documentation. Each stage must build and pass its relevant tests; keep the preceding working stage available for rollback.

**Completion criteria:** The parameter panel uses `@audio-ui/react`, all supported input paths preserve the current synthesis and MIDI contracts, static rendering and lifecycle cleanup pass, and the piano outcome is explicitly recorded. This planning change has not run the application tests or established a new performance baseline.

## Implementation record

Implemented with `@audio-ui/react` 0.13.0 and its transitive core package. The
installed declarations accept React 19; no React, Astro, Tailwind, or registry
migration was needed. Knob/Fader subpath imports power project-owned wrappers.
The controller validates and publishes accepted parameters; local numeric drafts
stay separate. Existing defaults, bounds, steps, and native engine semantics are
preserved.

The installed core Piano source unconditionally releases the prior note on
glide. The user explicitly requested adopting that installed behavior, overriding
the original captured-press compatibility requirement. Piano now owns its pointer
and accessible keyboard interactions. Its callbacks use distinct pointer/key
owners in the existing controller; external active pitches only light keys.
Global release increments an interaction generation and remounts Piano so cleared
gestures cannot restart notes after blur, mode changes, or hidden-page cleanup.
Tonnetz remains custom and retains its original input behavior.

Fresh pre-change assets: JS 237459 bytes / 74754 gzip, CSS 6824 / 1830 gzip,
HTML 21362 / 5133 gzip. Migrated root assets: JS 269064 / 85015 gzip,
CSS 8301 / 2151 gzip, HTML 39378 / 6816 gzip. JS growth is 10261 gzip bytes.
The initial baseline browser run passed 56 tests; its last request overlapped a
rebuild and timed out, so it is not recorded as a clean full-suite baseline.

Validation: `npm run build` passes with no errors or warnings (two existing
keyCode deprecation hints). All 63 production Playwright tests pass with
`npx playwright test --workers=1 --timeout=60000` (1.2 minutes). New coverage
checks knob drag/reset, parameter synchronization, invalid/off-step drafts,
native envelope updates, piano glide with shared QWERTY ownership, piano keyboard
navigation, and two real touch contacts sharing one piano pitch. Native audio
fixtures now provide key coordinates and stub capture on the Piano root, where
the primitive owns it; real mouse/touch cases continue exercising native capture.
A separate `/qwerkey/` build passes Chromium hydration and asset checks, showing
six sliders and 56 piano buttons. The 667 px parameter view and 1280 px migrated
piano/control view were visually inspected. `git diff --check` passes. No deployment
was performed.
