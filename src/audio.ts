export interface SynthParameters {
  oscillator: OscillatorType;
  voices: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  frequency: number;
  resonance: number;
}

export const defaultParameters: SynthParameters = {
  oscillator: 'triangle', voices: 8, attack: 9, decay: 1800, sustain: -12,
  release: 2200, frequency: 440, resonance: 0.7,
};

interface Voice {
  release(): void;
  steal(): void;
  tune(parameters: SynthParameters): void;
}

function createMixer(context: AudioContext): GainNode {
  const mixer = context.createGain();
  mixer.gain.value = 0.25;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0;
  limiter.release.value = 0.05;

  // DynamicsCompressorNode has a finite ratio and can overshoot. WaveShaper
  // clamps inputs outside [-1, 1] to the curve endpoints, guaranteeing a
  // -1 dBFS sample ceiling even during transients or extreme polyphony.
  const ceiling = context.createWaveShaper();
  const peak = 10 ** (-1 / 20);
  ceiling.curve = new Float32Array([-peak, 0, peak]);
  ceiling.oversample = '4x';

  mixer.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(context.destination);
  return mixer;
}

function startVoice(context: AudioContext, output: AudioNode, frequency: number, settings: SynthParameters, onEnded: () => void): Voice {
  const oscillator = context.createOscillator();
  oscillator.type = settings.oscillator;
  oscillator.frequency.value = frequency;
  const gain = context.createGain();
  const now = context.currentTime;
  // A/D/R are milliseconds; S is amplitude in dB relative to the attack peak.
  const attack = settings.attack / 1000;
  const decay = settings.decay / 1000;
  const release = settings.release / 1000;
  const volume = 0.33;
  const sustain = volume * 10 ** (settings.sustain / 20);
  // Tiny offsets keep zero-duration envelope stages ordered.
  const points = [
    { time: now, value: 0.0001 },
    { time: now + attack + 0.00001, value: volume },
    { time: now + attack + decay + 0.00002, value: sustain },
  ];
  gain.gain.value = 0.0001;
  for (const point of points) gain.gain.linearRampToValueAtTime(point.value, point.time);

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  function tune(parameters: SynthParameters) {
    oscillator.type = parameters.oscillator;
    // 440 is unity key tracking: every voice follows its own root frequency.
    filter.frequency.setValueAtTime(Math.min(context.sampleRate / 2, frequency * parameters.frequency / 440), context.currentTime);
    // Lowpass Q is expressed in dB by Web Audio; expose traditional linear Q.
    filter.Q.setValueAtTime(20 * Math.log10(parameters.resonance), context.currentTime);
  }
  tune(settings);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  let ended = false;
  oscillator.onended = () => {
    ended = true;
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
    onEnded();
  };
  oscillator.start(now);

  return {
    tune,
    steal() {
      if (ended) return;
      // Fade briefly when reusing a slot, including a voice already releasing.
      const time = context.currentTime;
      gain.gain.cancelAndHoldAtTime(time);
      gain.gain.linearRampToValueAtTime(0, time + 0.005);
      oscillator.stop(time + 0.005);
    },
    release() {
      if (ended) return;
      const time = context.currentTime;
      let value = sustain;
      let previous = points[0]!;
      for (const point of points.slice(1)) {
        if (time <= point.time) {
          const fraction = Math.max(0, (time - previous.time) / (point.time - previous.time));
          value = previous.value + fraction * (point.value - previous.value);
          break;
        }
        previous = point;
      }
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(value, time);
      gain.gain.linearRampToValueAtTime(0.0001, time + release);
      oscillator.stop(time + release);
    },
  };
}

export function createSynth() {
  let parameters = { ...defaultParameters };
  let context: AudioContext | undefined;
  let mixer: GainNode | undefined;
  const heldNotes = new Map<number, Voice>();
  const activeVoices = new Set<Voice>();

  function stealOldest() {
    const held = new Set(heldNotes.values());
    // Reuse release tails before interrupting notes still being held.
    const voice = Array.from(activeVoices).find(voice => !held.has(voice))
      ?? activeVoices.values().next().value;
    if (!voice) return;
    voice.steal();
    activeVoices.delete(voice);
    for (const [key, heldVoice] of heldNotes) {
      if (heldVoice === voice) heldNotes.delete(key);
    }
  }

  async function enable() {
    if (!context) {
      context = new AudioContext();
      mixer = createMixer(context);
    }
    await context.resume();
    if (context.state !== 'running') throw new Error('Audio is suspended');
  }

  function play(key: number, frequency: number) {
    if (!context || !mixer || context.state !== 'running' || heldNotes.has(key)) return;
    while (activeVoices.size >= parameters.voices) stealOldest();
    const voice = startVoice(context, mixer, frequency, { ...parameters }, () => activeVoices.delete(voice));
    activeVoices.add(voice);
    heldNotes.set(key, voice);
  }

  function release(key: number) {
    heldNotes.get(key)?.release();
    heldNotes.delete(key);
  }

  function setParameters(next: Partial<SynthParameters>) {
    if (next.voices !== undefined && (!Number.isInteger(next.voices) || next.voices < 1 || next.voices > 64)) return;
    parameters = { ...parameters, ...next };
    while (activeVoices.size > parameters.voices) stealOldest();
    for (const voice of heldNotes.values()) voice.tune(parameters);
  }

  return { enable, play, release, setParameters };
}
