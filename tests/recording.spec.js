import { test, expect } from "@playwright/test";
import { rolldown } from "rolldown";
import { readFile } from "node:fs/promises";
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
test("buffer records live notes, loops without recording itself, exports and clears", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.keyboard.down("y");
  await page.waitForTimeout(180);
  await page.keyboard.up("y");
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  const buffer = page.getByRole("region", {
    name: "Recorded buffer",
    exact: true,
  });
  await expect(buffer).toHaveAttribute("data-note-count", "1");
  await expect(page.locator(".roll_note")).toHaveCount(1);
  await page.getByRole("button", { name: "Play loop", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(buffer).toHaveAttribute("data-note-count", "1");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download entire buffer", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("qwerkey-buffer.mid");
  const parsed = parse(await readFile(await download.path()));
  expect(parsed.events).toHaveLength(2);
  expect(parsed.events[0].pitch).toBe(69);
  await page.getByRole("button", { name: "Clear buffer", exact: true }).click();
  await expect(buffer).toHaveAttribute("data-note-count", "0");
  await page.getByRole("button", { name: "Undo clear", exact: true }).click();
  await expect(buffer).toHaveAttribute("data-note-count", "1");
  await expect(page.locator('.roll_ruler')).toHaveCSS('position', 'sticky');
  const ruler = await page.locator('.roll_ruler').boundingBox();
  const viewport = await page.locator('.roll_viewport').boundingBox();
  expect(Math.abs(ruler.y - viewport.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.screenshot({ path: "/tmp/qwerkey-buffer.png" });
  expect(errors).toEqual([]);
});

test("MIDI input retains channel and velocities and range downloads clip at both ends", async ({
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
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "1",
  );
  await page.getByLabel("Loop start (seconds)", { exact: true }).fill("0.05");
  await page.getByLabel("Loop end (seconds)", { exact: true }).fill("0.15");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download selected range", exact: true })
    .click();
  const file = await event;
  const parsed = parse(await readFile(await file.path()));
  expect(parsed).toEqual({
    events: [
      { time: 0, status: 0x95, pitch: 127, velocity: 101 },
      { time: 100, status: 0x85, pitch: 127, velocity: 33 },
    ],
    end: 100,
  });
  await page.getByRole("button", { name: "Play loop", exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
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
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  const note = page.locator(".roll_note");
  await note.click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "1",
  );
  await page
    .getByRole("button", { name: "Delete selected notes", exact: true })
    .click();
  await expect(page.locator(".recorded_buffer")).toHaveAttribute(
    "data-note-count",
    "0",
  );
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Just play", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
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
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  const start = page.getByLabel("Loop start (seconds)", { exact: true });
  const end = page.getByLabel("Loop end (seconds)", { exact: true });
  const ruler = page.locator(".roll_ruler");
  const box = await ruler.boundingBox();
  const ticks = page.locator(".roll_tick");
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
  await page.getByRole("button", { name: "Play loop", exact: true }).click();
  await end.fill("4");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await expect(page.locator(".roll_loop")).toHaveAttribute("data-explicit", "true");
  await page.getByRole("button", { name: "Clear range", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download selected range", exact: true })).toBeDisabled();
  // Backward drawing replaces the default region.
  await drag(box.x + 4 * unit, box.x + 2 * unit);
  await bounds(2, 4);
  await end.fill("12");
  await expect.poll(async () => (await ruler.boundingBox()).width).toBeGreaterThan(box.width);
  await expect(page.locator(".roll_note")).toHaveCount(1);
});

test("loop handles remain usable at low zoom and ruler touch drawing survives scrolling", async ({ page, context }) => {
  await page.setViewportSize({ width: 667, height: 900 });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  const start = page.getByLabel("Loop start (seconds)", { exact: true });
  const end = page.getByLabel("Loop end (seconds)", { exact: true });
  await end.fill("20");
  await start.fill("1");
  await end.fill("1.001");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const left = await page.locator(".roll_loop_start").boundingBox();
  const right = await page.locator(".roll_loop_end").boundingBox();
  expect(right.x - left.x).toBeGreaterThan(30);
  await page.getByRole("slider", { name: "Loop end", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(end).toHaveValue("1.001");
  await page.getByRole("slider", { name: "Loop range", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(start).toHaveValue("1.01");
  await expect(end).toHaveValue("1.011");
  await page.getByRole("button", { name: "Clear range", exact: true }).click();
  await end.fill("20");
  await start.fill("18");
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
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected range", exact: true }).click();
  const download = await downloadEvent;
  expect(parse(await readFile(await download.path()))).toEqual({ events: [], end: 2000 });
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
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  await page.getByLabel("Loop end (seconds)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Play loop", exact: true }).click();
  await page.getByRole("tab", { name: "Just play", exact: true }).click();
  const starts = await page.evaluate(() => window.playbackStarts);
  await page.waitForFunction(before => window.playbackStarts > before, starts);
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.locator(".roll_note").click();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Delete selected notes", exact: true }).click();
  await expect(page.locator(".roll_note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
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

test("Fit frames a selected nonzero silent loop", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 900 });
  await page.goto("./");
  await page.locator("#enabler").click();
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  await page.getByLabel("Loop end (seconds)", { exact: true }).fill("30");
  await page.getByLabel("Loop start (seconds)", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const viewport = await page.locator(".roll_viewport").boundingBox();
  const loop = await page.locator(".roll_loop").boundingBox();
  expect(loop.x).toBeGreaterThanOrEqual(viewport.x);
  expect(loop.x + loop.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
  await page.screenshot({ path: "/tmp/qwerkey-fit-667.png" });
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
  await page.getByRole("tab", { name: "Recorded buffer", exact: true }).click();
  const exported = async () => {
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download entire buffer", exact: true }).click();
    const download = await event;
    return parse(await readFile(await download.path())).events;
  };
  const before = await exported();
  await page.locator(".roll_grid").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator(".roll_note[data-selected]")).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowUp");
  const after = await exported();
  expect(after).toEqual(before.map(event => ({ ...event, pitch: event.pitch + 12 })));
});
