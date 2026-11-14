import type { Controller, Snapshot } from '../../instrument/controller';
export default function MidiPorts({ state, controller }: {state: Snapshot; controller: Controller | null}) {
  return <div className="midi_ports" hidden={state.mode !== 'midi'}>{(['input', 'output'] as const).map(direction => {
    const ports = direction === 'input' ? state.ports.inputs : state.ports.outputs;
    const selected = direction === 'input' ? state.ports.inputId : state.ports.outputId;
    return <div className="midi_port" key={direction}><label htmlFor={`midi-${direction}`}>{direction === 'input' ? 'IN' : 'OUT'}</label><span className="midi_select">
      <select id={`midi-${direction}`} value={selected} onChange={event => direction === 'input' ? controller?.selectInput(event.target.value) : controller?.selectOutput(event.target.value)}>
        <option value="">-- Choose MIDI port --</option>{ports.map(port => <option key={port.id} value={port.id}>{port.name || port.id}</option>)}
      </select></span></div>;
  })}</div>;
}
