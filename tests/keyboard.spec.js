import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('request', request => {
    expect(new URL(request.url()).pathname).not.toMatch(/^\/lib\//);
  });
  await page.route('https://www.googletagmanager.com/**', route => route.abort());
  await page.goto('./');
});

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

test('renders the keyboards and concert A', async ({ page }) => {
  await expect(page.locator('.computer_keys .row')).toHaveCount(5);
  await expect(page.locator('.computer_keys .key')).toHaveCount(50);
  await expect(page.locator('.piano_keys .key')).toHaveCount(56);
  const a = page.locator('.computer_keys .key_6_3');
  await expect(a.locator('.note')).toHaveText('A 3');
  await expect(a.locator('.hz')).toHaveText('440 Hz');
});

test('highlights chords and releases individual notes', async ({ page }) => {
  await page.locator('#enabler').click();
  await page.keyboard.down('y');
  await page.keyboard.down('t');
  await expect(page.locator('.computer_keys .key_active')).toHaveCount(2);
  await expect(page.locator('.piano_keys .key_active')).toHaveCount(2);
  await page.keyboard.up('y');
  await expect(page.locator('.computer_keys .key_6_3')).not.toHaveClass(/key_active/);
  await expect(page.locator('.piano_keys .key_69')).not.toHaveClass(/key_active/);
  await expect(page.locator('.computer_keys .key_5_3')).toHaveClass(/key_active/);
  await page.keyboard.up('t');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.key_active')).toHaveCount(0);
});

test('resumes real audio and plays once per held key', async ({ page }) => {
  // Observe real oscillator creation and release envelope cancellation across both voices.
  await page.evaluate(() => {
    window.audioCalls = { starts: 0, stops: 0 };
    const start = OscillatorNode.prototype.start;
    const stop = AudioParam.prototype.cancelScheduledValues;
    OscillatorNode.prototype.start = function (...args) {
      window.audioCalls.starts++;
      return start.apply(this, args);
    };
    AudioParam.prototype.cancelScheduledValues = function (...args) {
      window.audioCalls.stops++;
      return stop.apply(this, args);
    };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = async function (...args) {
      await resume.apply(this, args);
      window.audioState = this.state;
    };
  });
  await page.locator('#enabler').click();
  await expect(page.locator('.overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.audioState)).toBe('running');
  await page.keyboard.down('y');
  await expect.poll(() => page.evaluate(() => window.audioCalls.starts)).toBe(2);
  await page.keyboard.down('y');
  expect(await page.evaluate(() => window.audioCalls.starts)).toBe(2);
  const stopsBeforeRelease = await page.evaluate(() => window.audioCalls.stops);
  await page.keyboard.up('y');
  await expect.poll(() => page.evaluate(() => window.audioCalls.stops)).toBeGreaterThan(stopsBeforeRelease);
});

test('preserves both voice envelopes and the lowpass sweep', async ({ page }) => {
  await page.evaluate(() => {
    window.ramps = [];
    window.pitches = [];
    const ramp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
      window.ramps.push([value, time]);
      return ramp.call(this, value, time);
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.pitches.push(this.frequency.value);
      return start.apply(this, args);
    };
  });
  await page.locator('#enabler').click();
  await page.keyboard.down('y');
  expect(await page.evaluate(() => window.pitches)).toEqual([440, 440]);
  const ramps = await page.evaluate(() => window.ramps);
  for (const value of [0.66, 0.42, 0.168, 6, 2000]) {
    expect(ramps.some(([actual]) => Math.abs(actual - value) < 0.000001)).toBe(true);
  }
  const filterStart = ramps.find(([value]) => value === 6)[1];
  const filterEnd = ramps.find(([value]) => value === 2000)[1];
  expect(filterEnd - filterStart).toBeCloseTo(3);
  await page.keyboard.up('y');
});

test('releases and cleans up old voices while a retrigger keeps playing', async ({ page }) => {
  await page.evaluate(() => {
    window.oscillators = [];
    window.endedOscillators = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.oscillators.push(this);
      this.addEventListener('ended', () => window.endedOscillators++);
      return start.apply(this, args);
    };
  });
  await page.locator('#enabler').click();
  await page.keyboard.down('y');
  await page.keyboard.up('y');
  await page.keyboard.down('y');
  await expect.poll(() => page.evaluate(() => window.oscillators.length)).toBe(4);
  // The old voices and new percussive voice finish. The new soft voice sustains.
  await expect.poll(() => page.evaluate(() => window.endedOscillators)).toBe(3);
  await expect(page.locator('.computer_keys .key_6_3')).toHaveClass(/key_active/);
  await page.keyboard.up('y');
  await expect.poll(() => page.evaluate(() => window.endedOscillators)).toBe(4);
});

test('clears the release highlight after three seconds', async ({ page }) => {
  await page.locator('#enabler').click();
  await page.clock.install();
  await page.keyboard.press('y');
  const key = page.locator('.computer_keys .key_6_3');
  await expect(key).toHaveClass(/key_inactive/);
  await page.clock.fastForward(3000);
  await expect(key).not.toHaveClass(/key_inactive/);
});

test('keeps the splash available to retry a failed audio start', async ({ page }) => {
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume;
    let attempts = 0;
    AudioContext.prototype.resume = function (...args) {
      if (++attempts === 1) return Promise.reject(new Error('Suspended'));
      return resume.apply(this, args);
    };
  });
  await page.locator('#enabler').click();
  await expect(page.locator('#enabler')).toHaveText('Audio could not start. Click to retry');
  await expect(page.locator('.overlay')).toBeVisible();
  await page.locator('#enabler').click();
  await expect(page.locator('.overlay')).toBeHidden();
});
