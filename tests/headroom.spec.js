import { test, expect } from '@playwright/test';
import { rolldown } from 'rolldown';

let harness;
test.beforeAll(async () => {
  const bundle = await rolldown({ input: 'src/audio.ts' });
  try {
    const result = await bundle.generate({ format: 'iife', name: 'audioHarness' });
    harness = result.output[0].code;
  } finally {
    await bundle.close();
  }
});

for (const sampleRate of [44100, 48000]) {
  test(`measures six-voice submix and output headroom at ${sampleRate} Hz`, async ({ page }, testInfo) => {
    await page.addScriptTag({ content: harness });
    const measurements = await page.evaluate(async sampleRate => {
      const results = [];
      const NativeAudioContext = window.AudioContext;
      const nativeConnect = AudioNode.prototype.connect;
      try {
        for (const oscillator of ['sine', 'triangle', 'sawtooth', 'square']) {
          for (const profile of ['chord', 'coherent-low', 'coherent-high', 'resonant']) {
            // Three stereo taps: submix, post-compressor makeup, final output.
            const context = new OfflineAudioContext(6, sampleRate * 3, sampleRate);
            Object.defineProperty(context, 'state', { get: () => 'running' });
            context.resume = async () => {};
            window.AudioContext = function () { return context; };
            const edges = [];
            AudioNode.prototype.connect = function (destination, ...args) {
              edges.push([this, destination]);
              return nativeConnect.call(this, destination, ...args);
            };
            const synth = audioHarness.createSynth();
            synth.setParameters({
              voices: 6, oscillator,
              ...(profile === 'chord' ? {} : {
                attack: 0, decay: 0, sustain: 0,
                frequency: profile === 'resonant' ? 440 : 20000,
                resonance: profile === 'resonant' ? 30 : 0.7,
              }),
            });
            await synth.enable();
            const pitches = profile === 'chord' ? [41, 45, 48, 52, 55, 60]
              : Array(6).fill(profile === 'coherent-high' ? 96 : 41);
            pitches.forEach((pitch, key) => synth.play(key, 440 * 2 ** ((pitch - 69) / 12), 127));
            AudioNode.prototype.connect = nativeConnect;

            const ceiling = edges.find(([, to]) => to === context.destination)[0];
            const softClip = edges.find(([, to]) => to === ceiling)[0];
            const limiter = edges.find(([, to]) => to === softClip)[0];
            const master = edges.find(([, to]) => to === limiter)[0];
            const compressor = edges.find(([, to]) => to === master)[0];
            const submix = edges.find(([, to]) => to === compressor)[0];
            ceiling.disconnect(context.destination);
            const merger = context.createChannelMerger(6);
            [submix, master, ceiling].forEach((node, index) => {
              const splitter = context.createChannelSplitter(2);
              node.connect(splitter);
              splitter.connect(merger, 0, index * 2);
              splitter.connect(merger, 1, index * 2 + 1);
            });
            merger.connect(context.destination);
            const buffer = await context.startRendering();
            const peaks = [0, 0, 0];
            let finite = true;
            for (let channel = 0; channel < 6; channel++) {
              for (const sample of buffer.getChannelData(channel)) {
                finite &&= Number.isFinite(sample);
                peaks[Math.floor(channel / 2)] = Math.max(peaks[Math.floor(channel / 2)], Math.abs(sample));
              }
            }
            results.push({ oscillator, profile, finite, peaks, dbFS: peaks.map(peak => 20 * Math.log10(peak)) });
          }
        }
      } finally {
        window.AudioContext = NativeAudioContext;
        AudioNode.prototype.connect = nativeConnect;
      }
      return results;
    }, sampleRate);
    await testInfo.attach('six-voice-headroom', {
      body: JSON.stringify({ sampleRate, taps: ['submix', 'master', 'output'], measurements }, null, 2),
      contentType: 'application/json',
    });
    for (const oscillator of ['sine', 'triangle', 'sawtooth', 'square']) {
      const low = measurements.find(row => row.oscillator === oscillator && row.profile === 'coherent-low');
      const high = measurements.find(row => row.oscillator === oscillator && row.profile === 'coherent-high');
      // Compare actual audio before bus compression can compensate for level.
      expect(high.peaks[0], oscillator).toBeLessThan(low.peaks[0] * 0.6);
    }
    for (const measurement of measurements) {
      expect(measurement.finite, JSON.stringify(measurement)).toBe(true);
      if (measurement.profile !== 'resonant') {
        // At least 3 dB of raw submix headroom, including oscillator/filter
        // overshoot, without relying on compression or the output ceiling.
        expect(measurement.peaks[0], JSON.stringify(measurement)).toBeLessThan(10 ** (-3 / 20));
        expect(measurement.peaks[1]).toBeLessThan(1);
      }
      expect(measurement.peaks[2]).toBeGreaterThan(0.01);
      expect(measurement.peaks[2]).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    }
  });
}
