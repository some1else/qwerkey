# Six-voice headroom

The audio path is voice envelopes/panners → submix → bus compressor → master
makeup → limiter → soft clip → sample ceiling → destination. The AudioContext
uses `latencyHint: 'interactive'` and the device sample rate. A parallel hall
send branches from master makeup, filters to 180–4500 Hz, and returns through
the limiter at gain 0.1. Its stereo impulse lasts 2.4 seconds with 20 ms predelay;
the dry signal has no added reverb delay. The compressor and
latency hint were already configured; this change adds submix headroom and
repeatable measurements.

A second parallel send from master makeup adds symmetric tanh saturation with
1.5 drive and 4× oversampling. Its return gain is 0.06, keeping the saturation
subtle. The dry mix, saturation return, and hall return all meet before the
limiter and sample ceiling.

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
