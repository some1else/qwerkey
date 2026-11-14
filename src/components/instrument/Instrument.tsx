import { useState } from "react";
import RecordedBuffer from "./RecordedBuffer";
import type { PointerEvent } from "react";
import { mappings } from "../../layout";
import { useInstrument } from "../../hooks/useInstrument";
import type { Mode } from "../../instrument/controller";
import PianoKeyboard from "./PianoKeyboard";
import AudioParameters from "./AudioParameters";
import MidiPorts from "./MidiPorts";
import { ComputerKeyboard } from "./Keyboards";
export default function Instrument() {
  const [bufferPlaying, setBufferPlaying] = useState(false);
  const [tab, setTab] = useState<"audio" | "midi" | "buffer">("audio");
  const { state, ready, safari, controller, instrument, focus } =
    useInstrument();
  function selectMode(mode: Mode) {
    if (mode === "midi" && safari)
      window.alert(
        "Qwerkey’s MIDI mode is unavailable in Safari. You can keep playing in Just play or open Qwerkey in a browser with Web MIDI support.",
      );
    else {
      controller.current?.releasePreview();
      setTab(mode);
      controller.current?.selectMode(mode);
    }
    focus();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !controller.current?.getSnapshot().enabled)
      return;
    const key =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".key")
        : null;
    if (!key?.dataset.pitch) return;
    event.preventDefault();
    key.setPointerCapture(event.pointerId);
    focus();
    const pitch = Number(key.dataset.pitch);
    const mapping = key.dataset.code
      ? mappings.find((item) => item.code === Number(key.dataset.code))
      : mappings.find((item) => item.noteNumber === pitch);
    controller.current.press(`pointer:${event.pointerId}`, { pitch, mapping });
  }
  return (
    <>
      <div className="overlay" hidden={state.enabled}>
        <p>
          Keyboard{" "}
          <a href="https://en.wikipedia.org/wiki/Tonnetz" target="_blank">
            Tonnetz
          </a>
        </p>
        <p>
          <a href="http://twitter.com/some1else" target="_blank">
            @some1else
          </a>
        </p>
        <p>
          <button
            id="enabler"
            disabled={!ready || state.busy}
            onClick={async () => {
              await controller.current?.enable();
              if (controller.current?.getSnapshot().enabled) focus();
            }}
          >
            {state.error
              ? "Audio could not start. Click to retry"
              : "Click here to enable audio"}
          </button>
        </p>
      </div>
      <div
        id="instrument"
        tabIndex={-1}
        ref={instrument}
        style={{ textAlign: "center" }}
      >
        <div
          className="mode_switch"
          role="tablist"
          aria-label="Playback mode"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              ),
            );
            const index = tabs.indexOf(event.target as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 2
                  : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
            tabs[next]?.click();
            tabs[next]?.focus();
          }}
        >
          <button
            id="audio-mode"
            aria-controls="playback-panel"
            tabIndex={tab === "audio" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={tab === "audio"}
            aria-pressed={tab === "audio"}
            onClick={() => selectMode("audio")}
          >
            Just play
          </button>
          <button
            id="midi-mode"
            aria-controls="playback-panel"
            tabIndex={tab === "midi" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={tab === "midi"}
            aria-pressed={tab === "midi"}
            aria-disabled={safari || undefined}
            onClick={() => selectMode("midi")}
          >
            Send MIDI
          </button>
          <button
            id="buffer-mode"
            aria-controls="playback-panel"
            tabIndex={tab === "buffer" ? 0 : -1}
            role="tab"
            aria-selected={tab === "buffer"}
            onClick={() => {
              controller.current?.releaseLive();
              setTab("buffer");
            }}
          >
            Recorded buffer
          </button>
        </div>
        <div
          role="tabpanel"
          id="playback-panel"
          aria-labelledby={`${tab === "buffer" ? "buffer" : tab}-mode`}
        >
          <div hidden={tab !== "buffer"}>
              <label>
                Playback output{" "}
                <select
                  value={state.mode}
                  onChange={(e) =>
                    controller.current?.selectMode(e.target.value as Mode)
                  }
                >
                  <option value="audio">Audio</option>
                  {!safari && <option value="midi">MIDI</option>}
                </select>
              </label>
              <RecordedBuffer controller={controller.current} onPlayingChange={setBufferPlaying} visible={tab === "buffer"} />
          </div>
          {tab !== "buffer" && (
            <button onClick={() => window.dispatchEvent(new Event("qwerkey:toggle-buffer"))}>
              {bufferPlaying ? "Stop buffer" : "Play buffer"}
            </button>
          )}
          {tab !== "buffer" && (
            <>
              <ComputerKeyboard state={state} onPointerDown={pointerDown} />
              <PianoKeyboard
                key={state.interaction}
                state={state}
                controller={controller.current}
              />
            </>
          )}
          <div className="sound_controls">
            <AudioParameters
              parameters={state.parameters}
              hidden={state.mode !== "audio"}
              controller={controller.current}
            />
            <MidiPorts state={state} controller={controller.current} />
          </div>
        </div>
      </div>
    </>
  );
}
