# Qwerkey (Keyboard Tonnetz)

[Tonnetz](https://en.wikipedia.org/wiki/Tonnetz) is a two dimensional arrangement of musical pitches, first discovered by Euler. One of it's special properties, is the fact that specific harmonies always retain their geometric shape, regardless of which key they are played in. 

![qwerkey](http://i.giphy.com/TFuiYFosi6QGk.gif)

First commercial product to apply the principle was probably the [Opal Sonome keyboard](http://www.shapeofmusic.com/), but in recent years (somewhere after 2008) the [C-Thru Axis](http://c-thru-music.com/cgi/index.cgi) appears to have become synonimous with the technique. This is the first QWERTY keyboard incarnation.

## Features

- It costs nothing
- Plays sounds with WebAudio API
- Mirrors the current chord on a traditional piano keyboard

## Wishlist

- [x] Clicking a piano key reflects it on the keyboard
- [x] Send out MIDI
- [x] Recording and playback
## Development

Use Node.js 22.23.4 or newer and npm. Install packages and the test browser:

```sh
npm ci
npx playwright install chromium
```

Run `npm run dev` to start the development server. Run `npm run build` to
produce a static site in `dist/`, and `npm run preview` to serve that build.
Deploy the contents of `dist/` at the root of [qwerkey.xyz](https://qwerkey.xyz).
The default build and preview target `/`; no environment override is needed.
For a subdirectory deployment, set `QWERKEY_BASE=/your-path/` for both commands.
Rebuild whenever the deployment base changes.

## Audio, MIDI, and tests

The app uses Astro with a React instrument island, strict TypeScript, and the browser Web MIDI API.
Run `npm run typecheck` to check browser code, or `npm run build` to check and
bundle it with Vite. The app starts in Audio mode with a splash screen. Click “Click here to enable
audio” to start the synthesizer, then use the Just play/Send MIDI tabs above the
keyboards to switch modes. Switching releases held notes. MIDI access is
requested when MIDI mode is first selected. Safari keeps Audio selected and
shows an explanation when its unavailable MIDI segment is activated.

In Audio mode, controls below the piano select Sin, Tri, Saw, or Sqr and set
A/D/R durations in milliseconds and S as a sustain level in dB relative to the
attack peak. Sustain holds until key release, which starts R immediately.
The # (Voices) control sets polyphony from 1 to 64, defaulting to 8. When full,
release tails are reused first, then the oldest held note, with a brief fade.
Lowering the limit applies immediately.
Defaults: Tri, A 9 ms, D 1800 ms, S -12 dB, R 2200 ms, Freq 440 Hz, Reso 0.7. Envelope changes apply to the next note.
Oscillator, Freq, and Reso also update held notes. Freq is a lowpass cutoff relative
to each note: 440 follows its frequency, 880 is one octave above, and 220 is one
octave below. Reso uses classic linear Q, defaulting to 0.7. Settings survive
mode changes for the current page session.

Each audio voice peaks at 1/12 so twelve simultaneous voices reach 0 dBFS at a
unity-gain mixer. The mixer feeds a compressor, +4 dB makeup gain, and a fast
limiter. The audio context runs at 192 kHz where supported, oversampling the
whole chain, and a 4× oversampled soft clip rounds off limiter overshoots. A
final safety ceiling bounds output samples to -1 dBFS, including transients and
dense chords.

In MIDI mode, keyboard presses send MIDI notes on channel 1 to `Qwerkey Out`.
Incoming notes from the selected input highlight the keyboards. The Output and
Input dropdowns below the piano, visible in MIDI mode, list available MIDI ports. Each defaults to
`Qwerkey Out` or `Qwerkey In` respectively when present; otherwise it shows
`-- Choose MIDI port --`. Choose any available port, or choose the placeholder
to disable that direction. Changes apply immediately and selections last for
the current page session. Device changes refresh the lists without overriding
manual choices; disconnecting a selected port returns it to the placeholder.
Input and output ports are optional and work independently. Use a browser with Web MIDI support
and serve over HTTPS or localhost for MIDI access.

Run `npm test` to build and run the small Playwright suite in Chromium. It tests
rendering, audio startup and voice envelopes, chords, repeated keydown, mode
switching, the Safari restriction, MIDI input, and missing ports or denied access. Fake MIDI ports at the browser API boundary exercise native MIDI integration without hardware. The production build is tested at `/`,
including checks for failed requests, browser errors, and vendor asset URLs.
A hardware check can be performed by connecting the named ports, playing a
chord, releasing each key, and sending notes back through `Qwerkey In`.

## Architecture

Astro builds the static document in `src/pages/index.astro` with the shared
`src/layouts/SiteLayout.astro` layout. `Instrument.tsx` hydrates on page load;
its child components render the keyboards and controls. `useInstrument` owns
browser listeners and a controller for each mounted instrument.
`src/instrument/controller.ts` handles note ownership, mode changes, highlights,
and session state. `audio.ts` and `midi.ts` remain independent browser services
with explicit disposal, including protection against late permission responses.
Audio still requires the enable button gesture and MIDI access is requested only
on selection of MIDI mode.

Type checking uses `astro check` and TypeScript 6, supported by the current Astro
checker. The production build and Playwright tests use the same configured base.
Migration tests bundle a separate React Strict Mode harness; no test route or
controls are included in the deployed site.

## Audio controls

Audio controls use the headless `@audio-ui/react` primitives (pinned to 0.13.0),
with Qwerkey's own CSS. Drag a knob vertically, use its wheel or keyboard, or
enter an exact value in the number field below it. Shift gives finer knob drag;
double-click/tap resets a knob to its default. Sustain uses a horizontal fader.
Invalid numeric drafts keep the last accepted sound; blur or Escape restores
that accepted value. The controller shares accepted settings between widgets.

The piano also uses audio/ui: dragging across keys plays a glissando, each touch
can hold a note, and arrow keys navigate the piano after focusing it. Space or
Enter holds the focused note until release. QWERTY playing resumes when focus
returns to the instrument background. MIDI input highlights remain display-only.

## Recording and playback

The **Just play**, **Send MIDI**, and **Recorded buffer** tabs share a session
recording. Every live keyboard note is captured automatically; selected MIDI
input notes are also captured in Send MIDI mode, preserving channel and velocity.
Opening Recorded buffer retains the selected output. Reloading the page resets
the buffer. Synth release tails and sound settings are not part of MIDI data.

The buffer uses an audio/ui piano roll with a seconds timeline and no musical
meter or snapping. Scroll horizontally or zoom to inspect the recording. Fit trims
unused trailing duration and frames the selected loop, or the whole buffer when
no loop is selected, preserving note positions and leading silence.
Select and drag notes to move them, drag their edges to resize, double-click
empty space to draw, and use the velocity lane to change dynamics. Delete
selected notes with the toolbar. Incoming held notes grow until release and
cannot be edited until then. Up/Down transposes selected notes by a semitone;
Shift+Up/Down uses an octave.
Editor keyboard shortcuts do not play Tonnetz notes.

Drag empty space on the seconds ruler to draw a loop in either direction, drag
the highlighted body to move it, or drag its edges to resize it. Focus the loop
or an edge and use arrow keys for 0.01-second adjustments, or enter exact loop
start/end seconds. The time range is independent of selected notes; Clear range
restores the whole-buffer loop. **Play loop** repeats that range (or the
whole buffer); **Stop** returns to its beginning. Space toggles playback from the
instrument background or note editor. Playback continues across application tabs,
loop changes, note edits, and output changes; a play/stop control remains available
outside the editor. Playback and editor audition do not record themselves. Backgrounding
the page stops playback and releases notes. Avoid routing a MIDI output back to
the selected input, since external feedback is indistinguishable from live input.

**Download entire buffer** and **Download selected range** save standard `.mid`
files, including clipped notes at selection boundaries. Selected ranges start
at zero in the file and preserve silence. MIDI files use a fixed encoding tempo
of 60 BPM with millisecond ticks; the editor remains meterless. **Clear buffer**
starts fresh, with an Undo clear action that restores the cleared performance.
