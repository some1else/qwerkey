# Qwerkey (Keyboard Tonnetz)

[Tonnetz](https://en.wikipedia.org/wiki/Tonnetz) is a two dimensional arrangement of musical pitches, first discovered by Euler. One of it's special properties, is the fact that specific harmonies always retain their geometric shape, regardless of which key they are played in. 

![qwerkey](http://i.giphy.com/TFuiYFosi6QGk.gif)

First commercial product to apply the principle was probably the [Opal Sonome keyboard](http://www.shapeofmusic.com/), but in recent years (somewhere after 2008) the [C-Thru Axis](http://c-thru-music.com/cgi/index.cgi) appears to have become synonimous with the technique. This is the first QWERTY keyboard incarnation.

## Features

- It costs nothing
- Plays sounds with WebAudio API
- Mirrors the current chord on a traditional piano keyboard

## Wishlist

- [ ] Clicking a piano key reflects it on the keyboard
- [ ] Send out MIDI
- [ ] Recording and playback
## Development

Use Node.js 22.12 or newer and npm. Install packages and the test browser:

```sh
npm ci
npx playwright install chromium
```

Run `npm run dev` to start the development server. Run `npm run build` to
produce a static site in `dist/`, and `npm run preview` to serve that build.
Deploy the contents of `dist/`. Asset URLs are relative to support hosting in
a subdirectory.

## MIDI and tests

The app uses strict TypeScript, native DOM APIs, and the browser Web MIDI API.
Run `npm run typecheck` to check browser code, or `npm run build` to check and
bundle it with Vite. Keyboard presses send MIDI notes on channel 1 to `Qwerkey Out`.
Incoming notes from the selected input highlight the keyboards. The Output and
Input dropdowns below the piano list available MIDI ports. Each defaults to
`Qwerkey Out` or `Qwerkey In` respectively when present; otherwise it shows
`-- Choose MIDI port --`. Choose any available port, or choose the placeholder
to disable that direction. Changes apply immediately and selections last for
the current page session. Device changes refresh the lists without overriding
manual choices; disconnecting a selected port returns it to the placeholder.
Input and output ports are optional and work independently. Use a browser with Web MIDI support
and serve over HTTPS or localhost for MIDI access.

Run `npm test` to build and run the small Playwright suite in Chromium. It tests
rendering, chords, repeated keydown, MIDI input, and missing ports or denied
access. Fake MIDI ports at the browser API boundary exercise native MIDI integration without hardware. The production build is tested under `/qwerkey/`,
including checks for failed requests, browser errors, and vendor asset URLs.
A hardware check can be performed by connecting the named ports, playing a
chord, releasing each key, and sending notes back through `Qwerkey In`.
