# Fast-arpeggio performance analysis

Measured on 14 November 2026 against commit `99435fc`, using the production Astro build and local Playwright Chromium on macOS. Application source was left unchanged. A temporary copy was used to test an editor-isolation prototype.

The principal reproduced failure is main-thread saturation caused by the hidden recording editor. Its cost grows with the accumulated recording, even while only the Keyboard tab is visible. Audio processing adds a separate, avoidable cost and fixed signal latency.

## Measurements

The benchmark seeds a recording with synthetic keyboard events, waits 3.5 seconds for audio tails and rendering to settle, then requests 64 notes at 16 notes/second, with separate note-on/off tasks every 31.25 ms. Both builds use the original 192 kHz synth, default eight voices, and identical audio settings. The 500- and 2,000-note cases were repeated.

The prototype memoizes `RecordedBuffer`, stops its recording-snapshot polling while hidden and stopped, and omits its editor DOM while hidden. Its recording/controller and transport lifecycle remain mounted. Opening Buffer requests a fresh snapshot, and the Space handler checks the recording store rather than a stale displayed note array. This is a diagnostic prototype, not a finished production patch.

| Seeded notes | Current main-thread utilization | Prototype utilization | Current median frame interval | Prototype median frame interval |
| --- | ---: | ---: | ---: | ---: |
| 0 | 29% | 20% | 16.7 ms | 16.7 ms |
| 500 | 82–91% | 14–18% | 16.7 ms | 16.7 ms |
| 2,000 | approximately 100% | 19% | 66.7–133.3 ms | 16.7 ms |

Utilization is the CDP main-thread task-duration delta divided by observed elapsed time; it is not whole-machine CPU usage. Small measurement-boundary differences can put the raw ratio slightly above 100%.

At 500 seeded notes, the hidden Buffer subtree generated 324,545–328,354 DOM mutation records during the approximately four-second sequence. The prototype generated zero. At 2,000 notes the current version generated over one million mutation records and 161–162 tasks longer than 50 ms; the prototype had zero such long tasks.

The nominal four-second sequence took 10.8–20.0 seconds to finish at 2,000 notes in the current app, versus 4.07 seconds in the prototype. Synthetic timer lateness accumulates when the test cannot keep up: these durations demonstrate starvation, not measured physical keyboard-to-speaker latency. The synchronous note handlers themselves usually took below 1 ms. CPU sampling at 500 notes showed extensive React/piano-roll work and approximately 423 ms of garbage collection in the first run.

These are diagnostic runs on one machine, with profiling and mutation-observer overhead. Seed notes share a pitch and are inserted in a burst; this isolates note-count scaling rather than reproducing the exact timing and layout of a real performance. No hardware loopback, Safari, mobile, or external MIDI latency measurement was performed.

## 1. Isolate the editor from live playing

Relevant locations:

- `src/components/instrument/Instrument.tsx:107`: Buffer always mounts; `hidden` only changes its visibility.
- `src/hooks/useInstrument.ts:14`: every controller publication updates the top-level instrument state.
- `src/components/instrument/RecordedBuffer.tsx:65`: a 50 ms interval refreshes on recording revision changes even when Buffer is hidden.
- `src/components/instrument/RecordedBuffer.tsx:317`: every render recreates the full piano-roll value array and every note object.

Each note-on/off therefore causes the whole instrument, including the hidden editor and unchanged parameter controls, to render. Recording updates trigger additional editor renders. The piano roll mounts a note, two resize handles, and a velocity control for every recorded event. Fresh values and callbacks propagate through its contexts and subscriptions. CSS hiding does not prevent that React work.

Recommended production change: separate persistent recording/transport/session state from the editor view. Mount the expensive view only when visible, refresh it on entry, and memoize components with stable inputs. Preserve loop range, zoom, scroll, selection, Space playback, live capture, and background overdubbing outside the unmounted view. Simply conditionally mounting the current entire `RecordedBuffer` would run its cleanup and stop playback.

For the visible editor, keep note data stable between real edits, isolate playhead animation from note-list rendering, and render only notes intersecting the viewport. Selection/export/transport must still operate on the complete recording. Validate that integration against the piano-roll library's full-value and selection expectations.

## 2. Remove full-recording work from frequent updates

`src/instrument/recording.ts:93` clones all notes for every snapshot. `extent()` at line 103 calls that snapshot and allocates another array just to compute a maximum. `RecordedBuffer` calls it during render and transport refreshes. Other `map` plus spread-to-`Math.max`/`Math.min` operations add repeated scans and can hit argument-count limits on very large recordings.

Maintain the completed recording extent as a scalar and examine only pending notes for the growing held-note extent. Preserve the existing intentional retained trailing duration until Fit/trim. Cache immutable completed-note snapshots by revision; update only pending/edited notes and retain unchanged editor-value identities. Replace large spread operations with reductions. Hidden, stopped capture should append/end notes without making a display snapshot.

These changes address allocation and scaling; optimizing the 50-key mapping lookup first would miss the dominant cost.

## 3. Reduce audio cost and assess fixed latency separately

`src/audio.ts:31` forces the entire graph to 192 kHz. Its soft clipper additionally uses 4× oversampling at line 86. There are two oscillators, a filter, gains, and a stereo panner per voice, followed by two dynamics processors and two waveshapers.

An offline benchmark of the actual graph, rendering four seconds of eight held voices, produced:

| Graph sample rate | Median render time, four runs |
| --- | ---: |
| 48 kHz | 65.45 ms |
| 192 kHz | 261.8 ms |

This is about 4× the audio processing cost. It does not mean a fourfold improvement in physical latency or total app CPU. The hidden-editor experiment already removed the severe scaling failure without changing audio.

Use the output device's preferred sample rate by omitting the forced sample rate; retain oversampling only at the nonlinear stage if listening and spectral tests justify it. `new AudioContext({ latencyHint: 'interactive' })` makes intent explicit, but interactive is already the default, so adding that option alone is not an optimization. These defaults are specified in [Web Audio AudioContextOptions](https://www.w3.org/TR/webaudio-1.1/#AudioContextOptions).

The compressor and limiter are both `DynamicsCompressorNode`s. They have fixed look-ahead delay, even with attack set to zero, as described in [Web Audio dynamics processing](https://www.w3.org/TR/webaudio-1.1/#DynamicsCompressorNode-processing). An impulse injected directly into this app's mixer first exceeded an absolute sample amplitude of 1e-8 after 11.11 ms at 192 kHz and 13.83 ms at 48 kHz in Chromium. These are measured onset delays through the whole bus, including waveshapers, not isolated compressor delays or physical output latency.

Evaluate one dynamics stage instead of two while preserving the existing output ceiling and perceived loudness. A custom low-latency limiter is a later option if needed. The lower sample rate experiment reduced processing cost but increased this measured bus onset delay slightly; assess those tradeoffs independently. Re-run rendered peak/transient tests and listening checks before changing the sound chain. Existing audio tests explicitly assert the 192 kHz constructor option and graph topology and would need deliberate updates.

The default nine-millisecond exponential attack also shapes perceived responsiveness. It is an envelope characteristic, not main-thread scheduling latency. Likewise, eight voices with a 2.2-second release cause frequent tail stealing at 16 notes/second. Raising polyphony may retain tails but increases DSP cost; it does not fix input latency.

## 4. Give playback an audio-clock schedule

`src/instrument/transport.ts:40` dispatches due events from main-thread timers; `src/audio.ts:120` timestamps voices at the context's current time when the callback finally executes. `src/midi.ts:84` sends immediately without a timestamp. Timer delays consequently become audible playback jitter. The transport's 16 ms maximum polling interval is not an unconditional 16 ms delay: it also wakes at nearer event deadlines.

For recorded playback, schedule a short horizon of note-on and note-off events using audio-clock times, and timestamp MIDI output. Keep live input immediate. Decouple the visual playhead from this scheduler. Handle stop, seeking, loop changes, output changes, and edits by cancelling/reconciling already scheduled events. Preserve overlapping note ownership.

During overdubbing, `RecordedBuffer.tsx:113` calls transport update on each refresh; `transport.ts:96` rebuilds and sorts every edge. Held-note growth can repeat this every 50 ms. Update changed events incrementally, or at least avoid rebuilding completed events when only a pending duration grows. This path was identified from source; the quantitative benchmark above measures live playing with playback stopped.

## 5. Make visual feedback immediate and bounded

`src/styles/app.css:102` transitions a pressed computer key's background over 100 ms. That is longer than the 62.5 ms interval between notes at the tested speed. Set the active transition to zero and retain the release fade if desired.

Publish visual highlights at most once per animation frame, while recording and sending every audio/MIDI edge immediately. Account for presses and releases within the same frame so brief notes remain visible. Narrow subscriptions or memoized controls should keep unchanged knobs, port controls, and editor state out of the note path.

## Validation and artifacts

The original build and the isolated prototype both passed `npm run build`; the checker reported only the existing `keyCode` deprecation hints. Browser benchmarks reported no page errors. The prototype has not undergone the full behavior regression suite and is not proposed as a ready-to-merge patch.

Implementation acceptance checks should cover held-note ownership and retriggers, capture and Space playback with Buffer hidden, overdubs and loop edits, tab/viewport transitions, MIDI mode changes, and Strict Mode cleanup. Re-run the stress benchmark with long recordings and the editor both open and closed. For audio changes, validate the output ceiling, transients, timbre, and real keyboard-to-output latency separately.

Temporary reproducibility artifacts are in `/tmp/qwerkey-performance/`: `benchmark.mjs`, `audio-benchmark.mjs`, baseline/prototype JSON results, CPU profiles, and the experimental app copy under `variant/`. The UI script accepts `BENCH_URL`, `BENCH_LABEL`, and `BENCH_SIZES`; it defaults to the baseline preview at port 4173. The prototype preview used port 4174. Scripts use this checkout's absolute dependency paths and require its Playwright Chromium installation. They can be rerun after starting the corresponding Astro preview servers.


## Implemented responsiveness changes

The production implementation now suspends hidden editor children and display refreshes, memoizes unchanged controls and roll values, caches completed recording snapshots, calculates extent from pending notes without a full snapshot, and animates the playhead outside React. Offscreen note and velocity controls are omitted with horizontal overscan; selected notes remain mounted. Highlight notifications are coalesced to animation frames and active key coloring is immediate. The context now uses the preferred device rate while preserving the existing dynamics and output ceiling.

The production benchmark (`BENCH_LABEL=implemented npm run benchmark`, same method as above) measured:

| Seeded notes | Main-thread task time / observed time | Median frame interval | Long tasks | Hidden editor mutations |
| --- | ---: | ---: | ---: | ---: |
| 0 | 769 / 4,072 ms (19%) | 16.7 ms | 0 | 0 |
| 500 | 639 / 4,070 ms (16%) | 16.7 ms | 0 | 0 |
| 2,000 | 777 / 4,072 ms (19%) | 16.7 ms | 0 | 0 |

Chromium selected 48 kHz. At 2,000 notes, p95 synthetic callback lateness was 2.55 ms. These results are browser scheduling measurements, not physical audio latency. The 500-note measurement included CPU profiling; future runs enable that separately with `BENCH_PROFILE=1`. Start `npm run preview -- --host 127.0.0.1 --port 4173 --ignore-lock` before running the benchmark. Results are written under `/tmp/qwerkey-performance`.

Audio-clock look-ahead scheduling and dynamics simplification have not been implemented. The existing transport remains timer-driven. Safari, hardware MIDI, physical loopback latency, and listening checks remain unverified.
