import { test, expect } from '@playwright/test';
import { rolldown } from 'rolldown';
let harness;
test.beforeAll(async () => {
  const bundle = await rolldown({
    input: 'tests/fixtures/lifecycle.tsx',
    transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') }, jsx: { runtime: 'automatic' } },
  });
  const result = await bundle.generate({ format: 'iife' });
  harness = result.output[0].code;
  await bundle.close();
});
async function openHarness(page) {
  await page.route('**/__lifecycle', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('__lifecycle');
  await page.addScriptTag({ content: harness });
}
test('prerenders keys with audio gated, then hydrates without errors', async ({ browser, page }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  await staticPage.goto(test.info().project.use.baseURL);
  await expect(staticPage.locator('.computer_keys .key')).toHaveCount(50);
  await expect(staticPage.locator('.piano_keys .key')).toHaveCount(56);
  await expect(staticPage.locator('#enabler')).toBeDisabled();
  await context.close();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text()); });
  await page.goto('./');
  await expect(page.locator('#enabler')).toBeEnabled();
  await page.locator('#enabler').click();
  await expect(page.locator('.overlay')).toBeHidden();
  expect(errors).toEqual([]);
});
test('Strict Mode remount cleans audio and input listeners', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => {
    window.starts = 0; window.closes = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { window.starts++; return start.apply(this, args); };
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = function (...args) { window.closes++; return close.apply(this, args); };
    window.mount();
  });
  await page.locator('#enabler').click();
  await page.keyboard.down('y');
  await expect.poll(() => page.evaluate(() => window.starts)).toBe(1);
  await page.evaluate(() => window.unmount());
  await expect.poll(() => page.evaluate(() => window.closes)).toBe(1);
  await page.keyboard.up('y');
  await page.evaluate(() => window.mount());
  await page.locator('#enabler').click();
  await page.keyboard.down('y');
  await expect.poll(() => page.evaluate(() => window.starts)).toBe(2);
  await page.keyboard.up('y');
  await expect(page.locator('.key_active')).toHaveCount(0);
  await page.evaluate(() => window.unmount());
  expect(await page.pageErrors()).toEqual([]);
});
test('late MIDI permission cannot attach handlers after disposal', async ({ page }) => {
  await openHarness(page);
  const result = await page.evaluate(async () => {
    let resolve;
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: () => new Promise(done => { resolve = done; }) });
    const runtime = window.createController();
    let updates = 0;
    runtime.subscribe(() => updates++);
    runtime.selectMode('midi');
    runtime.dispose();
    const before = updates;
    const input = { id: 'in', name: 'IAC Driver Qwerkey In', state: 'connected' };
    const access = { inputs: new Map([['in', input]]), outputs: new Map() };
    resolve(access);
    await new Promise(done => setTimeout(done, 0));
    runtime.dispose();
    return { updates: updates - before, attached: !!input.onmidimessage || !!access.onstatechange };
  });
  expect(result).toEqual({ updates: 0, attached: false });
});
test('late audio enable cannot publish after disposal', async ({ page }) => {
  await openHarness(page);
  const result = await page.evaluate(async () => {
    let resume;
    const original = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () { return new Promise(done => { resume = done; }); };
    const runtime = window.createController();
    let updates = 0;
    runtime.subscribe(() => updates++);
    const pending = runtime.enable();
    runtime.dispose();
    const before = updates;
    resume(); await pending;
    AudioContext.prototype.resume = original;
    return updates - before;
  });
  expect(result).toBe(0);
});
