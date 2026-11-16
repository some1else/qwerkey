import { test, expect } from '@playwright/test';
import { rolldown } from 'rolldown';

let arrangementRandom;
test.beforeAll(async () => {
  const bundle = await rolldown({ input: 'src/audio.ts' });
  try {
    const result = await bundle.generate({ format: 'es' });
    const entry = result.output.find(chunk => chunk.type === 'chunk' && chunk.isEntry);
    ({ arrangementRandom } = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`));
  } finally {
    await bundle.close();
  }
});

function samples(seed, time) {
  const random = arrangementRandom(seed, time);
  return [random(), random()];
}

test('repeats note jitter regardless of playback order or intervening notes', () => {
  const first = samples(123, 4.125);
  samples(123, 0);
  samples(123, 9.25);
  expect(samples(123, 4.125)).toEqual(first);
  expect(samples(124, 4.125)).not.toEqual(first);
  expect(samples(123, 4.126)).not.toEqual(first);
  expect(first[0]).not.toEqual(first[1]);
});

test('arrangement samples stay bounded across seeds and long timelines', () => {
  for (const seed of [0, 1, 500, 1000]) {
    for (const time of [0, 0.000001, 1.25, 3600, 86400]) {
      for (const value of samples(seed, time)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  }
});
