import { Knob } from '@audio-ui/react/knob';
import type { PointerEvent } from 'react';

type Props = { value: number; defaultValue: number; min: number; max: number; step: number;
  label: string; valueText?: string; onValueChange: (value: number) => void };
export function ParameterKnob({ label, valueText, scale, ...props }: Props & { scale: 'linear' | 'log' }) {
  function releaseFocus(event: PointerEvent<HTMLElement>) {
    const active = event.currentTarget.ownerDocument.activeElement;
    if (active instanceof HTMLElement && event.currentTarget.contains(active)) {
      active.blur();
      event.currentTarget.closest<HTMLElement>('#instrument')?.focus({ preventScroll: true });
    }
  }
  return <Knob.Root {...props} scale={scale} dragMode="vertical" className="parameter_knob"
    onPointerUp={releaseFocus} onPointerCancel={releaseFocus}>
    <Knob.Control className="knob_control">
      <Knob.Track className="knob_track" /><Knob.Indicator className="knob_indicator" />
      <Knob.Thumb className="knob_thumb" aria-label={label}
        getAriaValueText={valueText ? () => valueText : undefined}><span /></Knob.Thumb>
    </Knob.Control>
  </Knob.Root>;
}
