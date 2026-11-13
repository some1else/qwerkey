# Astro + React migration plan

## Objective and scope

Move Qwerkey from a Vite application using native DOM APIs to a statically built Astro site with a React instrument UI. Preserve the current appearance, keyboard and pointer behavior, audio graph, MIDI routing, session settings, and static deployment. Implement this as four sequential, reviewable changes. This document is the plan; it does not migrate the application.

Qwerkey currently has one HTML page and four TypeScript modules, totaling 727 lines including HTML. `src/main.ts` owns DOM rendering, input handling, note ownership, mode changes, and controls. `src/audio.ts` implements the synthesizer; `src/midi.ts` implements MIDI access and routing; `src/layout.ts` defines the Tonnetz mappings. Five Playwright spec files cover the current behavior. CI separately checks types, builds, and tests the uploaded production artifact.

## Target architecture

- Astro owns the document, metadata, global stylesheet import, analytics snippet, and static build.
- One React island owns the entire instrument, including its splash screen, both keyboards, mode selector, and controls. Mount it as `<Instrument client:load />` so the visible instrument hydrates immediately. Keeping related controls in one island provides a single owner for shared note and mode state. This follows the official [React integration](https://docs.astro.build/en/guides/integrations-guide/react/) and [client directive](https://docs.astro.build/en/reference/directives-reference/#clientload) APIs.
- Audio and MIDI remain framework-independent TypeScript services. React calls them directly from input handlers; musical events must not wait for a render or effect.
- A per-mount controller owns held notes, incoming MIDI notes, release timers, and service lifetimes. A React hook subscribes to UI snapshots and manages browser event subscriptions. Start with local React state and refs; no additional state library is needed.
- Initial rendering is deterministic and safe during Astro's build. Browser APIs and capability detection run only in client lifecycle code or event handlers. Audio starts from the existing explicit enable gesture; MIDI permission remains deferred until MIDI mode is selected.

Suggested structure:

```text
astro.config.mjs
src/
  pages/index.astro
  layouts/SiteLayout.astro
  components/instrument/
    Instrument.tsx
    AudioGate.tsx
    ModeSwitch.tsx
    ComputerKeyboard.tsx
    PianoKeyboard.tsx
    AudioParameters.tsx
    MidiPorts.tsx
  hooks/useInstrument.ts
  instrument/controller.ts
  audio.ts
  midi.ts
  layout.ts
  styles/app.css
tests/                         # retain existing browser specs
```

## 1. Establish Astro tooling and the page shell

1. Select and lock mutually compatible stable versions of `astro`, `@astrojs/react`, `react`, and `react-dom`. Add `@astrojs/check` and React type packages; verify compatibility with the existing TypeScript version and the Node version pinned in `.nvmrc`. Align `package.json` engine requirements with the chosen Astro release.
2. Add `astro.config.mjs` with the React integration and static output. Replace direct Vite scripts with `astro dev`, `astro build`, and `astro preview`; remove the direct Vite dependency/config once no longer used. Astro continues to manage Vite internally.
3. Extend Astro's strict TypeScript configuration, enable React JSX, and retain `noUncheckedIndexedAccess`. Change `typecheck` to `astro check`, which also checks Astro templates; `build` remains `npm run typecheck && astro build`. See [Astro TypeScript guidance](https://docs.astro.build/en/guides/typescript/).
4. Move the document wrapper into `SiteLayout.astro` and the route into `src/pages/index.astro`. Import the existing CSS globally from `src/styles/app.css`. Preserve the Google Tag Manager identifier and execute its snippet once through an inline Astro script.
5. For this transitional commit, render the existing instrument markup in the Astro page and load `src/main.ts` as a processed module script. Keep that DOM outside React until the cutover in step 3.
6. Configure a build-time base path, defaulting to `/` at `https://qwerkey.xyz`, with an override for a subdirectory. Build and preview must use the same base. Replace hard-coded internal URLs with imported assets or `import.meta.env.BASE_URL` as appropriate. Unlike the current relative Vite asset URLs, this plan produces an artifact for its configured base; document the rebuild requirement when changing deployment paths. See [Astro's base configuration](https://docs.astro.build/en/reference/configuration-reference/#base).
7. Update Playwright's server command and readiness URL to the Astro preview path. In CI, replace `npx vite build` with `npx astro build` after the upstream typecheck job; retain the artifact handoff to tests.

**Exit criterion:** The existing instrument works through Astro, typechecking passes, and the existing browser suite passes against the production build at `/`.

## 2. Extract instrument state and resource cleanup

1. Extract note/mode/control orchestration from `src/main.ts` into `src/instrument/controller.ts`, without importing React. Temporarily keep `main.ts` as the DOM view and event adapter. This validates the controller independently of the UI rewrite.
2. Preserve source-based note ownership: keyboard codes and pointer IDs identify presses, while each pitch sounds once until its last local owner releases it. Keep incoming MIDI highlights separate from local sound generation and preserve the first-mapping rule for duplicate incoming pitches.
3. Move release-highlight timeout handles out of `KeyMapping` and into controller-owned state. Make the exported mappings read-only data, with stable coordinate and pitch identifiers.
4. Define a small typed interface for enable, press/release, release-all, mode selection, parameter changes, MIDI port selection, snapshot subscription, and disposal. Publish immutable UI snapshots. Keep active-note audio/MIDI calls synchronous with the originating event.
5. Add idempotent disposal to both services. Audio disposal must stop held and releasing voices and close its context. MIDI disposal must send pending note-offs, clear input and device callbacks, and prevent pending access requests from attaching handlers after disposal. Handle late audio-enable completion similarly. Normal mode switching retains the services and session settings.
6. Release notes and clear timers on blur, pagehide, hidden-document transitions, and controller disposal. Unsubscribe browser listeners on teardown. Release notes using the previous mode before updating the mode.

**Exit criterion:** Existing tests still pass, with focused coverage for controller disposal and late permission/enable completion. No changes to synthesis algorithms or MIDI message semantics.

## 3. Replace the DOM view with React

1. Implement `Instrument.tsx` and its child views. Render the 50 computer keys and 56 piano keys declaratively from existing mappings; retain CSS classes, IDs, labels, and data attributes used by CSS and tests.
2. Create the controller in the client lifecycle managed by `useInstrument`, subscribe to snapshots, and dispose it on unmount. Avoid module-level runtime singletons and browser-dependent render branches. Ensure setup/cleanup can repeat safely under React Strict Mode; React documents this extra development lifecycle in [useEffect](https://react.dev/reference/react/useEffect).
3. Register stable keyboard, visibility, and window listeners with cleanup. Preserve ignored form targets, repeat suppression, Tab behavior, focus restoration, left-button filtering, pointer capture, multitouch, and pointer cancellation/lost-capture release.
4. Call audio enable directly from the splash button handler, preserving loading, failure, and retry behavior. Disable the prerendered enable button until the client controller is ready. Apply the Safari MIDI restriction after client capability detection, preserving its accessible state and explanation.
5. Render parameter defaults from `defaultParameters`. This also removes the current HTML/TypeScript mismatch for attack and decay values. Keep editable numeric text separate from accepted engine values so empty or invalid input does not interrupt typing or change the engine. Preserve the existing input limits and step behavior.
6. Use React state for classes, visibility, port options, and selected values; remove `querySelector`-driven UI mutations and the `KeyMapping.timeout` field. Clear and restart each key's three-second release timer correctly when retriggered.
7. Mount the React island from `index.astro` and remove the transitional instrument markup and `src/main.ts` import together. Remove `src/main.ts` once no imports remain.

**Exit criterion:** The full existing browser suite passes without weakening its assertions. There are no hydration errors, duplicate listeners, double notes, or notes continuing after teardown.

## 4. Verify, document, and finish

- Run `npm run typecheck`, the production build, and all Playwright specs. Keep CI's separate typecheck/build/test jobs and test the exact uploaded artifact.
- Add targeted migration coverage for prerendered markup followed by hydration, one event subscription per mount, unmount/remount while a note is held, and late MIDI permission resolution after disposal. Use a minimal test harness for lifecycle cases rather than shipping test controls in the app.
- Keep audio render checks at 44.1 and 48 kHz, including polyphony and the -1 dBFS sample ceiling. Retain existing MIDI fakes at the browser API boundary.
- Verify production asset loading at `/`; separately rebuild for a subdirectory and smoke-test it. Check narrow and wide layouts, piano scrolling, focus behavior, failed audio retry, MIDI selection/disconnection, and Safari's existing restriction.
- Compare generated HTML, client JavaScript size, and readiness to play against the Vite baseline. React adds runtime code to this small app; report the actual difference and check responsiveness rather than assuming the migration reduces JavaScript.
- Update README development commands, supported Node version, architecture, build-time base configuration, deployment instructions, and test commands. Remove obsolete configuration and references after validation.

**Completion criteria:** Behavioral and visual parity, clean static build and browser checks, explicit service cleanup, documented base-path deployment, and no application dependency on the old DOM bootstrap. Review each numbered stage as a separate change; revert the most recent stage if its acceptance checks fail.

## Baseline validation

Before migration, `npm test` passed: strict TypeScript checking, the Vite production build, and all 53 Playwright tests against `/qwerkey/` (browser suite: 2.3 minutes). The preview server required permission to listen on localhost outside the sandbox.

Current production assets provide a size comparison baseline: JavaScript 13.74 kB (5.04 kB gzip), CSS 6.87 kB (1.86 kB gzip), and HTML 3.27 kB (1.38 kB gzip), as reported by Vite. No framework dependencies or application behavior are changed by this planning document.

## Implementation record

The migration is implemented in the working tree. Astro now renders the document
and prerendered keyboard markup; one React island owns the instrument. The
controller and browser hook replace `src/main.ts`. Both browser services expose
idempotent disposal and ignore late enable/permission responses after teardown.
The original audio algorithms and MIDI semantics are preserved.

The React views retain the existing IDs, CSS classes, data attributes, keyboard
mapping, and control limits. Numeric inputs retain draft text in the browser and
send only valid numbers to the engine. Styles moved to `src/styles/app.css`.
Related keyboard views share `Keyboards.tsx`; splash and mode controls remain in
`Instrument.tsx` rather than introducing tiny wrapper components.

Toolchain: Astro 7.4.12, React 19.3.1, and TypeScript 6.0.3. Astro's current checker
does not support the previous TypeScript 7 version. Node's minimum is now
22.23.4, with the existing Node 24.13.0 pin retained. CI still uploads a single
build artifact for browser testing. Preview uses `--ignore-lock` in tests to
prevent Astro's agent backgrounding from ending Playwright's server command.

Root-path build and hydration smoke checks pass. The migration harness is bundled
only inside tests and exercises React Strict Mode remounting, audio cleanup, and
late audio/MIDI completion; it is not included in the static site.

Production assets total approximately 237.5 kB JavaScript (74.8 kB gzip), compared
to 13.74 kB (5.04 kB gzip) before migration. CSS is 6.82 kB (1.83 kB gzip), and
prerendered HTML is 21.39 kB (5.14 kB gzip). React's runtime increases the client
payload; musical events still reach the services synchronously and the existing
immediate-playback assertions pass. The larger HTML contains the keyboard that
previously had to be generated in the browser.

Deployment defaults to the root of `https://qwerkey.xyz`; `QWERKEY_BASE` is only
needed for an alternate subdirectory build. The README explains both options. No deployment was performed. The historical plan's
suggested intermediate commits were consolidated into this working-tree change.

Final validation: `npm run build` passes with zero errors and zero warnings
(two hints concern the preserved legacy `keyCode` mapping). All 57 tests pass
with `npx playwright test --workers=1` in 2.0 minutes. A combined parallel run
encountered browser setup/timeouts on this machine; the original 53-test suite
also passed with three workers before adding the lifecycle harness. Root-path
smoke testing passed both selected checks. `git diff --check` is clean.
