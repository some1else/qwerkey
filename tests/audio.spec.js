import { test, expect } from '@playwright/test';

for (const sampleRate of [44100, 48000]) {
  test(`mixes every voice through dynamics and bounds output at ${sampleRate} Hz`, async ({ page }) => {
    await page.addInitScript(sampleRate => {
      // Render the app's actual audio graph deterministically, without speakers.
      window.AudioContext = function () {
        const context = new OfflineAudioContext(2, sampleRate * 4, sampleRate);
        Object.defineProperty(context, 'state', { get: () => 'running' });
        context.resume = async () => {};
        window.renderContext = context;
        return context;
      };
      window.connections = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        window.connections.push([this, destination]);
        return connect.call(this, destination, ...args);
      };
    }, sampleRate);
    await page.goto('./');
    await page.locator('#enabler').click();
    await expect(page.locator('.overlay')).toBeHidden();
    await page.locator('#voices').fill('64');
    await page.locator('.piano_keys .key').evaluateAll(keys => {
      keys.forEach((key, index) => {
        key.setPointerCapture = () => {};
        key.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, button: 0, pointerId: index + 1,
        }));
      });
    });
    const result = await page.evaluate(async () => {
      const context = window.renderContext;
      const edges = window.connections;
      const outputs = edges.filter(([, to]) => to === context.destination);
      const ceiling = outputs[0][0];
      const limiter = edges.find(([, to]) => to === ceiling)[0];
      const compressor = edges.find(([, to]) => to === limiter)[0];
      const mixer = edges.find(([, to]) => to === compressor)[0];
      const voiceInputs = edges.filter(([, to]) => to === mixer);
      const graph = {
        outputs: outputs.length,
        stages: [mixer, compressor, limiter, ceiling].map(node => node.constructor.name),
        voices: voiceInputs.length,
        voiceOutputs: voiceInputs.every(([voice]) => edges.filter(([from]) => from === voice).length === 1),
      };

      // An extreme positive/negative overload also exercises the safety ceiling
      // beyond what a finite-ratio compressor can contain on its own.
      const overload = context.createConstantSource();
      overload.offset.setValueAtTime(1e6, 3);
      overload.offset.setValueAtTime(-1e6, 3.05);
      overload.connect(mixer);
      overload.start(3);
      overload.stop(3.1);

      const buffer = await context.startRendering();
      let peak = 0;
      let minimum = 0;
      let chordPeak = 0;
      let finite = true;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          finite &&= Number.isFinite(samples[i]);
          peak = Math.max(peak, Math.abs(samples[i]));
          minimum = Math.min(minimum, samples[i]);
          if (i < buffer.sampleRate * 3) chordPeak = Math.max(chordPeak, Math.abs(samples[i]));
        }
      }
      return { graph, peak, minimum, chordPeak, finite };
    });
    expect(result.graph).toEqual({
      outputs: 1,
      stages: ['GainNode', 'DynamicsCompressorNode', 'DynamicsCompressorNode', 'WaveShaperNode'],
      voices: 56,
      voiceOutputs: true,
    });
    expect(result.finite).toBe(true);
    expect(result.chordPeak).toBeGreaterThan(0.05);
    expect(result.peak).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    expect(result.peak).toBeCloseTo(10 ** (-1 / 20), 5);
    expect(result.minimum).toBeCloseTo(-(10 ** (-1 / 20)), 5);
    expect(await page.pageErrors()).toEqual([]);
  });
}
