import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.BENCH_URL || 'http://127.0.0.1:4173/';
const label = process.env.BENCH_LABEL || 'baseline';
const sizes = (process.env.BENCH_SIZES || '0,500,2000').split(',').map(Number);
await mkdir('/tmp/qwerkey-performance', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const results = [];
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('https://www.googletagmanager.com/**', route => route.abort());
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(options) { super(options); window.benchContext = this; }
      };
      window.benchErrors = [];
      window.addEventListener('error', event => window.benchErrors.push(event.message));
    });
    await page.goto(url);
    await page.locator('#enabler').click();
    await page.evaluate(size => {
      for (let i = 0; i < size; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', keyCode: 89, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'y', keyCode: 89, bubbles: true }));
      }
    }, size);
    await page.waitForTimeout(3500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    if (process.env.BENCH_PROFILE === '1' && size === 500) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    const before = await cdp.send('Performance.getMetrics');
    const result = await page.evaluate(async () => {
      const durations = [], late = [], frames = [], longTasks = [];
      let mutations = 0, running = true, last;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(document.querySelector('#buffer-panel'), { subtree: true, attributes: true, childList: true, characterData: true });
      const tasks = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      tasks.observe({ type: 'longtask' });
      function frame(time) { if (!running) return; if (last) frames.push(time - last); last = time; requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      const start = performance.now();
      // 16 notes/sec, each held for 31.25ms. Separate tasks let React commit.
      const codes = [89, 84, 82, 69, 87, 69, 82, 84];
      for (let i = 0; i < 128; i++) {
        const deadline = start + i * 31.25;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - performance.now())));
        late.push(Math.max(0, performance.now() - deadline));
        const begin = performance.now();
        document.dispatchEvent(new KeyboardEvent(i % 2 ? 'keyup' : 'keydown', { keyCode: codes[Math.floor(i / 2) % codes.length], bubbles: true }));
        durations.push(performance.now() - begin);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      running = false; observer.disconnect(); tasks.disconnect();
      const stats = values => {
        values.sort((a, b) => a - b);
        return { count: values.length, p50: values[Math.floor(values.length * .5)] || 0, p95: values[Math.floor(values.length * .95)] || 0, max: values.at(-1) || 0 };
      };
      return {
        elapsedMs: performance.now() - start,
        dispatchMs: stats(durations), schedulingLateMs: stats(late), frameMs: stats(frames), longTasks: stats(longTasks), hiddenBufferMutations: mutations,
        noteElements: document.querySelectorAll('.roll_note').length, domElements: document.querySelectorAll('*').length,
        sampleRate: window.benchContext.sampleRate, baseLatency: window.benchContext.baseLatency, outputLatency: window.benchContext.outputLatency,
        errors: window.benchErrors,
      };
    });
    const after = await cdp.send('Performance.getMetrics');
    const metric = (data, name) => data.metrics.find(m => m.name === name).value;
    result.mainThreadTaskMs = 1000 * (metric(after, 'TaskDuration') - metric(before, 'TaskDuration'));
    result.scriptMs = 1000 * (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration'));
    if (process.env.BENCH_PROFILE === '1' && size === 500) {
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(`/tmp/qwerkey-performance/${label}.cpuprofile`, JSON.stringify(profile));
    }
    results.push({ label, seededNotes: size, ...result });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
  await writeFile(`/tmp/qwerkey-performance/${label}.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
