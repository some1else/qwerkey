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

// Six coherent voices at MIDI velocity 127 sum to nearly full scale before
// filtering (velocity 64 is unity). Reserve another 6 dB at the submix for
// waveform/filter transients; resonant overloads reach the bus dynamics.
const voiceLevel = 1 / 12;
const submixGain = 0.5;
// Master makeup after the bus compressor (+4 dB), before output protection.
const makeupGain = 1.6;
// Use the device rate; oversample only the nonlinear soft clipper.
function createContext(): AudioContext {
  return new AudioContext({ latencyHint: 'interactive' });
}

function softClipCurve(peak: number): Float32Array<ArrayBuffer> {
  const knee = 10 ** (-3 / 20);
  const range = peak - knee;
  // Scale the tanh shoulder so full-scale input lands exactly on the peak.
  const fullScale = Math.tanh((1 - knee) / range);
  const curve = new Float32Array(4096);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    // Linear below the knee, then a smooth tanh shoulder up to the peak.
    const y = magnitude <= knee
      ? magnitude
      : knee + range * Math.tanh((magnitude - knee) / range) / fullScale;
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function createHallImpulse(context: AudioContext): AudioBuffer {
  const duration = 2.4;
  const preDelay = 0.02;
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * duration), context.sampleRate);
  // Independent, repeatable stereo diffusion; no external impulse download.
  let seed = 12345;
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    for (let i = Math.ceil(preDelay * context.sampleRate); i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const time = i / context.sampleRate - preDelay;
      const fadeIn = Math.min(1, time / 0.03);
      samples[i] = (seed / 2 ** 31 - 1) * fadeIn * Math.exp(-6.9 * time / (duration - preDelay));
    }
  }
  return impulse;
}

function saturationCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = i * 2 / (curve.length - 1) - 1;
    // Symmetric soft saturation adds gentle odd harmonics without a DC offset.
    curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5);
  }
  return curve;
}

function createMixer(context: AudioContext): GainNode {
  const mixer = context.createGain();
  mixer.gain.value = submixGain;

  const compressor = context.createDynamicsCompressor();
  // A low threshold evens out chord density so makeup can lift single notes.
  compressor.threshold.value = -30;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;

  const makeup = context.createGain();
  makeup.gain.value = makeupGain;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0;
  limiter.release.value = 0.05;

  const peak = 10 ** (-1 / 20);
  // DynamicsCompressorNode has a finite ratio and can overshoot. An
  // oversampled soft clip rounds those overshoots off with little aliasing.
  const softClip = context.createWaveShaper();
  softClip.curve = softClipCurve(peak);
  softClip.oversample = '4x';

  // Oversampling's resampling filters can ring past the soft clip's peak, so a
  // final non-oversampled hard clamp (WaveShaper clamps inputs outside [-1, 1]
  // to the curve endpoints) guarantees a -1 dBFS sample ceiling.
  const ceiling = context.createWaveShaper();
  ceiling.curve = new Float32Array([-peak, 0, peak]);
  ceiling.oversample = 'none';

  mixer.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(limiter);
  // A subtle parallel saturation send on the shared mix, alongside reverb.
  const saturation = context.createWaveShaper();
  saturation.curve = saturationCurve();
  saturation.oversample = '4x';
  const saturationReturn = context.createGain();
  saturationReturn.gain.value = 0.06;
  makeup.connect(saturation);
  saturation.connect(saturationReturn);
  saturationReturn.connect(limiter);
  // A quiet, dark hall return alongside the dry master. Both paths pass
  // through the output protection, and the dry attack stays immediate.
  const reverbHighpass = context.createBiquadFilter();
  // Feed a mono room send into the stereo impulse so even hard-panned notes
  // excite both sides of the hall.
  reverbHighpass.channelCount = 1;
  reverbHighpass.channelCountMode = 'explicit';
  reverbHighpass.type = 'highpass';
  reverbHighpass.frequency.value = 180;
  reverbHighpass.Q.value = 0.7;
  const reverbLowpass = context.createBiquadFilter();
  reverbLowpass.type = 'lowpass';
  reverbLowpass.frequency.value = 4500;
  reverbLowpass.Q.value = 0.7;
  const hall = context.createConvolver();
  hall.buffer = createHallImpulse(context);
  const wet = context.createGain();
  wet.gain.value = 0.1;
  makeup.connect(reverbHighpass);
  reverbHighpass.connect(reverbLowpass);
  reverbLowpass.connect(hall);
  hall.connect(wet);
  wet.connect(limiter);
  limiter.connect(softClip);
  softClip.connect(ceiling);
  ceiling.connect(context.destination);
  return mixer;
}

function startVoice(context: AudioContext, output: AudioNode, frequency: number, settings: SynthParameters, onEnded: () => void, velocity = 64): Voice {
  const oscillators = [-1, 1].map(direction => {
    const oscillator = context.createOscillator();
    oscillator.type = settings.oscillator;
    oscillator.frequency.value = frequency;
    return { oscillator, direction };
  });
  // The coherent unison pair has the same level as the original single voice.
  const unison = context.createGain();
  unison.gain.value = 0.5;
  const panner = context.createStereoPanner();
  const rootNote = 69 + 12 * Math.log2(frequency / 440);
  // Spread the visible piano (MIDI 41–96) across the stereo field, clamping
  // notes received outside that range to the nearest edge.
  panner.pan.value = Math.max(-1, Math.min(1, (rootNote - 68.5) / 27.5));
  const gain = context.createGain();
  const now = context.currentTime;
  // A/D/R are milliseconds; S is amplitude in dB relative to the attack peak.
  const attack = settings.attack / 1000;
  const decay = settings.decay / 1000;
  const release = settings.release / 1000;
  // Reduce the upper register by 3 dB per octave above A4, up to 12 dB.
  // Apply it to the whole envelope so velocity and sustain stay proportional.
  const highNoteDb = Math.min(12, Math.max(0, rootNote - 69) * 3 / 12);
  const volume = voiceLevel * velocity / 64 * 10 ** (-highNoteDb / 20);
  const sustain = volume * 10 ** (settings.sustain / 20);
  // Tiny offsets keep zero-duration envelope stages ordered.
  const points = [
    { time: now, value: 0.0001 },
    { time: now + attack + 0.00001, value: volume },
    { time: now + attack + decay + 0.00002, value: sustain },
  ];
  gain.gain.value = 0.0001;
  for (const point of points) gain.gain.exponentialRampToValueAtTime(point.value, point.time);

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  function tune(parameters: SynthParameters) {
    for (const { oscillator } of oscillators) oscillator.type = parameters.oscillator;
    // 440 is unity key tracking: every voice follows its own root frequency.
    filter.frequency.setValueAtTime(Math.min(context.sampleRate / 2, frequency * parameters.frequency / 440), context.currentTime);
    // Lowpass Q is expressed in dB by Web Audio; expose traditional linear Q.
    filter.Q.setValueAtTime(20 * Math.log10(parameters.resonance), context.currentTime);
  }
  tune(settings);
  for (const { oscillator } of oscillators) oscillator.connect(unison);
  unison.connect(filter);
  filter.connect(gain);
  gain.connect(panner);
  panner.connect(output);
  let ended = false;
  let releasing = false;
  let remaining = oscillators.length;
  for (const { oscillator, direction } of oscillators) {
    oscillator.onended = () => {
      oscillator.disconnect();
      if (--remaining > 0) return;
      ended = true;
      unison.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
      onEnded();
    };
    oscillator.start(now);
    // Stay in unison through attack, then spread over the ADSR decay.
    oscillator.frequency.setValueAtTime(frequency, points[1]!.time);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 2 ** (direction * 5 / 1200), points[2]!.time);
  }

  return {
    tune,
    steal() {
      if (ended) return;
      // Fade briefly when reusing a slot, including a voice already releasing.
      const time = context.currentTime;
      gain.gain.cancelAndHoldAtTime(time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.005);
      for (const { oscillator } of oscillators) oscillator.stop(time + 0.005);
    },
    release() {
      if (ended || releasing) return;
      releasing = true;
      const time = context.currentTime;
      let value = sustain;
      let previous = points[0]!;
      for (const point of points.slice(1)) {
        if (time <= point.time) {
          const fraction = Math.max(0, (time - previous.time) / (point.time - previous.time));
          value = previous.value * (point.value / previous.value) ** fraction;
          break;
        }
        previous = point;
      }
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(value, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
      const decayProgress = Math.max(0, Math.min(1,
        (time - points[1]!.time) / (points[2]!.time - points[1]!.time)));
      for (const { oscillator, direction } of oscillators) {
        // Early note-off continues from the current decay detuning.
        // Frequency stays positive for exponential ramps in either direction.
        oscillator.frequency.cancelAndHoldAtTime(time);
        oscillator.frequency.setValueAtTime(frequency * 2 ** (direction * 5 * decayProgress / 1200), time);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 2 ** (direction * 10 / 1200), time + release);
        oscillator.stop(time + release);
      }
    },
  };
}

export function createSynth() {
  let parameters = { ...defaultParameters };
  let context: AudioContext | undefined;
  let mixer: GainNode | undefined;
  const heldNotes = new Map<number, Voice>();
  const activeVoices = new Set<Voice>();
  let disposed = false;

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
    if (disposed) return;
    if (!context) {
      context = createContext();
      mixer = createMixer(context);
    }
    await context.resume();
    if (disposed) return;
    if (context.state !== 'running') throw new Error('Audio is suspended');
  }

  function play(key: number, frequency: number, velocity = 64) {
    if (!context || !mixer || context.state !== 'running' || heldNotes.has(key)) return;
    while (activeVoices.size >= parameters.voices) stealOldest();
    const voice = startVoice(context, mixer, frequency, { ...parameters }, () => activeVoices.delete(voice), velocity);
    activeVoices.add(voice);
    heldNotes.set(key, voice);
  }

  function release(key: number) {
    heldNotes.get(key)?.release();
    heldNotes.delete(key);
  }

  function setParameters(next: Partial<SynthParameters>) {
    if (next.voices !== undefined && (!Number.isInteger(next.voices) || next.voices < 1 || next.voices > 32)) return;
    parameters = { ...parameters, ...next };
    while (activeVoices.size > parameters.voices) stealOldest();
    for (const voice of heldNotes.values()) voice.tune(parameters);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const voice of activeVoices) voice.steal();
    activeVoices.clear();
    heldNotes.clear();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  return { enable, play, release, setParameters, dispose };
}
