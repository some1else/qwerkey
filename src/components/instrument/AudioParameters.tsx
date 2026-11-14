import { useEffect, useState } from 'react';
import type { SynthParameters } from '../../audio';
import { defaultParameters } from '../../audio';
import { fields } from '../../instrument/parameters';
import type { Controller } from '../../instrument/controller';
import { ParameterKnob, ParameterFader } from './ParameterControls';

type Field = (typeof fields)[number];
function Parameter({ field, value, controller }: { field: Field; value: number; controller: Controller | null }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const update = (next: number) => {
    controller?.setParameters({ [field.id]: next });
    setDraft(String(next));
  };
  const widget = { value, defaultValue: defaultParameters[field.id], min: field.min, max: field.max, step: field.step,
    label: `${field.title} control`, onValueChange: update };
  return <div className="audio_parameter" title={field.title}>
    <label htmlFor={field.id}>{field.label}</label>
    {field.id === 'voices' ? <div className="parameter_spacer" /> : field.id === 'sustain'
      ? <ParameterFader {...widget} />
      : <ParameterKnob {...widget} scale={field.id === 'frequency' || field.id === 'resonance' ? 'log' : 'linear'} />}
    <input id={field.id} type="number" min={field.min} max={field.max} step={field.step} value={draft}
      onInput={event => {
        const input = event.currentTarget;
        setDraft(input.value);
        if (input.validity.valid && Number.isFinite(input.valueAsNumber)) controller?.setParameters({ [field.id]: input.valueAsNumber });
      }} onBlur={() => setDraft(String(value))} onKeyDown={event => {
        if (event.key === 'Escape') { setDraft(String(value)); event.preventDefault(); }
      }} />
  </div>;
}
export default function AudioParameters({ hidden, controller, parameters }: {
  hidden: boolean; controller: Controller | null; parameters: Readonly<SynthParameters>;
}) {
  return <div className="audio_parameters" role="group" aria-label="Audio parameters" hidden={hidden}>
    <div className="audio_parameter oscillator_parameter"><label htmlFor="oscillator">Oscillator</label>
      <div className="parameter_spacer" />
      <select id="oscillator" aria-label="Oscillator" value={parameters.oscillator}
        onChange={event => controller?.setParameters({ oscillator: event.target.value as OscillatorType })}>
        <option value="sine">Sin</option><option value="triangle">Tri</option><option value="sawtooth">Saw</option><option value="square">Sqr</option>
      </select></div>
    {fields.map(field => <Parameter key={field.id} field={field} value={parameters[field.id]} controller={controller} />)}
  </div>;
}
