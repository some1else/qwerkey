interface VoiceSettings {
  volume: number;
  attack: number;
  decay: number;
  sustain: number;
  hold: number;
  release: number;
  filtered?: boolean;
}

interface Voice {
  release(): void;
}

const voices: VoiceSettings[] = [
  { volume: 0.66, attack: 0.005, decay: 0.2, sustain: 0, hold: 0, release: 0.05 },
  { volume: 0.42, attack: 0.01, decay: 0.1, sustain: 0.4, hold: 32, release: 0.15, filtered: true },
];

function createMixer(context: AudioContext): GainNode {
  const mixer = context.createGain();
  mixer.gain.value = 0.5;

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
  ceiling.oversample = 'none';

  mixer.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(context.destination);
  return mixer;
}

function startVoice(context: AudioContext, output: AudioNode, frequency: number, settings: VoiceSettings): Voice {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  const gain = context.createGain();
  const now = context.currentTime;
  const sustain = settings.volume * settings.sustain;
  // Match Wad's linear envelope, including the tiny timing offsets between stages.
  const points = [
    { time: now, value: 0.0001 },
    { time: now + settings.attack + 0.00001, value: settings.volume },
    { time: now + settings.attack + settings.decay + 0.00002, value: sustain },
    { time: now + settings.attack + settings.decay + settings.hold + 0.00003, value: sustain },
    { time: now + settings.attack + settings.decay + settings.hold + settings.release + 0.00004, value: 0.0001 },
  ];
  gain.gain.value = 0.0001;
  for (const point of points) gain.gain.linearRampToValueAtTime(point.value, point.time);

  let filter: BiquadFilterNode | undefined;
  if (settings.filtered) {
    filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = 6;
    filter.frequency.linearRampToValueAtTime(6, now);
    filter.frequency.linearRampToValueAtTime(2000, now + 3);
    oscillator.connect(filter);
    filter.connect(gain);
  } else {
    oscillator.connect(gain);
  }
  gain.connect(output);
  let ended = false;
  oscillator.onended = () => {
    ended = true;
    oscillator.disconnect();
    filter?.disconnect();
    gain.disconnect();
  };
  oscillator.start(now);
  oscillator.stop(now + settings.attack + settings.decay + settings.hold + settings.release + 0.00005);

  return {
    release() {
      if (ended) return;
      const time = context.currentTime;
      let value = 0.0001;
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
      gain.gain.linearRampToValueAtTime(0.0001, time + settings.release);
      oscillator.stop(time + settings.release);
    },
  };
}

export function createSynth() {
  let context: AudioContext | undefined;
  let mixer: GainNode | undefined;
  const heldNotes = new Map<number, Voice[]>();

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
    heldNotes.set(key, voices.map(settings => startVoice(context!, mixer!, frequency, settings)));
  }

  function release(key: number) {
    heldNotes.get(key)?.forEach(voice => voice.release());
    heldNotes.delete(key);
  }

  return { enable, play, release };
}
