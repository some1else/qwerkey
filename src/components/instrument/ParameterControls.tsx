import { Knob } from '@audio-ui/react/knob';
import { Fader } from '@audio-ui/react/fader';

type Props = { value: number; defaultValue: number; min: number; max: number; step: number;
  label: string; onValueChange: (value: number) => void };
export function ParameterKnob({ label, scale, ...props }: Props & { scale: 'linear' | 'log' }) {
  return <Knob.Root {...props} scale={scale} dragMode="vertical" className="parameter_knob">
    <Knob.Control className="knob_control">
      <Knob.Track className="knob_track" /><Knob.Indicator className="knob_indicator" />
      <Knob.Thumb className="knob_thumb" aria-label={label}><span /></Knob.Thumb>
    </Knob.Control>
  </Knob.Root>;
}
export function ParameterFader({ label, ...props }: Props) {
  return <Fader.Root {...props} orientation="horizontal" className="parameter_fader">
    <Fader.Control className="fader_control"><Fader.Track className="fader_track"><Fader.Indicator className="fader_indicator" /></Fader.Track>
      <Fader.Thumb className="fader_thumb" aria-label={label} />
    </Fader.Control>
  </Fader.Root>;
}
