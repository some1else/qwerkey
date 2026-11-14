import { Knob } from '@audio-ui/react/knob';

type Props = { value: number; defaultValue: number; min: number; max: number; step: number;
  label: string; valueText?: string; onValueChange: (value: number) => void };
export function ParameterKnob({ label, valueText, scale, ...props }: Props & { scale: 'linear' | 'log' }) {
  return <Knob.Root {...props} scale={scale} dragMode="vertical" className="parameter_knob">
    <Knob.Control className="knob_control">
      <Knob.Track className="knob_track" /><Knob.Indicator className="knob_indicator" />
      <Knob.Thumb className="knob_thumb" aria-label={label}
        getAriaValueText={valueText ? () => valueText : undefined}><span /></Knob.Thumb>
    </Knob.Control>
  </Knob.Root>;
}
