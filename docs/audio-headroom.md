# Six-voice headroom

The audio path is voice envelopes/panners → submix → input gain → bus compressor → low shelf → high shelf → master
makeup → limiter → soft clip → sample ceiling → destination. The AudioContext
uses `latencyHint: 'interactive'` and the device sample rate. A parallel hall
send branches from master makeup, filters to 180–4500 Hz, and returns through
the limiter at gain 0.1. Its stereo impulse lasts 2.4 seconds with 20 ms predelay;
the dry signal has no added reverb delay. The compressor and
latency hint were already configured; this change adds submix headroom and
repeatable measurements.

A second parallel send from master makeup adds symmetric tanh saturation with
1.5 drive and 4× oversampling. Its default return gain is 0.06, keeping the saturation
subtle. The dry mix, saturation return, and hall return all meet before the
limiter and sample ceiling.

Warmth (%) scales the saturation return from 0 to 1; Space (%) scales the
hall return from 0 to 6 and the unison spread from zero to ±25 cents during
both decay and release. Both default to 25%, reproducing the original return
levels and ±5/±10-cent unison. Each amount scales linearly to its original
value at 25%, then linearly to its maximum at 100%. Return levels use a 15 ms
smoothing time constant. Saturation input drive stays at unity through 25%,
then rises to +30 dB at 100% for a crunchy sound; maximum reverb is wet-dominant.

Space also scales the keyboard pan: 0% centers every note, 25% preserves the
original left/right spread, and higher settings retain that spread.
Warmth scales high-note attenuation in dB: 0% disables it, 25% applies the
original 3 dB/octave above A4 (12 dB cap), and 100% quadruples those values.
Pan and attenuation changes use the same smoothing while notes are held.

Warmth also applies a calibrated output trim after summing the dry signal,
saturation, and reverb, before the limiter. Drive remains unchanged so the
crunch survives level matching. The trim stays at unity through the 25%
default, then reaches 0.6, 0.14, and 0.04 at 50%, 75%, and 100%, interpolated
in dB and smoothed. Steady-state triangle/square single-note and chord renders
measure a mean 2.4 dB rise from 0% to 100%, targeting roughly 3 dB of perceived
change. Individual notes and envelopes vary; this is calibrated gain
compensation rather than automatic loudness normalization.

Voice gain remains `1 / 12` at MIDI velocity 64. Six coherent voices at velocity
127 nearly reach full scale: the baseline measured peak was −0.07 dBFS. Submix
gain is now `0.5` (−6.02 dB), leaving room before compression. Master makeup
remains `1.6`; compression means the resulting output-level change depends on
the signal.

## Measurement

`tests/headroom.spec.js` renders the actual synth in Chromium OfflineAudioContext
at 44.1 and 48 kHz. Each three-second render captures stereo sample peaks at
the submix, master makeup, and final output. All six voices use MIDI velocity
127. Each scenario runs all four waveforms; the table reports the highest peak
across waveforms and both sample rates. These baseline figures precede the
hall return and upper-register attenuation: notes above A4 now fall by 3 dB per octave, capped
at 12 dB. The regression test also checks that the high-note submix remains
quieter than the low-note submix for every waveform.

| Scenario | Submix dBFS | Master dBFS | Output dBFS |
| --- | ---: | ---: | ---: |
| Chord, default envelope/filter | −9.94 | −4.39 | −4.82 |
| Six coherent low notes, open filter, full sustain | −6.09 | −3.03 | −3.43 |
| Six coherent high notes, open filter, full sustain | −6.09 | −3.80 | −4.23 |
| Six coherent low notes, Q 30, full sustain | +23.99 | +3.55 | −2.00 |

The chord uses MIDI notes 41, 45, 48, 52, 55, and 60. Coherent cases use six
independent voices at MIDI 41 or 96, with zero attack/decay and 0 dB sustain.
Normal resonance is Q 0.7; the stress case puts the cutoff at the fundamental
with maximum Q 30. Resonance can exceed full scale inside the floating-point
graph; the existing dynamics and ceiling protect the final output.

The tests require at least 3 dB of submix headroom in the normal-resonance cases,
finite samples throughout, and output no higher than −1 dBFS in every case.
They attach the individual measurements as JSON. These are sample-peak checks
for the specified scenarios, not a true-peak or exhaustive parameter sweep.

Validation: `npm run build` and
`npx playwright test tests/audio.spec.js tests/headroom.spec.js tests/parameters.spec.js --workers=2`
(18 tests passed).

## Additional sound controls

Brightness defaults to 0% and balances a 400 Hz low shelf against a 2 kHz
high shelf immediately after the bus compressor. At +100% their gains are
−24 dB and +24 dB; at −100% they reverse. Gains are always equal and opposite.
Native shelves provide smooth transitions (Q is unused for these filter types).
Gain changes use 15 ms smoothing.

Variance defaults to 0%. Each accepted internal-audio note-on consumes two independent
samples from a seeded 32-bit LCG. The first adds `(random - 0.5) * variance / 100 * 127`
to its velocity, clamped to 0–127. The second multiplies attack by
`1 + (random - 0.5) * variance / 100 * 0.5`, ranging from 75% to 125% of
the configured attack at 100% Variance. Zero attack stays zero; held notes
retain their original envelope. The envelope uses a tiny positive floor for
exponential automation. Seed defaults to 0, accepts integers 0–1000, and resets
the live-note sequence when changed. Playback hashes the seed and original
arrangement start (rounded to microseconds) before sampling velocity and attack.
Each note therefore repeats its jitter across loops, seeks, and clipped loop
boundaries, independent of live playing. Reverb diffusion uses its own independent seed.

Transpose defaults to 0 and accepts integer semitones from −24 to +24.
New notes start at the transposed pitch; held notes glide with 15 ms smoothing.
The lowpass cutoff tracks transposed pitch. Existing unison automation, key
ownership, keyboard pan, and MIDI output retain their original behavior.
Decay now spans 0–5000 ms, with its default remaining 900 ms.

Gain ranges from −12 to +12 dB in 0.1 dB steps, defaulting to 0 dB (unity).
It applies immediately before the mix compressor, after the fixed submix trim,
with 15 ms smoothing. This changes compressor drive as well as level.
