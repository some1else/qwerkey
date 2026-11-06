import { test, expect } from '@playwright/test';

async function observeAudio(page) {
  await page.evaluate(() => {
    window.audioCalls = { starts: 0, releases: 0 };
    const start = OscillatorNode.prototype.start;
    const release = AudioParam.prototype.cancelScheduledValues;
    OscillatorNode.prototype.start = function (...args) {
      window.audioCalls.starts++;
      return start.apply(this, args);
    };
    AudioParam.prototype.cancelScheduledValues = function (...args) {
      window.audioCalls.releases++;
      return release.apply(this, args);
    };
  });
  await page.locator('#enabler').click();
}

test.beforeEach(async ({ page }) => { await page.goto('./'); });
test.afterEach(async ({ page }) => { expect(await page.pageErrors()).toEqual([]); });

for (const [width, height] of [[375, 667], [666, 667], [667, 375], [668, 375], [1280, 800]]) {
  test(`uses at least 667px of page width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const enable = await page.locator('#enabler').boundingBox();
    expect(enable.x).toBeGreaterThanOrEqual(0);
    expect(enable.x + enable.width).toBeLessThanOrEqual(width);
    await page.locator('#enabler').click();
    if (width <= 667) await expect(page.locator('.mode_switch')).toBeHidden();
    else await expect(page.locator('.mode_switch')).toBeVisible();
    const instrument = await page.locator('#instrument').boundingBox();
    if (instrument.height <= height - 16) {
      expect(instrument.y + instrument.height / 2).toBeCloseTo(height / 2, 0);
    } else {
      expect(instrument.y).toBeGreaterThanOrEqual(0);
    }
    const layoutWidth = Math.max(667, width);
    const bounds = await page.locator('.computer_keys .key, .mode_switch').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    for (const box of bounds) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(layoutWidth);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layoutWidth);
    if (width < 667) {
      const keyWidth = await page.locator('.computer_keys .key').first().evaluate(element => element.getBoundingClientRect().width);
      await page.setViewportSize({ width: 667, height });
      expect(await page.locator('.computer_keys .key').first().evaluate(element => element.getBoundingClientRect().width)).toBe(keyWidth);
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(1000, 0));
      expect(await page.evaluate(() => window.scrollX)).toBe(667 - width);
      const last = await page.locator('.computer_keys .row_1 .key').last().boundingBox();
      expect(last.x + last.width).toBeLessThanOrEqual(width);
    }
    if (width === 375 || width === 667) await page.screenshot({ path: `/tmp/qwerkey-${width}.png`, fullPage: true });
  });
}

test('mouse press plays immediately and releases outside the key', async ({ page }) => {
  await observeAudio(page);
  const box = await page.locator('.computer_keys .key_6_3 .kc').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(await page.evaluate(() => window.audioCalls)).toEqual({ starts: 2, releases: 0 });
  await page.mouse.move(1, 1);
  await page.mouse.up();
  expect(await page.evaluate(() => window.audioCalls)).toEqual({ starts: 2, releases: 2 });
  await expect(page.locator('.key_active')).toHaveCount(0);
});

test('two real touch contacts form a chord and release independently', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto('./');
  await observeAudio(page);
  const client = await context.newCDPSession(page);
  const points = [];
  for (const [id, selector] of [[1, '.key_6_3'], [2, '.key_5_3']]) {
    const box = await page.locator(`.computer_keys ${selector}`).boundingBox();
    points.push({ id, x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await expect(page.locator('.piano_keys .key_active')).toHaveCount(2);
  expect(await page.evaluate(() => window.audioCalls)).toEqual({ starts: 4, releases: 0 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points[0]] });
  await expect(page.locator('.piano_keys .key_65')).toHaveClass(/key_active/);
  expect(await page.evaluate(() => window.audioCalls.releases)).toBe(2);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await page.evaluate(() => window.audioCalls.releases)).toBe(4);
  await expect(page.locator('.key_active')).toHaveCount(0);
  // Swipe in the strip below the playable keys without starting another note.
  const piano = await page.locator('.piano_keys').boundingBox();
  const y = piano.y + piano.height + 12;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: 320, y }] });
  for (const x of [280, 240, 200, 160]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 3, x, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.audioCalls)).toEqual({ starts: 4, releases: 4 });
  expect(await page.pageErrors()).toEqual([]);
  await context.close();
});

test('keyboard and two pointers share one pitch until the final release', async ({ page }) => {
  await observeAudio(page);
  await page.keyboard.down('y');
  const key = page.locator('.computer_keys .key_6_3');
  // Native capture is exercised by the mouse and CDP touch tests.
  await key.evaluate(element => { element.setPointerCapture = () => {}; });
  for (const pointerId of [10, 11]) await key.dispatchEvent('pointerdown', { pointerId, button: 0, pointerType: 'touch' });
  await page.keyboard.up('y');
  await expect(page.locator('.piano_keys .key_69')).toHaveClass(/key_active/);
  await key.dispatchEvent('pointerup', { pointerId: 10 });
  expect(await page.evaluate(() => window.audioCalls)).toEqual({ starts: 2, releases: 0 });
  await key.dispatchEvent('lostpointercapture', { pointerId: 11 });
  expect(await page.evaluate(() => window.audioCalls)).toEqual({ starts: 2, releases: 2 });
});

for (const cleanup of ['blur', 'pagehide', 'visibility', 'mode']) {
  test(`releases pointer notes on ${cleanup}`, async ({ page }) => {
    await observeAudio(page);
    const key = page.locator('.piano_keys .key_42');
    await key.hover();
    await page.mouse.down();
    expect(await page.evaluate(() => window.audioCalls.starts)).toBe(2);
    if (cleanup === 'mode') await page.locator('#midi-mode').dispatchEvent('click');
    else if (cleanup === 'visibility') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    else await page.evaluate(event => window.dispatchEvent(new Event(event)), cleanup);
    await expect(page.locator('.key_active')).toHaveCount(0);
    expect(await page.evaluate(() => window.audioCalls.releases)).toBe(2);
    await page.mouse.up();
    expect(await page.evaluate(() => window.audioCalls.releases)).toBe(2);
  });
}
