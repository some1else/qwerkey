import { test, expect } from '@playwright/test';

// Observe the actual native graph and envelope schedule at a fixed audio time.
async function openSynth(page) {
  await page.addInitScript(() => {
    window.AudioContext = function () {
      const context = new OfflineAudioContext(1, 48000, 48000);
      Object.defineProperty(context, 'state', { get: () => 'running' });
      context.resume = async () => {};
      return context;
    };
    window.oscillators = [];
    window.filters = [];
    window.ramps = [];
    window.stops = [];
    const stop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.stop = function (time) {
      window.stops.push({ index: window.oscillators.indexOf(this), time });
      return stop.call(this, time);
    };
    // Offline contexts do not apply automation until rendering starts.
    window.parameterValues = new WeakMap();
    const setValue = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (value, time) {
      window.parameterValues.set(this, value);
      return setValue.call(this, value, time);
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.oscillators.push(this);
      return start.apply(this, args);
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (this instanceof BiquadFilterNode) {
        window.filters.push(this);
        window.voiceGain = destination.gain;
      }
      return connect.call(this, destination, ...args);
    };
    const ramp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
      window.ramps.push({ value, time });
      return ramp.call(this, value, time);
    };
  });
  await page.goto('./');
  await page.locator('#enabler').click();
}

test.afterEach(async ({ page }) => { expect(await page.pageErrors()).toEqual([]); });

test('tracks each chord note and tunes oscillator and classic Q while held', async ({ page }) => {
  await openSynth(page);
  await page.locator('.piano_keys .key').evaluateAll(keys => {
    for (const key of keys) key.setPointerCapture = () => {};
  });
  for (const pitch of [69, 81]) {
    await page.locator(`.piano_keys .key_${pitch}`).dispatchEvent('pointerdown', { button: 0, pointerId: pitch });
  }
  const graph = () => page.evaluate(() => ({
    oscillators: window.oscillators.map(node => [node.type, node.frequency.value]),
    filters: window.filters.map(node => [node.type, window.parameterValues.get(node.frequency), window.parameterValues.get(node.Q)]),
  }));
  let actual = await graph();
  expect(actual.oscillators).toEqual([['triangle', 440], ['triangle', 880]]);
  expect(actual.filters.map(node => node.slice(0, 2))).toEqual([['lowpass', 440], ['lowpass', 880]]);
  for (const filter of actual.filters) expect(filter[2]).toBeCloseTo(20 * Math.log10(0.7), 5);
  await page.locator('#frequency').fill('880');
  await page.locator('#resonance').fill('2');
  for (const oscillator of ['triangle', 'sawtooth', 'square']) {
    await page.locator('#oscillator').selectOption(oscillator);
    actual = await graph();
    expect(actual.oscillators.map(node => node[0])).toEqual([oscillator, oscillator]);
  }
  expect(actual.filters.map(node => node[1])).toEqual([880, 1760]);
  for (const filter of actual.filters) expect(filter[2]).toBeCloseTo(20 * Math.log10(2), 5);
  // Invalid edits leave the last usable sound intact.
  for (const value of ['', '0', '-1', '999999']) await page.locator('#frequency').fill(value);
  expect((await graph()).filters).toEqual(actual.filters);
  await page.locator('#resonance').fill('0');
  expect((await graph()).filters).toEqual(actual.filters);
});

test('uses the requested defaults and holds sustain at relative dB until release', async ({ page }) => {
  await openSynth(page);
  await expect(page.locator('#oscillator')).toHaveValue('triangle');
  for (const [id, value] of [['voices', '8'], ['attack', '9'], ['decay', '1800'], ['sustain', '-12'], ['release', '2200'], ['frequency', '440'], ['resonance', '0.7']]) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  await expect(page.getByLabel('S (dB)', { exact: true })).toBeVisible();
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  const ramps = await page.evaluate(() => window.ramps);
  expect(ramps).toHaveLength(3);
  for (const [index, time] of [0, .009, 1.809].entries()) {
    expect(ramps[index].time).toBeCloseTo(time, 3);
  }
  expect(ramps[1].value).toBeCloseTo(.33);
  expect(ramps[2].value).toBeCloseTo(.33 * 10 ** (-12 / 20), 6);
  // Move beyond the old automatic sustain timeout before releasing.
  await page.evaluate(() => {
    Object.defineProperty(window.oscillators[0].context, 'currentTime', { get: () => 120 });
  });
  await page.keyboard.up('y');
  const result = await page.evaluate(() => ({
    release: window.ramps.at(-1),
    gain: window.parameterValues.get(window.voiceGain),
  }));
  expect(result.release.time).toBeCloseTo(122.2);
  expect(result.release.value).toBe(.0001);
  expect(result.gain).toBeCloseTo(.33 * 10 ** (-12 / 20), 6);
});

test('converts edited sustain dB to amplitude and releases during attack', async ({ page }) => {
  await openSynth(page);
  for (const [id, value] of [['attack', '20'], ['decay', '80'], ['sustain', '-6'], ['release', '50']]) {
    await page.locator(`#${id}`).fill(value);
  }
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  const ramps = await page.evaluate(() => window.ramps);
  expect(ramps).toHaveLength(3);
  expect(ramps[1].time).toBeCloseTo(.02, 3);
  expect(ramps[2].time).toBeCloseTo(.1, 3);
  expect(ramps[2].value).toBeCloseTo(.33 * 10 ** (-6 / 20), 6);
  await page.keyboard.up('y');
  const release = await page.evaluate(() => window.ramps.at(-1));
  expect(release.time).toBeCloseTo(.05);
  expect(release.value).toBe(.0001);
});

test('shows audio controls below keys, preserves settings across modes, and isolates text entry', async ({ page }) => {
  await openSynth(page);
  const controls = page.getByRole('group', { name: 'Audio parameters' });
  await expect(controls).toBeVisible();
  const piano = await page.locator('.piano_keys').boundingBox();
  const box = await controls.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(piano.y + piano.height);
  await page.locator('#frequency').fill('880');
  await page.keyboard.press('y');
  expect(await page.evaluate(() => window.oscillators.length)).toBe(0);
  await page.locator('#midi-mode').click();
  await expect(controls).toBeHidden();
  await expect(page.locator('.midi_ports')).toBeVisible();
  await page.locator('#audio-mode').click();
  await expect(controls).toBeVisible();
  await expect(page.locator('#frequency')).toHaveValue('880');
  await page.setViewportSize({ width: 667, height: 800 });
  const mobileBox = await controls.boundingBox();
  expect(mobileBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(667);
  await page.screenshot({ path: '/tmp/qwerkey-parameters.png', fullPage: true });
});


test('limits polyphony, prefers release tails, and applies lower limits immediately', async ({ page }) => {
  await openSynth(page);
  await page.locator('.piano_keys .key').evaluateAll(keys => {
    for (const key of keys) key.setPointerCapture = () => {};
  });
  const press = pitch => page.locator(`.piano_keys .key_${pitch}`).dispatchEvent('pointerdown', { button: 0, pointerId: pitch });
  const release = pitch => page.locator(`.piano_keys .key_${pitch}`).dispatchEvent('pointerup', { pointerId: pitch });
  for (let pitch = 60; pitch < 68; pitch++) await press(pitch);
  expect(await page.evaluate(() => window.stops)).toEqual([]);
  await press(68);
  expect(await page.evaluate(() => window.stops)).toEqual([{ index: 0, time: .005 }]);
  // Key-up for a stolen note cannot release a different voice.
  await release(60);
  expect(await page.evaluate(() => window.stops.length)).toBe(1);
  await release(65);
  await press(69);
  expect(await page.evaluate(() => window.stops.map(stop => stop.index))).toEqual([0, 5, 5]);
  await page.locator('#voices').fill('2');
  expect(await page.evaluate(() => window.stops.map(stop => stop.index))).toEqual([0, 5, 5, 1, 2, 3, 4, 6, 7]);
  for (const value of ['', '0', '1.5', '65']) await page.locator('#voices').fill(value);
  expect(await page.evaluate(() => window.stops.length)).toBe(9);
  await press(70);
  expect(await page.evaluate(() => window.stops.at(-1).index)).toBe(8);
  await page.locator('#voices').fill('4');
  await press(71);
  await press(72);
  expect(await page.evaluate(() => window.stops.length)).toBe(10);
});
