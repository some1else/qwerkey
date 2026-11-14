import { memo } from 'react';
import type { Controller, Snapshot } from '../../instrument/controller';
function MidiPorts({ state, controller }: {state: Snapshot; controller: Controller | null}) {
  return <div className="midi_ports" hidden={state.mode !== 'midi'}>{(['input', 'output'] as const).map(direction => {
    const ports = direction === 'input' ? state.ports.inputs : state.ports.outputs;
    const selected = direction === 'input' ? state.ports.inputId : state.ports.outputId;
    return <div className="midi_port" key={direction}><label htmlFor={`midi-${direction}`}>{direction === 'input' ? 'IN' : 'OUT'}</label><span className="midi_select">
      <select id={`midi-${direction}`} value={selected} onChange={event => {
        if (direction === 'input') controller?.selectInput(event.target.value);
        else controller?.selectOutput(event.target.value);
        event.currentTarget.blur();
        event.currentTarget.closest<HTMLElement>('#instrument')?.focus({ preventScroll: true });
      }}>
        <option value="">-- Choose MIDI port --</option>{ports.map(port => <option key={port.id} value={port.id}>{port.name || port.id}</option>)}
      </select></span></div>;
  })}</div>;
}

export default memo(MidiPorts, (a, b) => a.controller === b.controller && a.state.mode === b.state.mode && a.state.ports === b.state.ports);
