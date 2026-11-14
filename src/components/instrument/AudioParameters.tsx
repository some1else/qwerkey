import { defaultParameters } from '../../audio';
import type { Controller } from '../../instrument/controller';

const fields = [
  { id: 'voices', label: '# (Voices)', title: 'Maximum simultaneous voices', min: 1, max: 64, step: 1 },
  { id: 'attack', label: 'A (ms)', title: 'Attack duration', min: 0, max: 10000, step: 1 },
  { id: 'decay', label: 'D (ms)', title: 'Decay duration', min: 0, max: 10000, step: 1 },
  { id: 'sustain', label: 'S (dB)', title: 'Sustain level in decibels relative to the attack peak', min: -96, max: 0, step: 0.1 },
  { id: 'release', label: 'R (ms)', title: 'Release duration', min: 0, max: 10000, step: 1 },
  { id: 'frequency', label: 'Freq (Hz)', title: 'Lowpass cutoff: 440 follows the played note; 880 is one octave above', min: 1, max: 20000, step: 1 },
  { id: 'resonance', label: 'Reso (Q)', title: 'Lowpass resonance in classic Q', min: 0.1, max: 30, step: 0.1 },
] as const;

export default function AudioParameters({ hidden, controller }: { hidden: boolean; controller: Controller | null }) {
  return <div className="audio_parameters" role="group" aria-label="Audio parameters" hidden={hidden}>
    <label>Oscillator<select id="oscillator" aria-label="Oscillator" defaultValue={defaultParameters.oscillator}
      onChange={event => controller?.setParameters({ oscillator: event.target.value as OscillatorType })}>
      <option value="sine">Sin</option><option value="triangle">Tri</option><option value="sawtooth">Saw</option><option value="square">Sqr</option>
    </select></label>
    {fields.map(({ id, label, title, ...limits }) => <label key={id} htmlFor={id} title={title}>{label}
      <input id={id} type="number" {...limits} defaultValue={defaultParameters[id]} onInput={event => {
        // The browser retains draft text; only accepted numbers reach the engine.
        const input = event.currentTarget;
        if (input.validity.valid && Number.isFinite(input.valueAsNumber)) controller?.setParameters({ [id]: input.valueAsNumber });
      }} />
    </label>)}
  </div>;
}
