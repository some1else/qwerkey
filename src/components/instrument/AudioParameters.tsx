import type { SynthParameters } from '../../audio';
import { defaultParameters } from '../../audio';
import { fields } from '../../instrument/parameters';
import type { Controller } from '../../instrument/controller';
import { ParameterKnob } from './ParameterControls';

const waveforms = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square', label: 'Sqr' },
] as const;

type Field = (typeof fields)[number];
function Parameter({ field, value, controller }: { field: Field; value: number; controller: Controller | null }) {
  return <div id={field.id} className="audio_parameter" title={field.title}>
    <ParameterKnob value={value} defaultValue={defaultParameters[field.id]} min={field.min} max={field.max}
      step={field.step} label={`${field.title} control`}
      onValueChange={next => controller?.setParameters({ [field.id]: next })}
      scale={field.id === 'frequency' || field.id === 'resonance' ? 'log' : 'linear'} />
    <span className="parameter_label">{field.label}</span>
    <span className="parameter_value">{value}</span>
  </div>;
}
export default function AudioParameters({ hidden, controller, parameters }: {
  hidden: boolean; controller: Controller | null; parameters: Readonly<SynthParameters>;
}) {
  const oscillator = waveforms.findIndex(waveform => waveform.value === parameters.oscillator);
  return <div className="audio_parameters" role="group" aria-label="Audio parameters" hidden={hidden}>
    <div id="oscillator" className="audio_parameter oscillator_parameter" title="Oscillator waveform">
      <ParameterKnob value={oscillator} defaultValue={waveforms.findIndex(waveform => waveform.value === defaultParameters.oscillator)}
        min={0} max={waveforms.length - 1} step={1} scale="linear" label="Oscillator"
        valueText={parameters.oscillator}
        onValueChange={next => {
          const waveform = waveforms[next];
          if (waveform) controller?.setParameters({ oscillator: waveform.value });
        }} />
      <span className="parameter_label">Oscillator</span>
      <span className="parameter_value">{waveforms[oscillator]?.label}</span>
    </div>
    {fields.map(field => <Parameter key={field.id} field={field} value={parameters[field.id]} controller={controller} />)}
  </div>;
}
