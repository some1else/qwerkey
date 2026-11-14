import { test, expect } from "@playwright/test";
import { rolldown } from "rolldown";
let recording, midiFile, clipNotes, applyRollEdits, startLoop;
test.beforeAll(async () => {
  const bundle = await rolldown({
    input: ["src/instrument/recording.ts", "src/instrument/midi-file.ts", "src/instrument/transport.ts"],
  });
  const result = await bundle.generate({ format: "es" });
  for (const chunk of result.output.filter(
    (c) => c.type === "chunk" && c.isEntry,
  )) {
    const mod = await import(
      `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
    );
    if (mod.createRecording) {
      recording = mod.createRecording;
      clipNotes = mod.clipNotes;
      applyRollEdits = mod.applyRollEdits;
    }
    if (mod.midiFile) midiFile = mod.midiFile;
    if (mod.startLoop) startLoop = mod.startLoop;
  }
  await bundle.close();
});
// Exercise the native accessible range inputs retained by the timeline primitives.
function edge(page, name) {
  const input = page.getByRole("slider", { name: `Loop ${name}`, exact: true });
  return {
    inputValue: () => input.inputValue(),
    fill: async value => {
      await input.evaluate((element, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    },
  };
}
async function clearRange(page) {
  const box = await page.locator(".roll_ruler").boundingBox();
  await page.mouse.click(box.x + box.width - 5, box.y + 20);
}
function parse(bytes) {
  expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("MThd");
  expect(Buffer.from(bytes.slice(14, 18)).toString()).toBe("MTrk");
  let i = 22,
    time = 0;
  const events = [];
  const variable = () => {
    let value = 0,
      byte;
    do {
      byte = bytes[i++];
      value = value * 128 + (byte & 127);
    } while (byte & 128);
    return value;
  };
  while (i < bytes.length) {
    time += variable();
    const status = bytes[i++];
    if (status === 255) {
      const type = bytes[i++],
        length = variable();
      i += length;
      if (type === 47) return { events, end: time };
    } else
      events.push({ time, status, pitch: bytes[i++], velocity: bytes[i++] });
  }
  throw Error("Missing end-of-track");
}
test("recording pairs retriggers, ignores orphan releases and preserves clear-held notes", () => {
  let time = 1000;
  const store = recording(() => time);
  store.start("local", 69);
  time += 150;
  store.end("local");
  store.end("orphan");
  time += 850;
  store.start("midi", 0, 15, 99, "midi");
  time += 50;
  store.start("midi", 0, 15, 100, "midi");
  store
    .snapshot()
    .forEach((n, i) =>
      expect(n.duration).toBeCloseTo([0.15, 0.05, 0.001][i], 8),
    );
  store.clear();
  time += 75;
  store.end("midi", 27);
  expect(store.snapshot()).toEqual([
    expect.objectContaining({
      pitch: 0,
      channel: 15,
      velocity: 100,
      releaseVelocity: 27,
      start: 0,
      duration: 0.075,
    }),
  ]);
});
test("MIDI serialization clips, rebases, merges overlapping owners and retains silence", () => {
  const notes = [
    {
      id: "a",
      pitch: 60,
      channel: 3,
      velocity: 99,
      releaseVelocity: 12,
      start: 1,
      duration: 3,
      source: "midi",
    },
    {
      id: "b",
      pitch: 60,
      channel: 3,
      velocity: 64,
      releaseVelocity: 64,
      start: 2,
      duration: 3,
      source: "local",
    },
  ];
  const parsed = parse(midiFile(clipNotes(notes, 2, 6), 4));
  expect(parsed).toEqual({
    events: [
      { time: 0, status: 147, pitch: 60, velocity: 99 },
      { time: 3000, status: 131, pitch: 60, velocity: 12 },
    ],
    end: 4000,
  });
  expect(parse(midiFile([], 2))).toEqual({ events: [], end: 2000 });
});
test("buffer records live notes and loops without recording itself", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.down("y");
  await page.waitForTimeout(180);
  await page.keyboard.up("y");
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  const buffer = page.getByRole("region", {
    name: "Recorded buffer",
    exact: true,
  });
  await expect(buffer).toHaveAttribute("data-note-count", "1");
  await expect(page.locator(".roll_note")).toHaveCount(1);
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await expect(buffer).toHaveAttribute("data-note-count", "1");
  await expect(page.locator('.buffer_toolbar')).toBeVisible();
  await expect(page.locator('.output_controls')).toBeVisible();
  await expect(page.locator('.roll_ruler')).toHaveCSS('position', 'sticky');
  const ruler = await page.locator('.roll_ruler').boundingBox();
  const viewport = await page.locator('.roll_viewport').boundingBox();
  expect(Math.abs(ruler.y - viewport.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.screenshot({ path: "/tmp/qwerkey-buffer.png" });
  expect(errors).toEqual([]);
});

test("MIDI input retains channel and velocities during loop playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sent = [];
    const input = {
      id: "in",
      name: "IAC Driver Qwerkey In",
      state: "connected",
    };
    const output = {
      id: "out",
      name: "IAC Driver Qwerkey Out",
      state: "connected",
      send: (data) => window.sent.push(Array.from(data)),
    };
    window.receive = (data) =>
      input.onmidimessage({ data: new Uint8Array(data) });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: async () => ({
        inputs: new Map([["in", input]]),
        outputs: new Map([["out", output]]),
      }),
    });
  });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.locator("#midi-mode").click();
  await page.evaluate(() => window.receive([0x95, 127, 101]));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.receive([0x85, 127, 33]));
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "1",
  );
  await edge(page, "start").fill("0.05");
  await edge(page, "end").fill("0.15");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  const before = await page.evaluate(() => window.sent.length);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.sent.length)).toBe(before);
  expect(await page.evaluate(() => window.sent)).toContainEqual([
    0x95, 127, 101,
  ]);
  expect(await page.evaluate(() => window.sent)).toContainEqual([
    0x85, 127, 33,
  ]);
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "1",
  );
});

test("editor selection, move, delete, range and tab navigation do not trigger live playing", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.down("y");
  await page.waitForTimeout(100);
  await page.keyboard.up("y");
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  const note = page.locator(".roll_note");
  await note.click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "1",
  );
  await page.locator(".roll_note").first().focus();
  await page.keyboard.press("Backspace");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "0",
  );
  await page.getByRole("tab", { name: "Buffer", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Keyboard", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('#keyboard-mode')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#buffer-mode')).toBeFocused();
  await expect(page.locator('#buffer-mode')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#keyboard-mode')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#buffer-mode')).toBeFocused();
  await expect(page.locator('.recorded_buffer')).toHaveAttribute('data-note-count', '0');
  expect(await page.pageErrors()).toEqual([]);
});

test("note edges lengthen and shorten individual notes while the body still moves", async ({ page }) => {
  await page.goto("./");
  await page.locator("#enabler").click();
  for (const key of ["y", "x"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(200);
    await page.keyboard.up(key);
    await page.waitForTimeout(80);
  }
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  const notes = page.locator(".roll_note");
  await expect(notes).toHaveCount(2);
  await expect.poll(async () => (await notes.nth(1).boundingBox())?.width ?? 0).toBeGreaterThan(100);
  const note = notes.nth(1);
  const original = await note.boundingBox();
  const untouched = await notes.first().boundingBox();
  const dragEdge = async (edge, delta) => {
    const handle = note.locator(`.roll_note_handle[data-edge="${edge}"]`);
    const box = await handle.boundingBox();
    expect(box.height).toBeGreaterThan(10);
    expect(box.width).toBeGreaterThan(0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  const expectBounds = async (x, width) => {
    await expect.poll(async () => {
      const box = await note.boundingBox();
      return Math.max(Math.abs(box.x - x), Math.abs(box.width - width));
    }).toBeLessThan(2);
  };
  await dragEdge("end", 40);
  await expectBounds(original.x, original.width + 40);
  await dragEdge("end", -60);
  await expectBounds(original.x, original.width - 20);
  await dragEdge("start", -30);
  await expectBounds(original.x - 30, original.width + 10);
  await dragEdge("start", 50);
  await expectBounds(original.x + 20, original.width - 40);
  const other = await notes.first().boundingBox();
  expect(other.x).toBeCloseTo(untouched.x, 1);
  expect(other.width).toBeCloseTo(untouched.width, 1);

  // The center retains a move target, including after resizing.
  const resized = await note.boundingBox();
  await page.mouse.move(resized.x + resized.width / 2, resized.y + resized.height / 2);
  await page.mouse.down();
  await page.mouse.move(resized.x + resized.width / 2 + 20, resized.y + resized.height / 2, { steps: 5 });
  await page.mouse.up();
  await expectBounds(resized.x + 20, resized.width);

  // Keyboard resizing uses the same edits and respects the 1 ms minimum.
  await note.focus();
  await page.keyboard.press("Shift+ArrowRight");
  const longer = await note.boundingBox();
  expect(longer.width).toBeGreaterThan(resized.width);
  await page.keyboard.press("Shift+ArrowLeft");
  await expectBounds(resized.x + 20, resized.width);
  await dragEdge("end", -original.width * 2);
  expect(await note.evaluate(el => Number(el.style.getPropertyValue('--timeline-length')))).toBeCloseTo(0.001, 6);
  const shortest = await note.boundingBox();
  expect(shortest.width).toBeGreaterThan(0);
  expect(shortest.width).toBeLessThan(9);
  // Short notes retain distinct edges and a body target.
  const start = await note.locator('[data-edge="start"]').boundingBox();
  const end = await note.locator('[data-edge="end"]').boundingBox();
  expect(start.x + start.width).toBeLessThanOrEqual(end.x);
  expect(await page.pageErrors()).toEqual([]);
});

test("editor merge preserves concurrent notes, channel metadata and pending identities", () => {
  let time = 0;
  const store = recording(() => time);
  store.start("a", 60, 7, 90, "midi");
  time = 100;
  store.end("a", 17);
  const displayed = store.snapshot();
  store.start("b", 61, 9, 80, "midi");
  const merged = applyRollEdits(
    store.snapshot(),
    displayed,
    store.pendingIds(),
    [
      {
        id: displayed[0].id,
        pitch: 62,
        start: 0.5,
        length: 0.2,
        velocity: 0.5,
      },
    ],
  );
  store.replace(merged);
  time = 250;
  store.end("b", 18);
  expect(store.snapshot()).toEqual([
    expect.objectContaining({
      pitch: 62,
      channel: 7,
      velocity: 64,
      releaseVelocity: 17,
      start: 0.5,
      duration: 0.2,
    }),
    expect.objectContaining({
      pitch: 61,
      channel: 9,
      velocity: 80,
      releaseVelocity: 18,
      duration: 0.15,
    }),
  ]);
});

test("ruler draws, moves and resizes the loop without editing notes", async ({ page }) => {
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.press("y");
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  const start = edge(page, "start");
  const end = edge(page, "end");
  const ruler = page.locator(".roll_ruler");
  const ticks = page.locator(".roll_tick");
  // Entry fits the short recorded phrase; zoom out to draw a multi-second loop.
  await ruler.hover();
  for (let i = 0; i < 15; i++) {
    const spacing = (await ticks.nth(1).boundingBox()).x - (await ticks.nth(0).boundingBox()).x;
    if (spacing * 5 < (await page.locator(".roll_viewport").boundingBox()).width) break;
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(60);
  }
  const box = await ruler.boundingBox();
  const unit = (await ticks.nth(1).boundingBox()).x - (await ticks.nth(0).boundingBox()).x;
  const drag = async (from, to, y = box.y + 25) => {
    await page.mouse.move(from, y);
    await page.mouse.down();
    await page.mouse.move(to, y, { steps: 12 });
    await page.mouse.up();
  };
  const bounds = async (a, b) => {
    await expect.poll(async () => Number(await start.inputValue())).toBeCloseTo(a, 2);
    await expect.poll(async () => Number(await end.inputValue())).toBeCloseTo(b, 2);
  };
  // Begin over a tick label: marks must let drawing reach the lane.
  await drag(box.x + 2 * unit + 2, box.x + 4 * unit, box.y + 6);
  await bounds(2 + 2 / unit, 4);
  await drag(box.x + 3 * unit, box.x + 2.5 * unit);
  await bounds(1.5 + 2 / unit, 3.5);
  const left = await page.locator(".roll_loop_start").boundingBox();
  await drag(left.x + 8, left.x + 8 + unit / 4);
  await bounds(1.75 + 2 / unit, 3.5);
  const right = await page.locator(".roll_loop_end").boundingBox();
  await drag(right.x + 16, right.x + 16 + unit / 4);
  await bounds(1.75 + 2 / unit, 3.75);
  await page.getByRole("slider", { name: "Loop start", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await bounds(1.76 + 2 / unit, 3.75);
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-note-count", "1");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await end.fill("4");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await expect(page.locator(".roll_loop")).toHaveAttribute("data-explicit", "true");
  await clearRange(page);
  await expect(page.locator(".roll_loop")).toHaveAttribute("data-explicit", "false");
  // Backward drawing replaces the default region.
  await drag(box.x + 4 * unit, box.x + 2 * unit);
  await bounds(2, 4);
  await end.fill("5");
  await expect(page.locator(".roll_note")).toHaveCount(1);
});

test("loop handles remain usable at low zoom and ruler touch drawing survives scrolling", async ({ page, context }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  const start = edge(page, "start");
  const end = edge(page, "end");
  await end.fill("5");
  await start.fill("1");
  await end.fill("1.001");
  await page.locator(".roll_ruler").hover();
  await page.mouse.wheel(0, -100);
  const left = await page.locator(".roll_loop_start").boundingBox();
  const right = await page.locator(".roll_loop_end").boundingBox();
  expect(right.x - left.x).toBeGreaterThan(30);
  await page.getByRole("slider", { name: "Loop end", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  expect(await end.inputValue()).toBe("1.001");
  await page.getByRole("slider", { name: "Loop range", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  expect(await start.inputValue()).toBe("1.01");
  expect(await end.inputValue()).toBe("1.011");
  await clearRange(page);
  await end.fill("5");
  await start.fill("4");
  await page.locator(".roll_viewport").evaluate(el => { el.scrollLeft = 100; el.scrollTop = 200; });
  const ruler = await page.locator(".roll_ruler").boundingBox();
  const viewport = await page.locator(".roll_viewport").boundingBox();
  expect(Math.abs(ruler.y - viewport.y)).toBeLessThan(2);
  const ticks = page.locator(".roll_tick");
  const unit = (await ticks.nth(1).boundingBox()).x - (await ticks.nth(0).boundingBox()).x;
  const client = await context.newCDPSession(page);
  const y = ruler.y + 25;
  const x1 = ruler.x + unit * 3, x2 = ruler.x + unit * 5;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x2, y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Number(await start.inputValue())).toBeCloseTo(3, 2);
  await expect.poll(async () => Number(await end.inputValue())).toBeCloseTo(5, 2);
  await page.screenshot({ path: "/tmp/qwerkey-loop-667.png" });
});


test("playback survives tabs, edits and Space toggles", async ({ page }) => {
  await page.addInitScript(() => {
    window.playbackStarts = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.playbackStarts++;
      return start.apply(this, args);
    };
  });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.down("y");
  await page.waitForTimeout(150);
  await page.keyboard.up("y");
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  await edge(page, "end").fill("1");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await page.getByRole("tab", { name: "Keyboard", exact: true }).click();
  const starts = await page.evaluate(() => window.playbackStarts);
  await page.waitForFunction(before => window.playbackStarts > before, starts);
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.locator(".roll_note").click();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Space");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "false");
  await page.keyboard.press("Space");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.locator(".roll_note").first().focus();
  await page.keyboard.press("Backspace");
  await expect(page.locator(".roll_note")).toHaveCount(0);
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
});

test("Fit trims historical extent and reanchors subsequent capture", () => {
  let time = 0;
  const store = recording(() => time);
  store.start("a", 60);
  time = 100;
  store.end("a");
  time = 10000;
  store.start("b", 64);
  time = 11000;
  store.end("b");
  store.replace(store.snapshot().filter(n => n.pitch === 60));
  expect(store.extent()).toBe(11);
  expect(store.trim()).toBeCloseTo(0.1);
  store.start("c", 67);
  expect(store.snapshot()[1].start).toBeCloseTo(0.1);
});

test("running transport reconciles edits without retriggering unchanged notes", () => {
  let time = 0;
  const on = [], off = [];
  const note = { id: "a", pitch: 60, channel: 0, velocity: 64, releaseVelocity: 64, start: 0, duration: 1, source: "local" };
  const loop = startLoop([note], 2, { on: n => on.push(n.pitch), off: n => off.push(n.pitch), position: () => {} }, () => time);
  try {
    time = 0.2;
    loop.update([{ ...note, duration: 1.5 }], 2, 0.2);
    expect(on).toEqual([60]);
    expect(off).toEqual([]);
    loop.update([{ ...note, pitch: 72 }], 2, 0.2);
    expect(on).toEqual([60, 72]);
    expect(off).toEqual([60]);
    loop.update([], 2, 0.2);
    expect(off).toEqual([60, 72]);
  } finally { loop(); }
});

test("grid selection transposes the whole group once and preserves metadata", async ({ page }) => {
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.down("y");
  await page.keyboard.down("u");
  await page.waitForTimeout(100);
  await page.keyboard.up("y");
  await page.keyboard.up("u");
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  await expect(page.locator('.roll_note')).toHaveCount(2);
  const positions = () => page.locator('.roll_note').evaluateAll(items => items.map(item => parseFloat(getComputedStyle(item).top)));
  const before = await positions();
  expect(before.every(Number.isFinite)).toBe(true);
  await page.locator('.roll_grid').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('.roll_note[data-selected]')).toHaveCount(2);
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(positions).toEqual(before.map(y => y - 12 * 18));
  await page.keyboard.press('Backspace');
  await expect(page.locator('.roll_note')).toHaveCount(0);

});

test("transport starts at a sought position without sounding earlier notes", () => {
  const sounded = [];
  const positions = [];
  const note = { id: "a", pitch: 60, channel: 0, velocity: 80, releaseVelocity: 64, source: "local", start: 0, duration: 0.2 };
  const cancel = startLoop([note, { ...note, id: "b", pitch: 62, start: 0.5, duration: 0.4 }], 1, {
    startPosition: 0.6,
    on: n => sounded.push(n.pitch), off: () => {}, position: time => positions.push(time),
  }, () => 10);
  cancel();
  expect(sounded).toEqual([62]);
  expect(positions[0]).toBeCloseTo(0.6);
});

test("recording follows exact loop time and keeps held durations across wraps and stop", () => {
  let time = 0;
  const store = recording(() => time);
  store.start("original", 60);
  time = 100;
  store.end("original");
  // Simulate a long session: new loop recordings must not land at 120 seconds.
  time = 120000;
  const transport = startLoop([], 2, {
    startPosition: 0.4, on: () => {}, off: () => {}, position: () => {},
  }, () => time / 1000);
  store.setCapturePosition(timestamp => 5 + transport.position(timestamp / 1000));
  time += 500;
  store.start("midi", 74, 3, 99, "midi");
  expect(store.snapshot()[1].start).toBeCloseTo(5.9);
  time += 1500;
  expect(store.snapshot()[1].duration).toBeCloseTo(1.5);
  expect(store.extent()).toBeCloseTo(7.4);
  store.start("local", 67);
  expect(store.snapshot()[2].start).toBeCloseTo(5.4);
  store.setCapturePosition(null);
  transport();
  time += 100;
  store.end("midi", 27);
  store.end("local");
  expect(store.snapshot()[1]).toEqual(expect.objectContaining({
    start: expect.closeTo(5.9), duration: expect.closeTo(1.6),
    channel: 3, velocity: 99, releaseVelocity: 27, source: "midi",
  }));
  expect(store.snapshot()[2].duration).toBeCloseTo(0.1);
  // Ordinary capture resumes at the buffer end, with elapsed silence preserved.
  store.start("after", 70);
  expect(store.snapshot()[3].start).toBeCloseTo(7.5);
});

test("incoming MIDI is recorded at the looping playhead even on a hidden editor", async ({ page }) => {
  await page.addInitScript(() => {
    const input = { id: "in", name: "Test In", state: "connected" };
    window.sent = [];
    const output = { id: "out", name: "Test Out", state: "connected", send: data => window.sent.push(Array.from(data)) };
    window.receive = data => input.onmidimessage({ data: new Uint8Array(data), receivedTime: performance.now() });
    Object.defineProperty(navigator, "requestMIDIAccess", { value: async () => ({
      inputs: new Map([["in", input]]), outputs: new Map([["out", output]]),
    }) });
  });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.locator("#midi-mode").click();
  await page.locator("#midi-input").selectOption("in");
  await page.locator("#midi-output").selectOption("out");
  await page.evaluate(() => window.receive([0x90, 60, 90]));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.receive([0x80, 60, 64]));
  await page.locator("#buffer-mode").click();
  await edge(page, "end").fill("2");
  await edge(page, "start").fill("0.5");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await page.locator("#keyboard-mode").click();
  await page.evaluate(() => window.receive([0x93, 74, 101]));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.receive([0x83, 74, 33]));
  // Leave the editor hidden for subsequent passes: capture must update playback
  // without an editor gesture or another Play, and playback must not re-record.
  await expect.poll(() => page.evaluate(() => window.sent.filter(data => data[0] === 0x93 && data[1] === 74 && data[2] === 101).length)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.sent.some(data => data[0] === 0x83 && data[1] === 74))).toBe(true);
  await page.locator("#buffer-mode").click();
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-note-count", "2");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");

});

test("synth plays a live overdub on subsequent passes without restarting", async ({ page }) => {
  await page.addInitScript(() => {
    window.frequencies = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.frequencies.push(this.frequency.value);
      return start.apply(this, args);
    };
  });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.press("y");
  await page.locator("#buffer-mode").click();
  await edge(page, "end").fill("0.8");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await page.locator("#keyboard-mode").click();
  await page.locator("#instrument").focus();
  await page.keyboard.down("u");
  await page.waitForTimeout(150);
  await page.keyboard.up("u");
  // U is MIDI pitch 73: one live unison pair, then at least two playback pairs.
  await expect.poll(() => page.evaluate(() => window.frequencies.filter(hz => Math.abs(hz - 440 * 2 ** (4 / 12)) < 0.1).length)).toBeGreaterThanOrEqual(6);
  await page.locator("#buffer-mode").click();
  await expect(page.locator(".roll_note")).toHaveCount(2);
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
});

test("completed snapshots are stable and held snapshots remain immutable", () => {
  let time = 1000;
  const store = recording(() => time);
  store.start("one", 60);
  time += 100;
  const held = store.snapshot();
  time += 100;
  store.end("one");
  expect(held[0].duration).toBeCloseTo(.1);
  const completed = store.snapshot();
  expect(completed[0].duration).toBeCloseTo(.2);
  expect(store.snapshot()).toBe(completed);
  store.start("two", 64);
  expect(store.snapshot()[0]).toBe(completed[0]);
  expect(store.count).toBe(2);
});

test("hidden recording avoids editor DOM and Space plays fresh capture", async ({ page }) => {
  // Slow React commits used to let auto-fit scroll before zoom anchoring ran.
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.press("y");
  await page.waitForTimeout(100);
  await expect(page.locator(".roll_note")).toHaveCount(0);
  await expect(page.locator(".roll_velocity")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Space");
  await page.getByRole("tab", { name: "Buffer", exact: true }).click();
  await expect.poll(() => page.locator('.roll_viewport').evaluate(element => {
    const start = Number(element.querySelector('.roll_loop_start input').value);
    const end = Number(element.querySelector('.roll_loop_end input').value);
    const zoom = parseFloat(getComputedStyle(element.querySelector('.roll_grid')).getPropertyValue('--timeline-unit'));
    return Math.abs((end - start) * zoom - (element.clientWidth - 32));
  })).toBeLessThan(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator(".roll_note")).toHaveCount(1);
  expect(await page.locator('.roll_viewport').evaluate(element => element.scrollLeft)).toBe(0);
});

test("stopped phrases capture first onset through Play, retaining silence and held notes", () => {
  let time = 1000;
  const store = recording(() => time);
  expect(store.finishLoopCapture()).toBeNull();
  store.start("first", 60);
  time = 1200;
  store.end("first");
  time = 1600;
  store.start("second", 64);
  time = 1800;
  store.end("second");
  time = 3000;
  expect(store.finishLoopCapture()).toEqual([0, 2]);
  expect(store.extent()).toBe(2);
  expect(store.snapshot().map(n => n.duration)).toEqual([0.2, 0.2]);
  expect(parse(midiFile(store.snapshot(), store.extent())).end).toBe(2000);
  store.setCapturePosition(() => 0.5);
  store.start("overdub", 67);
  expect(store.capturedLoop()).toBeNull();
  time = 3100;
  store.end("overdub");
  store.setCapturePosition(null);
  time = 4100;
  // Merely restarting playback does not replace the previous region.
  expect(store.finishLoopCapture()).toBeNull();
  store.start("next", 72, 3, 99, "midi");
  expect(store.capturedLoop()).toEqual([3, 3.001]);
  time = 5100;
  expect(store.finishLoopCapture()).toEqual([3, 4]);
  // Starting playback while held must not end the live note.
  store.setCapturePosition(() => 3);
  time = 5600;
  store.end("next", 23);
  expect(store.snapshot().at(-1)).toEqual(expect.objectContaining({
    start: 3, duration: 1.5, channel: 3, velocity: 99, releaseVelocity: 23,
  }));
});

test("manual loop edits override a phrase and Clear rearms first-note capture", () => {
  let time = 0;
  const store = recording(() => time);
  store.start("first", 60);
  store.cancelLoopCapture();
  time = 100;
  store.start("second", 64);
  expect(store.finishLoopCapture()).toBeNull();
  store.clear();
  time = 500;
  expect(store.finishLoopCapture()).toEqual([0, 0.4]);
  store.finish();
  store.clear();
  expect(store.capturedLoop()).toBeNull();
  time = 1000;
  store.start("fresh", 67);
  time = 2000;
  expect(store.finishLoopCapture()).toEqual([0, 1]);
});

test("Space closes stopped phrases at the gesture, including silence, and rearms after Stop", async ({ page }) => {
  await page.addInitScript(() => {
    window.gestures = [];
    document.addEventListener("keydown", event => {
      if (["KeyY", "KeyU", "Space"].includes(event.code))
        window.gestures.push({ code: event.code, time: performance.now() });
    }, true);
  });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.down("y");
  await page.waitForTimeout(100);
  await page.keyboard.up("y");
  await page.waitForTimeout(400);
  await page.keyboard.press("Space");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Space");
  await page.locator("#buffer-mode").click();
  const firstEnd = Number(await edge(page, "end").inputValue());
  const firstTiming = await page.evaluate(() => (window.gestures[1].time - window.gestures[0].time) / 1000);
  expect(Number(await edge(page, "start").inputValue())).toBe(0);
  expect(firstEnd).toBeCloseTo(firstTiming, 1);
  expect(firstEnd).toBeGreaterThan(0.5);
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  expect(Number(await edge(page, "end").inputValue())).toBe(firstEnd);
  await page.locator("#keyboard-mode").click();
  await page.locator("#instrument").focus();
  await page.waitForTimeout(150);
  await page.keyboard.down("u");
  await page.waitForTimeout(100);
  await page.keyboard.up("u");
  // The loop start is visible before Play, and its end keeps following silence.
  await page.locator("#buffer-mode").click();
  await expect.poll(async () => Number(await edge(page, "start").inputValue())).toBeGreaterThan(firstEnd);
  const secondStart = Number(await edge(page, "start").inputValue());
  await page.waitForTimeout(300);
  await page.locator(".roll_viewport").focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-playing", "true");
  const secondEnd = Number(await edge(page, "end").inputValue());
  const secondTiming = await page.evaluate(() => {
    const onset = window.gestures.find(event => event.code === "KeyU");
    return (window.gestures.at(-1).time - onset.time) / 1000;
  });
  expect(secondEnd - secondStart).toBeCloseTo(secondTiming, 1);
  await page.waitForTimeout(100);
  expect(Number(await edge(page, "end").inputValue())).toBe(secondEnd);
  await expect(page.locator(".recorded_buffer")).toHaveAttribute("data-note-count", "2");
});
