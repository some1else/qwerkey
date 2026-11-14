import { test, expect } from "@playwright/test";
import { rolldown } from "rolldown";
import { readFile } from "node:fs/promises";
let recording, midiFile, clipNotes, applyRollEdits;
test.beforeAll(async () => {
  const bundle = await rolldown({
    input: ["src/instrument/recording.ts", "src/instrument/midi-file.ts"],
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
