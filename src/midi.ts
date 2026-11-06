export function createMidi(onNote: (pitch: number, active: boolean) => void) {
  let output: MIDIOutput | undefined;

  function receiveMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length !== 3) return;
    const [status, pitch, velocity] = data;
    if (status === undefined || pitch === undefined || velocity === undefined) return;
    const command = status & 0xf0;
    if (command === 0x90 || command === 0x80) {
      onNote(pitch, command === 0x90 && velocity > 0);
    }
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) return;
    try {
      const access = await navigator.requestMIDIAccess();
      const input = Array.from(access.inputs.values()).find(port => port.name === 'Qwerkey In');
      output = Array.from(access.outputs.values()).find(port => port.name === 'Qwerkey Out');
      if (input) input.onmidimessage = receiveMessage;
    } catch {
      // Local keyboard interaction is available when MIDI permission is denied.
    }
  }

  function sendNote(pitch: number, active: boolean) {
    if (!output || output.state === 'disconnected') return;
    try {
      output.send([active ? 0x90 : 0x80, pitch, 64]);
    } catch {
      // A port can become unavailable between discovery and sending.
    }
  }

  return { connect, sendNote };
}
