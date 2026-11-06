export interface MidiPorts {
  inputs: MIDIInput[];
  outputs: MIDIOutput[];
  inputId: string;
  outputId: string;
}

export function createMidi(
  onNote: (pitch: number, active: boolean) => void,
  onPorts: (ports: MidiPorts) => void = () => {},
) {
  let enabled = false;
  let access: MIDIAccess | undefined;
  let input: MIDIInput | undefined;
  let output: MIDIOutput | undefined;
  const incoming = new Set<number>();
  const outgoing = new Set<number>();

  function receiveMessage(event: MIDIMessageEvent) {
    if (!enabled) return;
    const data = event.data;
    if (!data || data.length !== 3) return;
    const [status, pitch, velocity] = data;
    if (status === undefined || pitch === undefined || velocity === undefined) return;
    const command = status & 0xf0;
    if (command === 0x90 || command === 0x80) {
      const active = command === 0x90 && velocity > 0;
      if (active) incoming.add(pitch);
      else incoming.delete(pitch);
      onNote(pitch, active);
    }
  }

  function publish() {
    onPorts({
      inputs: Array.from(access?.inputs.values() ?? []).filter(port => port.state !== 'disconnected'),
      outputs: Array.from(access?.outputs.values() ?? []).filter(port => port.state !== 'disconnected'),
      inputId: input?.id ?? '', outputId: output?.id ?? '',
    });
  }

  function selectInput(id: string) {
    if (input) input.onmidimessage = null;
    for (const pitch of incoming) onNote(pitch, false);
    incoming.clear();
    const next = access?.inputs.get(id);
    input = next?.state !== 'disconnected' ? next : undefined;
    if (input) input.onmidimessage = receiveMessage;
    publish();
  }

  function transmit(pitch: number, active: boolean) {
    if (!output || output.state === 'disconnected') return;
    try {
      output.send([active ? 0x90 : 0x80, pitch, 64]);
    } catch {
      // A port can become unavailable between discovery and sending.
    }
  }

  function selectOutput(id: string) {
    for (const pitch of outgoing) transmit(pitch, false);
    outgoing.clear();
    const next = access?.outputs.get(id);
    output = next?.state !== 'disconnected' ? next : undefined;
    publish();
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) { publish(); return; }
    try {
      access = await navigator.requestMIDIAccess();
      selectInput(Array.from(access.inputs.values()).find(port => port.state !== 'disconnected' && port.name === 'IAC Driver Qwerkey In')?.id ?? '');
      selectOutput(Array.from(access.outputs.values()).find(port => port.state !== 'disconnected' && port.name === 'IAC Driver Qwerkey Out')?.id ?? '');
      access.onstatechange = () => {
        if (input && (input.state === 'disconnected' || !access?.inputs.has(input.id))) selectInput('');
        if (output && (output.state === 'disconnected' || !access?.outputs.has(output.id))) selectOutput('');
        publish();
      };
    } catch {
      // Local keyboard interaction is available when MIDI permission is denied.
      publish();
    }
  }

  function setEnabled(value: boolean) {
    if (!value) {
      for (const pitch of outgoing) transmit(pitch, false);
      outgoing.clear();
      for (const pitch of incoming) onNote(pitch, false);
      incoming.clear();
    }
    enabled = value;
  }

  function sendNote(pitch: number, active: boolean) {
    if (!enabled) return;
    if (active) outgoing.add(pitch);
    else if (!outgoing.delete(pitch)) return;
    transmit(pitch, active);
  }

  return { connect, sendNote, selectInput, selectOutput, setEnabled };
}
