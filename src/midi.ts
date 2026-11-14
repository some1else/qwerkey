export interface MidiPorts {
  inputs: MIDIInput[];
  outputs: MIDIOutput[];
  inputId: string;
  outputId: string;
}

export function createMidi(
  onNote: (
    pitch: number,
    active: boolean,
    channel?: number,
    velocity?: number,
    timestamp?: number,
  ) => void,
  onPorts: (ports: MidiPorts) => void = () => {},
) {
  let enabled = false;
  let disposed = false;
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
    if (
      status === undefined ||
      pitch === undefined ||
      velocity === undefined ||
      pitch > 127 ||
      velocity > 127
    )
      return;
    const command = status & 0xf0;
    if (command === 0x90 || command === 0x80) {
      const active = command === 0x90 && velocity > 0;
      if (active) incoming.add((status & 15) * 128 + pitch);
      else incoming.delete((status & 15) * 128 + pitch);
      const timestamp =
        event.timeStamp > 0 && event.timeStamp <= performance.now() + 1000
          ? event.timeStamp
          : performance.now();
      onNote(pitch, active, status & 15, velocity, timestamp);
    }
  }

  function publish() {
    onPorts({
      inputs: Array.from(access?.inputs.values() ?? []).filter(
        (port) => port.state !== "disconnected",
      ),
      outputs: Array.from(access?.outputs.values() ?? []).filter(
        (port) => port.state !== "disconnected",
      ),
      inputId: input?.id ?? "",
      outputId: output?.id ?? "",
    });
  }

  function selectInput(id: string) {
    if (input) input.onmidimessage = null;
    for (const pitch of incoming)
      onNote(pitch % 128, false, Math.floor(pitch / 128), 64);
    incoming.clear();
    const next = access?.inputs.get(id);
    input = next?.state !== "disconnected" ? next : undefined;
    if (input) input.onmidimessage = receiveMessage;
    publish();
  }

  function transmit(
    pitch: number,
    active: boolean,
    channel = 0,
    velocity = 64,
  ) {
    if (!output || output.state === "disconnected") return;
    try {
      output.send([(active ? 0x90 : 0x80) + channel, pitch, velocity]);
    } catch {
      // A port can become unavailable between discovery and sending.
    }
  }

  function selectOutput(id: string) {
    for (const pitch of outgoing)
      transmit(pitch % 128, false, Math.floor(pitch / 128));
    outgoing.clear();
    const next = access?.outputs.get(id);
    output = next?.state !== "disconnected" ? next : undefined;
    publish();
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      publish();
      return;
    }
    try {
      const result = await navigator.requestMIDIAccess();
      if (disposed) return;
      access = result;
      selectInput(
        Array.from(access.inputs.values()).find(
          (port) =>
            port.state !== "disconnected" &&
            port.name === "IAC Driver Qwerkey In",
        )?.id ?? "",
      );
      selectOutput(
        Array.from(access.outputs.values()).find(
          (port) =>
            port.state !== "disconnected" &&
            port.name === "IAC Driver Qwerkey Out",
        )?.id ?? "",
      );
      access.onstatechange = () => {
        if (
          input &&
          (input.state === "disconnected" || !access?.inputs.has(input.id))
        )
          selectInput("");
        if (
          output &&
          (output.state === "disconnected" || !access?.outputs.has(output.id))
        )
          selectOutput("");
        publish();
      };
    } catch {
      // Local keyboard interaction is available when MIDI permission is denied.
      if (!disposed) publish();
    }
  }

  function setEnabled(value: boolean) {
    if (!value) {
      for (const pitch of outgoing)
        transmit(pitch % 128, false, Math.floor(pitch / 128));
      outgoing.clear();
      for (const pitch of incoming)
        onNote(pitch % 128, false, Math.floor(pitch / 128), 64);
      incoming.clear();
    }
    enabled = value;
  }

  function sendNote(
    pitch: number,
    active: boolean,
    channel = 0,
    velocity = 64,
  ) {
    if (!enabled) return;
    if (active) outgoing.add(channel * 128 + pitch);
    else if (!outgoing.delete(channel * 128 + pitch)) return;
    transmit(pitch, active, channel, velocity);
  }

  function dispose() {
    if (disposed) return;
    setEnabled(false);
    disposed = true;
    if (input) input.onmidimessage = null;
    if (access) access.onstatechange = null;
    input = undefined;
    output = undefined;
  }

  return { connect, sendNote, selectInput, selectOutput, setEnabled, dispose };
}
